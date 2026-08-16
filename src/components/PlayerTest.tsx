import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { useIPTV } from '../context/IPTVContext';
import { 
  Play, 
  Square, 
  RotateCcw, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Terminal, 
  Cpu, 
  Radio, 
  ArrowLeft, 
  ShieldCheck, 
  Tv,
  HelpCircle,
  HardDrive
} from 'lucide-react';

interface PlayerTestProps {
  onBack?: () => void;
}

interface FFmpegInfo {
  installed: boolean;
  version: string;
  path: string;
  platform?: string;
  arch?: string;
  cwd?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface SessionStatus {
  sessionExists: boolean;
  ffmpegStarted: boolean;
  ffmpegPid?: number;
  pid?: number;
  ffmpegRunning: boolean;
  manifestExists: boolean;
  segmentCount: number;
  lastLog: string | null;
  lastError: string | null;
  status?: string;
  exitCode?: number | null;
  upstreamReachable?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string;
  fps?: string;
  videoTranscoding?: boolean;
  audioTranscoding?: boolean;
  mode?: string;
  manifestGenerated?: boolean;
  segmentsCount?: number;
  segments?: string[];
  firstSegmentLoaded?: boolean;
  hlsManifestLoaded?: boolean;
  videoPlaying?: boolean;
  startupTimeMs?: number;
  manifestUrl?: string;
  errorMessage?: string | null;
  logs?: string[];
  tempDirectoryWritable?: boolean;
}

type StageType = 
  | 'checking_env'
  | 'ffmpeg_not_found'
  | 'ffmpeg_found'
  | 'starting_ffmpeg'
  | 'ffmpeg_started'
  | 'waiting_manifest'
  | 'manifest_created'
  | 'error';

export const PlayerTest: React.FC<PlayerTestProps> = ({ onBack }) => {
  const { channels, activeChannel, activeServer } = useIPTV();

  // FFmpeg info
  const [ffmpegInfo, setFFmpegInfo] = useState<FFmpegInfo>({
    installed: false,
    version: 'Vérification en cours...',
    path: '',
  });
  const [isCheckingEnv, setIsCheckingEnv] = useState<boolean>(true);

  // Test state
  const [selectedChannelId, setSelectedChannelId] = useState<string>(activeChannel?.id || '');
  const [customStreamUrl, setCustomStreamUrl] = useState<string>(activeChannel?.streamUrl || '');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [hlsJsManifestLoaded, setHlsJsManifestLoaded] = useState<boolean>(false);
  const [firstSegmentLoaded, setFirstSegmentLoaded] = useState<boolean>(false);
  const [videoPlaying, setVideoPlaying] = useState<boolean>(false);
  const [hlsError, setHlsError] = useState<string | null>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState<boolean>(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pollTimerRef = useRef<any>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const startTimestampRef = useRef<number>(0);
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  // 1. Fetch FFmpeg info on mount
  useEffect(() => {
    setIsCheckingEnv(true);
    fetch('/api/test/stalker-hls/info')
      .then((res) => res.json())
      .then((data) => {
        setIsCheckingEnv(false);
        setFFmpegInfo({
          installed: !!data.ffmpegInstalled,
          version: data.ffmpegVersion || 'Non détecté',
          path: data.ffmpegPath || '',
          platform: data.platform,
          arch: data.arch,
          cwd: data.cwd,
          errorCode: data.errorCode,
          errorMessage: data.errorMessage,
        });
      })
      .catch((err) => {
        setIsCheckingEnv(false);
        setFFmpegInfo({
          installed: false,
          version: `Erreur: ${err.message}`,
          path: '',
          errorMessage: err.message,
        });
      });
  }, []);

  // Update custom stream URL if activeChannel changes
  useEffect(() => {
    if (activeChannel?.streamUrl) {
      setCustomStreamUrl(activeChannel.streamUrl);
      setSelectedChannelId(activeChannel.id);
    }
  }, [activeChannel]);

  // Clean up HLS session on unmount
  useEffect(() => {
    return () => {
      if (sessionId) {
        fetch(`/api/test/stalker-hls/${sessionId}/stop`, { method: 'POST' }).catch(() => {});
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [sessionId]);

  // Scroll logs to bottom
  useEffect(() => {
    if (autoScrollLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [sessionStatus?.logs, autoScrollLogs]);

  // Calculate current stage for requirement 8
  const getCurrentStage = (): { stage: StageType; label: string; color: string } => {
    if (isCheckingEnv) {
      return { stage: 'checking_env', label: 'Vérification de FFmpeg...', color: 'text-amber-400' };
    }
    if (!ffmpegInfo.installed) {
      return { stage: 'ffmpeg_not_found', label: 'FFmpeg introuvable', color: 'text-red-400' };
    }
    if (hlsError || sessionStatus?.status === 'error' || sessionStatus?.lastError) {
      return { stage: 'error', label: `Erreur FFmpeg: ${sessionStatus?.lastError || hlsError}`, color: 'text-red-400' };
    }
    if (isStarting) {
      return { stage: 'starting_ffmpeg', label: 'Démarrage de FFmpeg...', color: 'text-sky-400' };
    }
    if (sessionStatus?.manifestExists || sessionStatus?.manifestGenerated) {
      return { stage: 'manifest_created', label: 'Manifeste créé (HLS prêt)', color: 'text-emerald-400' };
    }
    if (sessionStatus?.ffmpegStarted && sessionStatus?.ffmpegPid) {
      return { stage: 'waiting_manifest', label: `FFmpeg démarré (PID ${sessionStatus.ffmpegPid}) — En attente du manifeste HLS...`, color: 'text-indigo-400' };
    }
    if (sessionId) {
      return { stage: 'ffmpeg_started', label: 'Démarrage du processus FFmpeg...', color: 'text-indigo-400' };
    }
    return { stage: 'ffmpeg_found', label: `FFmpeg trouvé (${ffmpegInfo.path || 'système'})`, color: 'text-emerald-400' };
  };

  const currentStage = getCurrentStage();

  // Start FFmpeg Remux Test Session
  const handleStartTest = async () => {
    if (sessionId) {
      await handleStopTest();
    }

    const targetUrl = customStreamUrl.trim() || activeChannel?.streamUrl?.trim() || '';
    if (!targetUrl) {
      setHlsError('Veuillez spécifier une URL de flux Stalker ou choisir une chaîne.');
      return;
    }

    setIsStarting(true);
    setHlsError(null);
    setHlsJsManifestLoaded(false);
    setFirstSegmentLoaded(false);
    setVideoPlaying(false);
    setSessionStatus(null);
    startTimestampRef.current = Date.now();

    try {
      const res = await fetch('/api/test/stalker-hls/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamUrl: targetUrl,
          mac: activeServer?.macAddress || undefined,
        }),
      });

      const data = await res.json();
      if (!data.success || !data.sessionId) {
        throw new Error(data.error || 'Échec de création de la session HLS');
      }

      setSessionId(data.sessionId);
      setIsStarting(false);

      // Start status polling immediately
      startPolling(data.sessionId, data.manifestUrl);
    } catch (err: any) {
      setIsStarting(false);
      setHlsError(err.message || 'Erreur de démarrage FFmpeg');
    }
  };

  // Start status polling & HLS attach
  const startPolling = (currentSessionId: string, manifestUrl: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    let hlsAttached = false;

    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/test/stalker-hls/${currentSessionId}/status`);
        if (!res.ok) return;

        const data: SessionStatus = await res.json();
        setSessionStatus(data);

        if (startTimestampRef.current > 0 && !videoPlaying) {
          setElapsedMs(Date.now() - startTimestampRef.current);
        }

        // Once manifest exists and at least 1 segment exists, attach HLS.js
        if ((data.manifestExists || data.manifestGenerated) && !hlsAttached && videoRef.current) {
          hlsAttached = true;
          attachHlsPlayer(manifestUrl);
        }
      } catch (err) {
        // ignore poll errors
      }
    }, 600);
  };

  // Attach HLS Player
  const attachHlsPlayer = (manifestUrl: string) => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Check Safari native HLS support
    if (video.canPlayType('application/vnd.apple.mpegurl') && !Hls.isSupported()) {
      video.src = manifestUrl;
      setHlsJsManifestLoaded(true);
      video.play().then(() => {
        setVideoPlaying(true);
        setFirstSegmentLoaded(true);
      }).catch((e) => {
        console.warn('[Safari Native HLS Play warning]:', e);
      });
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        maxBufferLength: 10,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 5,
        manifestLoadingRetryDelay: 1000,
      });

      hlsRef.current = hls;
      hls.loadSource(manifestUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setHlsJsManifestLoaded(true);
        video.play().then(() => {
          setVideoPlaying(true);
        }).catch((e) => {
          console.warn('[Hls.js Autoplay]:', e);
        });
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        setFirstSegmentLoaded(true);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setHlsError(`Erreur Réseau HLS: ${data.details}`);
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              setHlsError(`Erreur Média HLS: ${data.details}`);
              hls.recoverMediaError();
              break;
            default:
              setHlsError(`Erreur Fatale HLS: ${data.details}`);
              hls.destroy();
              break;
          }
        }
      });
    } else {
      setHlsError('Ce navigateur ne supporte ni HLS.js ni HLS natif.');
    }
  };

  // Stop Session
  const handleStopTest = async () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = '';
    }
    if (sessionId) {
      try {
        await fetch(`/api/test/stalker-hls/${sessionId}/stop`, { method: 'POST' });
      } catch (_) {}
    }
    setSessionId(null);
    setVideoPlaying(false);
    setHlsJsManifestLoaded(false);
    setFirstSegmentLoaded(false);
    setSessionStatus((prev) => prev ? { ...prev, status: 'stopped', ffmpegRunning: false } : null);
  };

  const handleSelectChannel = (chId: string) => {
    setSelectedChannelId(chId);
    const found = channels.find((c) => c.id === chId);
    if (found?.streamUrl) {
      setCustomStreamUrl(found.streamUrl);
    }
  };

  return (
    <div className="flex-1 h-full w-full bg-[#030712] text-slate-100 flex flex-col overflow-y-auto p-4 md:p-6 lg:p-8 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 mb-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/10 text-white transition active:scale-95 cursor-pointer"
              title="Retour"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold font-mono uppercase">
                Module Isolé /player-test
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                REMUX ONLY (-c copy)
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight mt-1">
              Diagnostic & Banc de Test : Stalker MPEG-TS → FFmpeg Remux → HLS
            </h1>
          </div>
        </div>

        {/* FFmpeg Status Pill */}
        <div className="flex items-center gap-2">
          <div className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
            ffmpegInfo.installed 
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' 
              : 'bg-red-950/60 border-red-500/40 text-red-300'
          }`}>
            <Cpu className="w-4 h-4" />
            <span>FFmpeg: {ffmpegInfo.installed ? 'Installé (OK)' : 'Non disponible'}</span>
          </div>
        </div>
      </div>

      {/* Requirement 9: Notice if FFmpeg is missing on the environment */}
      {!isCheckingEnv && !ffmpegInfo.installed && (
        <div className="mb-6 p-4 rounded-2xl bg-red-950/50 border border-red-500/40 text-red-200 flex flex-col gap-2 shadow-xl">
          <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
            <AlertTriangle className="w-5 h-5" />
            FFmpeg n'est pas disponible sur ce serveur.
          </div>
          <div className="text-xs text-red-300 leading-relaxed">
            Environnement détecté : <span className="font-mono font-bold text-white">{ffmpegInfo.platform || 'linux'} ({ffmpegInfo.arch || 'x64'})</span> — Code d'erreur : <span className="font-mono font-bold text-amber-300">{ffmpegInfo.errorCode || 'ENOENT'}</span>.
          </div>
          <div className="text-xs text-slate-300 bg-black/40 p-3 rounded-xl border border-white/5 font-mono">
            Pour activer le remuxage HLS, FFmpeg doit être installé sur le système hôte (ex: <code className="text-emerald-400">apt-get install -y ffmpeg</code> ou binaire statique dans le conteneur).
          </div>
        </div>
      )}

      {/* Grid: Player & Controls vs. Diagnostic Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Column: Player & Configuration (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          
          {/* Video Player Box */}
          <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden border border-white/15 relative shadow-2xl flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              controls
              className="w-full h-full object-contain"
              onPlay={() => setVideoPlaying(true)}
              onPause={() => setVideoPlaying(false)}
            />

            {/* Video Status Badge Overlay */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 pointer-events-none">
              {sessionId && (
                <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider backdrop-blur-md border ${
                  videoPlaying
                    ? 'bg-emerald-500/80 border-emerald-400 text-white shadow-lg shadow-emerald-500/30'
                    : sessionStatus?.manifestExists || sessionStatus?.manifestGenerated
                    ? 'bg-indigo-500/80 border-indigo-400 text-white'
                    : 'bg-amber-500/80 border-amber-400 text-white animate-pulse'
                }`}>
                  {videoPlaying ? '● En Direct (HLS)' : (sessionStatus?.manifestExists || sessionStatus?.manifestGenerated) ? 'HLS Prêt' : 'Remuxing...'}
                </span>
              )}
            </div>

            {!sessionId && !isStarting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 p-6 text-center">
                <Radio className="w-12 h-12 text-indigo-400 mb-3 animate-pulse" />
                <div className="text-base font-bold text-white mb-1">Prêt pour le test de remuxage</div>
                <div className="text-xs text-slate-400 max-w-sm">
                  Sélectionnez un flux Stalker ci-dessous puis cliquez sur "Lancer le Remux FFmpeg".
                </div>
              </div>
            )}

            {isStarting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-6 text-center">
                <div className="w-10 h-10 border-3 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-3" />
                <div className="text-sm font-semibold text-white">Initialisation de la session FFmpeg...</div>
                <div className="text-xs text-slate-400 mt-1">Connexion unique au flux IPTV</div>
              </div>
            )}
          </div>

          {/* Test Controls & Input Form */}
          <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-5 backdrop-blur-xl flex flex-col gap-4 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-white flex items-center gap-2">
                <Tv className="w-4 h-4 text-indigo-400" />
                Configuration du Flux Stalker à tester
              </span>
              {activeServer && (
                <span className="text-xs text-slate-400 font-mono">
                  Serveur: {activeServer.name} ({activeServer.macAddress || 'MAC OK'})
                </span>
              )}
            </div>

            {/* Quick Channel Selector */}
            {channels && channels.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Choisir une chaîne depuis le portail actif :
                </label>
                <select
                  value={selectedChannelId}
                  onChange={(e) => handleSelectChannel(e.target.value)}
                  className="bg-black/50 border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- Sélectionner une chaîne --</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.number ? `${c.number}. ` : ''}{c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Stream URL (Raw) */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-300">
                URL du flux Stalker (ex: http://serveur/play/live.php?extension=ts...) :
              </label>
              <input
                type="text"
                value={customStreamUrl}
                onChange={(e) => setCustomStreamUrl(e.target.value)}
                placeholder="http://..."
                className="bg-black/50 border border-white/15 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
              />
              <div className="text-[10px] text-slate-400">
                Les tokens et adresses MAC sont traités de manière sécurisée côté backend et masqués des logs.
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {!sessionId ? (
                <button
                  id="btn-start-stalker-test"
                  onClick={handleStartTest}
                  disabled={isStarting || !ffmpegInfo.installed}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-500/25 transition active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Lancer le Remux FFmpeg (-c copy)</span>
                </button>
              ) : (
                <button
                  id="btn-stop-stalker-test"
                  onClick={handleStopTest}
                  className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-red-500/25 transition active:scale-95 cursor-pointer"
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span>Arrêter la session & nettoyer</span>
                </button>
              )}

              {sessionId && (
                <button
                  onClick={handleStartTest}
                  className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 transition active:scale-95 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Relancer le flux</span>
                </button>
              )}
            </div>

            {hlsError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{hlsError}</span>
              </div>
            )}
          </div>

          {/* Real-time FFmpeg Logs Box with Requirement 8 Live Stages */}
          <div className="bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-xl flex flex-col gap-2 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-xs font-bold text-slate-300">
                  État du pipeline FFmpeg :
                </span>
                <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded-full bg-white/5 border border-white/10 ${currentStage.color}`}>
                  {currentStage.label}
                </span>
              </div>
              <label className="text-[10px] text-slate-400 flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScrollLogs}
                  onChange={(e) => setAutoScrollLogs(e.target.checked)}
                  className="rounded bg-black/50 border-white/20 text-indigo-600 focus:ring-0"
                />
                Auto-scroll
              </label>
            </div>
            
            <div className="w-full h-44 bg-black/80 rounded-xl p-3 font-mono text-[11px] text-slate-300 overflow-y-auto border border-white/5 space-y-1">
              {sessionStatus?.logs && sessionStatus.logs.length > 0 ? (
                sessionStatus.logs.map((line, idx) => (
                  <div key={idx} className="leading-relaxed break-all">
                    {line}
                  </div>
                ))
              ) : (
                <div className="text-slate-500 italic p-2 flex flex-col gap-1">
                  <div className="font-bold text-slate-400">État : {currentStage.label}</div>
                  <div className="text-[10px] text-slate-600">
                    Les sorties stderr/stdout de FFmpeg s'afficheront ici en direct dès le lancement.
                  </div>
                </div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>

        {/* Right Column: Diagnostic Checklist (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          
          {/* Main Diagnostic Checklist Card */}
          <div className="bg-slate-900/90 border border-white/15 rounded-2xl p-5 backdrop-blur-2xl shadow-2xl flex flex-col gap-4">
            
            <div className="border-b border-white/10 pb-3">
              <div className="text-xs font-extrabold tracking-widest text-indigo-400 font-mono">
                ===== STALKER → HLS TEST =====
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Diagnostic temps-réel du pipeline de remuxage
              </div>
            </div>

            {/* Checklist Items */}
            <div className="space-y-2 text-xs">
              
              {/* 1. Upstream */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Upstream:</span>
                <span className="font-mono font-bold text-white">MPEG-TS (Stalker / MAG)</span>
              </div>

              {/* 2. Upstream reachable */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Upstream reachable:</span>
                <span className="flex items-center gap-1.5 font-bold">
                  {sessionStatus?.upstreamReachable ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Oui
                    </span>
                  ) : sessionStatus?.status === 'starting' || isStarting ? (
                    <span className="text-amber-400">Connexion...</span>
                  ) : (
                    <span className="text-slate-500">Non actif</span>
                  )}
                </span>
              </div>

              {/* 3. FFmpeg installed */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">FFmpeg installed:</span>
                <span className="flex items-center gap-1 font-bold">
                  {ffmpegInfo.installed ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Oui
                    </span>
                  ) : (
                    <span className="text-red-400 flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> Non
                    </span>
                  )}
                </span>
              </div>

              {/* FFmpeg version */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">FFmpeg version:</span>
                <span className="font-mono text-[11px] text-slate-300 truncate max-w-[200px]" title={ffmpegInfo.version}>
                  {ffmpegInfo.version.split(' ')[2] || ffmpegInfo.version}
                </span>
              </div>

              {/* Temp Directory Writable */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">TEMP DIRECTORY WRITABLE:</span>
                <span className="font-bold">
                  {sessionStatus?.tempDirectoryWritable !== undefined ? (
                    sessionStatus.tempDirectoryWritable ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Oui
                      </span>
                    ) : (
                      <span className="text-red-400 flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5" /> Non
                      </span>
                    )
                  ) : (
                    <span className="text-slate-500">En attente</span>
                  )}
                </span>
              </div>

              {/* 4. FFmpeg started */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">FFmpeg started:</span>
                <span className="font-bold">
                  {sessionStatus?.ffmpegStarted || sessionStatus?.pid ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Oui
                    </span>
                  ) : (
                    <span className="text-slate-500">Non</span>
                  )}
                </span>
              </div>

              {/* 5. FFmpeg PID */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">FFmpeg PID:</span>
                <span className="font-mono font-bold text-white">
                  {sessionStatus?.ffmpegPid || sessionStatus?.pid || '-'}
                </span>
              </div>

              {/* 6. Video codec input */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Video codec input:</span>
                <span className="font-mono font-bold text-sky-300">
                  {sessionStatus?.videoCodec || 'H.264 (attendu)'}
                </span>
              </div>

              {/* 7. Audio codec input */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Audio codec input:</span>
                <span className="font-mono font-bold text-purple-300">
                  {sessionStatus?.audioCodec || 'AAC (attendu)'}
                </span>
              </div>

              {/* 8. Video transcoding */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Video transcoding:</span>
                <span className="font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  NON (-c:v copy)
                </span>
              </div>

              {/* 9. Audio transcoding */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Audio transcoding:</span>
                <span className="font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  NON (-c:a copy)
                </span>
              </div>

              {/* 10. Mode */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Mode:</span>
                <span className="font-bold text-indigo-300">REMUX ONLY</span>
              </div>

              {/* 11. HLS manifest generated */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">HLS manifest generated:</span>
                <span className="font-bold">
                  {sessionStatus?.manifestExists || sessionStatus?.manifestGenerated ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Oui (index.m3u8)
                    </span>
                  ) : (
                    <span className="text-slate-500">Non</span>
                  )}
                </span>
              </div>

              {/* 12. Segments generated */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Segments generated:</span>
                <span className="font-bold">
                  {(sessionStatus?.segmentCount || sessionStatus?.segmentsCount || 0) > 0 ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Oui
                    </span>
                  ) : (
                    <span className="text-slate-500">Non</span>
                  )}
                </span>
              </div>

              {/* 13. Number of current segments */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Number of current segments:</span>
                <span className="font-mono font-bold text-white">
                  {sessionStatus?.segmentCount || sessionStatus?.segmentsCount || 0}
                </span>
              </div>

              {/* 14. Manifest URL */}
              <div className="flex flex-col gap-1 py-1 border-b border-white/5">
                <span className="text-slate-400">Manifest URL:</span>
                <span className="font-mono text-[10px] text-indigo-300 bg-black/50 p-1.5 rounded border border-white/10 break-all">
                  {sessionStatus?.manifestUrl || '/api/test/stalker-hls/[SESSION]/index.m3u8'}
                </span>
              </div>

              {/* 15. HLS.js manifest loaded */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">HLS.js manifest loaded:</span>
                <span className="font-bold">
                  {hlsJsManifestLoaded ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Oui
                    </span>
                  ) : (
                    <span className="text-slate-500">Non</span>
                  )}
                </span>
              </div>

              {/* 16. First segment loaded */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">First segment loaded:</span>
                <span className="font-bold">
                  {firstSegmentLoaded ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Oui
                    </span>
                  ) : (
                    <span className="text-slate-500">Non</span>
                  )}
                </span>
              </div>

              {/* 17. Video playing */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Video playing:</span>
                <span className="font-bold">
                  {videoPlaying ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Oui
                    </span>
                  ) : (
                    <span className="text-slate-500">Non</span>
                  )}
                </span>
              </div>

              {/* 18. Startup time */}
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-slate-400">Startup time:</span>
                <span className="font-mono font-bold text-amber-300">
                  {sessionStatus?.startupTimeMs ? `${sessionStatus.startupTimeMs} ms` : elapsedMs > 0 ? `${elapsedMs} ms` : '-'}
                </span>
              </div>

              {/* 19. FFmpeg error */}
              <div className="flex flex-col gap-1 py-1 border-b border-white/5">
                <span className="text-slate-400">FFmpeg error:</span>
                <span className={`font-mono text-[11px] ${sessionStatus?.lastError || sessionStatus?.errorMessage ? 'text-red-400 font-bold' : 'text-slate-500'}`}>
                  {sessionStatus?.lastError || sessionStatus?.errorMessage || 'Aucune erreur'}
                </span>
              </div>

              {/* 20. HLS.js error */}
              <div className="flex flex-col gap-1 py-1">
                <span className="text-slate-400">HLS.js error:</span>
                <span className={`font-mono text-[11px] ${hlsError ? 'text-red-400 font-bold' : 'text-slate-500'}`}>
                  {hlsError || 'Aucune erreur'}
                </span>
              </div>

            </div>

          </div>

          {/* Architecture Summary Note */}
          <div className="bg-indigo-950/30 border border-indigo-500/20 rounded-2xl p-4 text-xs text-slate-300 flex flex-col gap-2">
            <div className="font-bold text-indigo-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              Garantie d'Isolation & Performance
            </div>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
              <li>1 seule connexion IPTV active consommée par FFmpeg</li>
              <li>Aucun réencodage CPU (Flux H.264 & AAC copiés directement)</li>
              <li>Lecture HTTPS locale native via HLS.js / Safari PWA</li>
              <li>Zéro impact sur le lecteur LivePlayer standard & les flux M3U</li>
            </ul>
          </div>

        </div>

      </div>
    </div>
  );
};
