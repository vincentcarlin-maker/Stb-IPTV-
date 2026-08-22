import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { 
  X, 
  Activity, 
  Film, 
  AlertCircle,
  Smartphone
} from 'lucide-react';
import { openInDevicePlayer } from '../utils/devicePlayer';

export interface VodResolutionDiag {
  contentType: string;
  movieId: string;
  originalCmd: string;
  originalCmdMasked: string;
  originalCmdEmpty: 'YES' | 'NO';
  createLinkCalled: 'YES' | 'NO';
  createLinkStatus: 'SUCCESS' | 'FAILED' | string;
  createLinkResponseReceived: 'YES' | 'NO';
  createLinkRawUrl: string;
  resolvedPathname: string;
  resolvedStream: string;
  resolvedType: string;
  hasPlayToken: boolean;
  hasTypeMovie: boolean;
  usesLivePhp: boolean;
  urlValidForVod: boolean;
  validationError?: string;
}

export interface VodDiagnosticInfo {
  ffprobeStatus?: 'SUCCESS' | 'FAILED' | string;
  container: string;
  videoCodec: string;
  videoProfile?: string;
  audioCodec: string;
  audioChannels?: string | number;
  strategy: 'DIRECT' | 'REMUX_COPY_COPY' | 'VIDEO_COPY_AUDIO_AAC' | 'TRANSCODE_H264_AAC' | 'PROBE_FAILED' | string;
  videoTranscoding: boolean;
  audioTranscoding: boolean;
  output: string;
  segmentsReady: number;
  ffmpegSpeed: string;
  timeToPlayable: string;
  player: 'NATIVE_HLS' | 'HLS_JS' | 'NATIVE_HTML5';
  status: 'PREPARING' | 'READY' | 'PLAYING' | 'ERROR' | 'STOPPED' | string;
  errorDetails?: string;
  probeError?: string;
  vodResolutionDiag?: VodResolutionDiag;
}

interface VODPlayerModalProps {
  title: string;
  rawStreamUrl: string;
  originalCmd?: string;
  onClose: () => void;
}

export const VODPlayerModal: React.FC<VODPlayerModalProps> = ({
  title,
  rawStreamUrl,
  originalCmd,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState<boolean>(true);
  const [playbackStatus, setPlaybackStatus] = useState<'PREPARING' | 'PLAYING' | 'PAUSED' | 'ERROR'>('PREPARING');

  const [diagnostic, setDiagnostic] = useState<VodDiagnosticInfo>({
    ffprobeStatus: 'SUCCESS',
    container: 'Analyse...',
    videoCodec: 'Analyse...',
    videoProfile: 'N/A',
    audioCodec: 'Analyse...',
    audioChannels: 'N/A',
    strategy: 'REMUX_COPY_COPY',
    videoTranscoding: false,
    audioTranscoding: false,
    output: 'HLS fMP4',
    segmentsReady: 0,
    ffmpegSpeed: '0.0x',
    timeToPlayable: 'Analyse...',
    player: 'HLS_JS',
    status: 'PREPARING'
  });

  // Track video element events for accurate playback status
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    const handlePlaying = () => setPlaybackStatus('PLAYING');
    const handlePause = () => setPlaybackStatus('PAUSED');
    const handleWaiting = () => setPlaybackStatus('PREPARING');
    const handleError = () => setPlaybackStatus('ERROR');

    videoEl.addEventListener('playing', handlePlaying);
    videoEl.addEventListener('pause', handlePause);
    videoEl.addEventListener('waiting', handleWaiting);
    videoEl.addEventListener('error', handleError);

    return () => {
      videoEl.removeEventListener('playing', handlePlaying);
      videoEl.removeEventListener('pause', handlePause);
      videoEl.removeEventListener('waiting', handleWaiting);
      videoEl.removeEventListener('error', handleError);
    };
  }, []);

  // Initialize VOD session on backend
  useEffect(() => {
    let active = true;
    let currentSessionId: string | null = null;

    const initVodSession = async () => {
      setIsLoading(true);
      setErrorMsg(null);
      setPlaybackStatus('PREPARING');

      try {
        const response = await fetch('/api/vod/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawStreamUrl, title, originalCmd })
        });

        if (!response.ok) {
          throw new Error(`Erreur serveur (${response.status})`);
        }

        const data = await response.json();
        if (!active) return;

        if (data.sessionId) {
          currentSessionId = data.sessionId;
          setSessionId(data.sessionId);
        }

        if (data.diagnostic) {
          setDiagnostic((prev) => ({
            ...prev,
            ...data.diagnostic
          }));

          if (data.diagnostic.strategy === 'PROBE_FAILED' || data.diagnostic.status === 'ERROR') {
            const err = data.diagnostic.probeError || data.diagnostic.errorDetails || 'Échec de l\'analyse ffprobe du flux VOD';
            setErrorMsg(err);
            setIsLoading(false);
            setPlaybackStatus('ERROR');
            return;
          }
        }

        const playbackUrl = data.playbackUrl;
        const videoEl = videoRef.current;

        if (videoEl && playbackUrl) {
          if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
          }

          // Native Safari / iOS HLS
          if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = playbackUrl;
            setDiagnostic((prev) => ({ ...prev, player: 'NATIVE_HLS' }));
            videoEl.play().catch(() => {});
            setIsLoading(false);
          } 
          // HLS.js for Chrome, Firefox, Android, Edge
          else if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              backBufferLength: 90
            });

            hlsRef.current = hls;
            hls.loadSource(playbackUrl);
            hls.attachMedia(videoEl);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (active) {
                setIsLoading(false);
                setDiagnostic((prev) => ({ ...prev, player: 'HLS_JS' }));
                videoEl.play().catch(() => {});
              }
            });

            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) {
                console.warn('[VOD HLS.js Fatal Error]', data);
                if (active) {
                  setErrorMsg(`Erreur de flux vidéo HLS (${data.type})`);
                  setIsLoading(false);
                  setPlaybackStatus('ERROR');
                }
              }
            });
          } 
          // Fallback direct HTML5 <video>
          else {
            videoEl.src = playbackUrl;
            setDiagnostic((prev) => ({ ...prev, player: 'NATIVE_HTML5' }));
            videoEl.play().catch(() => {});
            setIsLoading(false);
          }
        }
      } catch (err: any) {
        if (active) {
          console.error('[VOD Player Init Error]', err);
          setErrorMsg(err.message || 'Impossible d\'initialiser la VOD');
          setIsLoading(false);
          setPlaybackStatus('ERROR');
        }
      }
    };

    initVodSession();

    return () => {
      active = false;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (currentSessionId) {
        fetch(`/api/vod/session/${currentSessionId}/stop`, { method: 'POST' }).catch(() => {});
      }
    };
  }, [rawStreamUrl, title]);

  // Periodic diagnostic status poll
  useEffect(() => {
    if (!sessionId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/vod/session/${sessionId}/status`);
        if (res.ok) {
          const data = await res.json();
          if (data.diagnostic) {
            setDiagnostic((prev) => ({
              ...prev,
              ...data.diagnostic
            }));
          }
        }
      } catch (_) {}
    }, 2000);

    return () => clearInterval(interval);
  }, [sessionId]);

  const handleClosePlayer = () => {
    if (sessionId) {
      fetch(`/api/vod/session/${sessionId}/stop`, { method: 'POST' }).catch(() => {});
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden">
      {/* Top Header Bar */}
      <div className="p-3.5 bg-gradient-to-b from-black/95 via-black/80 to-transparent flex flex-wrap items-center justify-between gap-3 z-20 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <Film className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-white max-w-md truncate">{title}</h3>
            <div className="flex items-center gap-2 text-[10px] text-slate-300">
              <span>Lecteur Natif HTML5 / Progressive HLS fMP4</span>
              <span className="w-1 h-1 rounded-full bg-slate-500"></span>
              <span className="text-emerald-400 font-semibold">{diagnostic.strategy}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Diagnostic Toggle Button */}
          <button
            onClick={() => setShowDiagnostic(!showDiagnostic)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border ${
              showDiagnostic
                ? 'bg-indigo-600/40 text-indigo-200 border-indigo-500/50'
                : 'bg-white/10 text-slate-300 border-white/10 hover:bg-white/20'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Diagnostic</span>
          </button>

          {/* External Device Player Fallback */}
          <button
            onClick={() => openInDevicePlayer(rawStreamUrl, title, 'vlc')}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 border border-orange-500/30 transition flex items-center gap-1.5 cursor-pointer"
            title="Ouvrir dans le lecteur VLC de l'appareil"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">VLC Appareil</span>
          </button>

          {/* Close Button */}
          <button
            onClick={handleClosePlayer}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition cursor-pointer border border-white/10 active:scale-95"
            title="Fermer le lecteur"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Video Viewport & Overlay */}
      <div className="relative flex-1 bg-black flex items-center justify-center min-h-0">
        {isLoading && (
          <div className="absolute inset-0 z-10 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4">
            <div className="w-12 h-12 border-3 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
            <p className="text-xs font-bold text-white mb-1">Analyse du flux VOD et sondage des codecs...</p>
            <p className="text-[11px] text-slate-400 font-mono">{diagnostic.strategy} ({diagnostic.container})</p>
          </div>
        )}

        {errorMsg && (
          <div className="absolute inset-0 z-10 bg-black/90 flex flex-col items-center justify-center p-6 text-center">
            <AlertCircle className="w-12 h-12 text-rose-400 mb-3" />
            <h4 className="text-sm font-bold text-white mb-1">Erreur de lecture VOD</h4>
            <p className="text-xs text-rose-300/80 mb-4 max-w-md break-words">{errorMsg}</p>
            <button
              onClick={() => openInDevicePlayer(rawStreamUrl, title)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-lg"
            >
              <Smartphone className="w-4 h-4" />
              Ouvrir dans le lecteur externe (VLC / Système)
            </button>
          </div>
        )}

        {/* HTML5 Native Video Element */}
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          className="w-full h-full object-contain max-h-[calc(100vh-110px)]"
        />

        {/* Diagnostic Panel Overlay */}
        {showDiagnostic && (
          <div className="absolute top-4 left-4 z-20 w-80 max-h-[85%] overflow-y-auto bg-slate-950/90 border border-indigo-500/30 rounded-2xl p-4 shadow-2xl backdrop-blur-md font-mono text-[11px] text-slate-200">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-indigo-500/20">
              <span className="font-bold text-indigo-400 text-xs">===== VOD PLAYBACK =====</span>
              <button 
                onClick={() => setShowDiagnostic(false)} 
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            {diagnostic.vodResolutionDiag && (
              <div className="pb-3 mb-3 border-b border-indigo-500/20 space-y-1.5 text-[10px]">
                <span className="text-amber-400 block font-bold text-xs">===== VOD URL RESOLUTION =====</span>
                <div className="flex justify-between">
                  <span className="text-slate-400">Content type:</span>
                  <span className="font-bold text-white">{diagnostic.vodResolutionDiag.contentType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Movie ID:</span>
                  <span className="font-bold text-amber-300">{diagnostic.vodResolutionDiag.movieId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Original CMD:</span>
                  <span className="font-bold text-slate-200 truncate max-w-[150px]" title={diagnostic.vodResolutionDiag.originalCmdMasked}>
                    {diagnostic.vodResolutionDiag.originalCmdMasked}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Original CMD empty:</span>
                  <span className="font-bold text-slate-200">{diagnostic.vodResolutionDiag.originalCmdEmpty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">create_link called:</span>
                  <span className="font-bold text-slate-200">{diagnostic.vodResolutionDiag.createLinkCalled}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">create_link:</span>
                  <span className={`font-bold ${diagnostic.vodResolutionDiag.createLinkStatus === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {diagnostic.vodResolutionDiag.createLinkStatus}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Response received:</span>
                  <span className="font-bold text-slate-200">{diagnostic.vodResolutionDiag.createLinkResponseReceived}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Resolved pathname:</span>
                  <span className="font-bold text-sky-300">{diagnostic.vodResolutionDiag.resolvedPathname}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Resolved stream:</span>
                  <span className="font-bold text-purple-300">{diagnostic.vodResolutionDiag.resolvedStream}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Resolved type:</span>
                  <span className="font-bold text-teal-300">{diagnostic.vodResolutionDiag.resolvedType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Has play_token:</span>
                  <span className="font-bold text-slate-200">{diagnostic.vodResolutionDiag.hasPlayToken ? 'YES' : 'NO'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Uses live.php:</span>
                  <span className={`font-bold ${diagnostic.vodResolutionDiag.usesLivePhp ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {diagnostic.vodResolutionDiag.usesLivePhp ? 'YES' : 'NO'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">VOD URL VALID:</span>
                  <span className={`font-bold ${diagnostic.vodResolutionDiag.urlValidForVod ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {diagnostic.vodResolutionDiag.urlValidForVod ? 'YES' : 'NO'}
                  </span>
                </div>
                {diagnostic.vodResolutionDiag.validationError && (
                  <div className="flex justify-between">
                    <span className="text-rose-400">Error reason:</span>
                    <span className="font-bold text-rose-400">{diagnostic.vodResolutionDiag.validationError}</span>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">FFPROBE:</span>
                <span className={`font-bold ${diagnostic.ffprobeStatus === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {diagnostic.ffprobeStatus || 'FAILED'}
                </span>
              </div>

              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">SOURCE CONTAINER:</span>
                <span className="font-bold text-white">{diagnostic.container}</span>
              </div>

              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">VIDEO CODEC:</span>
                <span className="font-bold text-emerald-400">{diagnostic.videoCodec}</span>
              </div>

              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">VIDEO PROFILE:</span>
                <span className="font-bold text-slate-200">{diagnostic.videoProfile || 'N/A'}</span>
              </div>

              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">AUDIO CODEC:</span>
                <span className="font-bold text-sky-400">{diagnostic.audioCodec}</span>
              </div>

              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">AUDIO CHANNELS:</span>
                <span className="font-bold text-slate-200">
                  {diagnostic.audioChannels !== undefined && diagnostic.audioChannels !== null && !Number.isNaN(diagnostic.audioChannels) 
                    ? String(diagnostic.audioChannels) 
                    : 'N/A'}
                </span>
              </div>

              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">STRATEGY:</span>
                <span className="font-bold text-amber-300">{diagnostic.strategy}</span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-400 text-[10px] uppercase font-semibold">VIDEO TRANSCODING:</span>
                <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${
                  diagnostic.videoTranscoding 
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {diagnostic.videoTranscoding ? 'YES' : 'NO'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[10px] uppercase font-semibold">AUDIO TRANSCODING:</span>
                <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${
                  diagnostic.audioTranscoding 
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {diagnostic.audioTranscoding ? 'YES' : 'NO'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[10px] uppercase font-semibold">SEGMENTS READY:</span>
                <span className="font-bold text-indigo-300">
                  {typeof diagnostic.segmentsReady === 'number' && !isNaN(diagnostic.segmentsReady) ? diagnostic.segmentsReady : 0}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[10px] uppercase font-semibold">STATUS:</span>
                <span className={`font-bold flex items-center gap-1.5 ${
                  playbackStatus === 'PLAYING' ? 'text-emerald-400' : playbackStatus === 'ERROR' ? 'text-rose-400' : 'text-amber-400'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    playbackStatus === 'PLAYING' ? 'bg-emerald-400 animate-pulse' : playbackStatus === 'ERROR' ? 'bg-rose-400' : 'bg-amber-400'
                  }`}></span>
                  {playbackStatus}
                </span>
              </div>

              {diagnostic.probeError && (
                <div className="mt-2 pt-2 border-t border-rose-500/30 text-rose-300 text-[10px] break-words">
                  <span className="font-bold block text-rose-400">PROBE ERROR:</span>
                  {diagnostic.probeError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

