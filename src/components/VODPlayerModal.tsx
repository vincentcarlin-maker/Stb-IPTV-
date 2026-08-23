import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
import { 
  X, 
  Activity, 
  Film, 
  AlertCircle,
  Smartphone,
  Play,
  Pause,
  Volume2,
  Volume1,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  RotateCcw,
  RotateCw,
  Gauge,
  Check,
  Copy,
  MoreVertical,
  Sliders,
  Tv,
  Subtitles,
  Languages,
  ExternalLink,
  Zap,
  Globe,
  Radio,
  PlaySquare,
  ScreenShare
} from 'lucide-react';
import { openInDevicePlayer, DEVICE_PLAYER_LIST } from '../utils/devicePlayer';
import { isFullscreen as checkIsFullscreen, safeToggleFullscreen } from '../utils/fullscreen';

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

export interface AudioTrackItem {
  id: number;
  index: number;
  codec: string;
  channels: number | string;
  language: string;
  title: string;
}

export interface SubtitleTrackItem {
  id: number;
  index: number;
  codec: string;
  language: string;
  title: string;
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
  duration?: number;
  audioTracks?: AudioTrackItem[];
  subtitleTracks?: SubtitleTrackItem[];
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

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs < 10 ? '0' : ''}${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const VODPlayerModal: React.FC<VODPlayerModalProps> = ({
  title,
  rawStreamUrl,
  originalCmd,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const osdTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState<boolean>(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState<boolean>(false);
  const [playbackStatus, setPlaybackStatus] = useState<'PREPARING' | 'PLAYING' | 'PAUSED' | 'ERROR'>('PREPARING');

  // OSD Playback state
  const [showOSD, setShowOSD] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [probedDuration, setProbedDuration] = useState<number>(0);
  const [bufferedPercent, setBufferedPercent] = useState<number>(0);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);
  const [seekTime, setSeekTime] = useState<number>(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<number>(0);

  // Volume & Audio controls
  const [volume, setVolume] = useState<number>(100);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [aspectRatio, setAspectRatio] = useState<'fit' | '16:9' | 'fill' | '4:3' | 'stretch'>('fit');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isLandscapeMode, setIsLandscapeMode] = useState<boolean>(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  // Audio and Subtitle track state
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number>(0);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<number>(-1); // -1 = disabled

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

  // Trigger and auto-hide OSD
  const triggerOSD = useCallback(() => {
    setShowOSD(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !showDiagnostic && !showSpeedMenu && !showOptionsMenu) {
        setShowOSD(false);
      }
    }, 4000);
  }, [showDiagnostic, showSpeedMenu, showOptionsMenu]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(checkIsFullscreen());
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // Track video element events for accurate playback & timeline status
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlaying = () => {
      setPlaybackStatus('PLAYING');
      setIsPlaying(true);
      setIsLoading(false);
    };

    const handlePause = () => {
      setPlaybackStatus('PAUSED');
      setIsPlaying(false);
      setShowOSD(true);
    };

    const handleWaiting = () => {
      setPlaybackStatus('PREPARING');
      setIsLoading(true);
    };

    const handleError = () => {
      setPlaybackStatus('ERROR');
      setIsPlaying(false);
      setIsLoading(false);
    };

    const handleTimeUpdate = () => {
      if (!isSeeking) {
        setCurrentTime(video.currentTime);
      }
      if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      } else if (probedDuration > 0) {
        setDuration(probedDuration);
      }
    };

    const handleProgress = () => {
      const activeDuration = (video.duration && isFinite(video.duration) && video.duration > 0) ? video.duration : probedDuration;
      if (video.buffered.length > 0 && activeDuration > 0) {
        const end = video.buffered.end(video.buffered.length - 1);
        setBufferedPercent(Math.min(100, (end / activeDuration) * 100));
      }
    };

    const handleLoadedMetadata = () => {
      if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      } else if (probedDuration > 0) {
        setDuration(probedDuration);
      }
      setIsLoading(false);
    };

    video.addEventListener('playing', handlePlaying);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('error', handleError);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('progress', handleProgress);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('error', handleError);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('progress', handleProgress);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [isSeeking, probedDuration]);

  // Initialize VOD session on backend
  useEffect(() => {
    let active = true;
    let currentSessionId: string | null = null;

    const initVodSession = async () => {
      setIsLoading(true);
      setErrorMsg(null);
      setPlaybackStatus('PREPARING');
      triggerOSD();

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

          // Set probed real video duration
          const detectedDuration = data.diagnostic.duration || data.duration;
          if (detectedDuration && typeof detectedDuration === 'number' && detectedDuration > 0) {
            setProbedDuration(detectedDuration);
            setDuration(detectedDuration);
          }

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
  }, [rawStreamUrl, title, originalCmd, triggerOSD]);

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
            if (data.diagnostic.duration && data.diagnostic.duration > 0) {
              setProbedDuration(data.diagnostic.duration);
              setDuration((prev) => (prev > 0 ? prev : data.diagnostic.duration));
            }
          }
        }
      } catch (_) {}
    }, 2500);

    return () => clearInterval(interval);
  }, [sessionId]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekRelative(-10);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekRelative(10);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleVolumeChange(Math.min(100, volume + 5));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleVolumeChange(Math.max(0, volume - 5));
      } else if (e.key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'Escape' && !isFullscreen && !showOptionsMenu && !showDiagnostic) {
        handleClosePlayer();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, volume, isMuted, isFullscreen, showOptionsMenu, showDiagnostic]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
    } else {
      video.play().catch(() => {});
    }
    triggerOSD();
  };

  const seekRelative = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const maxDur = duration > 0 ? duration : video.duration || 0;
    const target = Math.max(0, Math.min(maxDur, video.currentTime + seconds));
    video.currentTime = target;
    setCurrentTime(target);
    triggerOSD();
  };

  const handleProgressBarMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const maxDur = duration > 0 ? duration : probedDuration;
    if (!progressBarRef.current || maxDur <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPos(pos * 100);
    setHoverTime(pos * maxDur);
  };

  const handleProgressBarMouseLeave = () => {
    setHoverTime(null);
  };

  const handleProgressBarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const maxDur = duration > 0 ? duration : probedDuration;
    if (!progressBarRef.current || maxDur <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = pos * maxDur;
    setIsSeeking(true);
    setSeekTime(target);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const moveRect = progressBarRef.current?.getBoundingClientRect();
      if (!moveRect) return;
      const movePos = Math.max(0, Math.min(1, (moveEvent.clientX - moveRect.left) / moveRect.width));
      setSeekTime(movePos * maxDur);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const upRect = progressBarRef.current?.getBoundingClientRect();
      if (upRect && videoRef.current) {
        const finalPos = Math.max(0, Math.min(1, (upEvent.clientX - upRect.left) / upRect.width));
        const finalTarget = finalPos * maxDur;
        videoRef.current.currentTime = finalTarget;
        setCurrentTime(finalTarget);
      }
      setIsSeeking(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      triggerOSD();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Mobile Touch Scrubbing on timeline
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const maxDur = duration > 0 ? duration : probedDuration;
    if (!progressBarRef.current || maxDur <= 0 || !e.touches[0]) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clientX = e.touches[0].clientX;
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const target = pos * maxDur;
    setIsSeeking(true);
    setSeekTime(target);
    triggerOSD();
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const maxDur = duration > 0 ? duration : probedDuration;
    if (!progressBarRef.current || maxDur <= 0 || !e.touches[0]) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clientX = e.touches[0].clientX;
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setSeekTime(pos * maxDur);
    triggerOSD();
  };

  const handleTouchEnd = () => {
    if (videoRef.current && isSeeking) {
      videoRef.current.currentTime = seekTime;
      setCurrentTime(seekTime);
    }
    setIsSeeking(false);
    triggerOSD();
  };

  const handleVolumeChange = (newVal: number) => {
    setVolume(newVal);
    if (videoRef.current) {
      videoRef.current.volume = newVal / 100;
      if (newVal > 0 && isMuted) {
        videoRef.current.muted = false;
        setIsMuted(false);
      }
    }
    triggerOSD();
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
    triggerOSD();
  };

  const setSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setShowSpeedMenu(false);
    triggerOSD();
  };

  const cycleAspectRatio = () => {
    const ratios: ('fit' | '16:9' | 'fill' | '4:3' | 'stretch')[] = ['fit', '16:9', 'fill', '4:3', 'stretch'];
    const nextIdx = (ratios.indexOf(aspectRatio) + 1) % ratios.length;
    setAspectRatio(ratios[nextIdx]);
    triggerOSD();
  };

  // Toggle Landscape Mode (Screen Orientation Lock or Fullscreen Landscape)
  const toggleLandscapeMode = async () => {
    const nextMode = !isLandscapeMode;
    setIsLandscapeMode(nextMode);

    try {
      if (typeof window !== 'undefined' && window.screen && window.screen.orientation) {
        if (nextMode) {
          if (typeof (window.screen.orientation as any).lock === 'function') {
            await (window.screen.orientation as any).lock('landscape').catch(() => {});
          }
          if (!isFullscreen && containerRef.current) {
            await safeToggleFullscreen(containerRef.current);
            setIsFullscreen(true);
          }
        } else {
          if (typeof (window.screen.orientation as any).unlock === 'function') {
            (window.screen.orientation as any).unlock();
          }
        }
      } else if (containerRef.current && !isFullscreen) {
        await safeToggleFullscreen(containerRef.current);
        setIsFullscreen(true);
      }
    } catch (e) {
      console.warn('Orientation lock error:', e);
    }
    triggerOSD();
  };

  const toggleFullscreen = async () => {
    const newState = await safeToggleFullscreen(containerRef.current);
    setIsFullscreen(newState);
    triggerOSD();
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        if (typeof document.exitPictureInPicture === 'function') {
          await document.exitPictureInPicture();
        }
      } else if (typeof videoRef.current.requestPictureInPicture === 'function') {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP error:', err);
    }
    triggerOSD();
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(rawStreamUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (_) {}
  };

  const handleClosePlayer = () => {
    if (sessionId) {
      fetch(`/api/vod/session/${sessionId}/stop`, { method: 'POST' }).catch(() => {});
    }
    onClose();
  };

  // Subtitle track selection
  const handleSelectSubtitleTrack = (index: number) => {
    setSelectedSubtitleTrack(index);
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = index;
    }
    if (videoRef.current && videoRef.current.textTracks) {
      for (let i = 0; i < videoRef.current.textTracks.length; i++) {
        videoRef.current.textTracks[i].mode = i === index ? 'showing' : 'disabled';
      }
    }
  };

  // Audio track selection
  const handleSelectAudioTrack = (index: number) => {
    setSelectedAudioTrack(index);
    if (hlsRef.current) {
      hlsRef.current.audioTrack = index;
    }
  };

  const getVideoClass = () => {
    switch (aspectRatio) {
      case '16:9':
        return 'w-full h-full object-contain aspect-video';
      case '4:3':
        return 'w-auto h-full aspect-[4/3] mx-auto object-contain';
      case 'fill':
        return 'w-full h-full object-cover';
      case 'stretch':
        return 'w-full h-full object-fill';
      case 'fit':
      default:
        return 'w-full h-full object-contain';
    }
  };

  const effectiveDuration = duration > 0 ? duration : probedDuration;
  const activeCurrentTime = isSeeking ? seekTime : currentTime;
  const currentProgressPercent = effectiveDuration > 0 ? Math.min(100, (activeCurrentTime / effectiveDuration) * 100) : 0;

  const modalContent = (
    <div
      ref={containerRef}
      id="vod-player-modal-container"
      onMouseMove={triggerOSD}
      onClick={triggerOSD}
      className={`fixed inset-0 z-[99999] bg-black flex flex-col justify-between overflow-hidden select-none ${
        isLandscapeMode && !isFullscreen ? 'rotate-0 md:rotate-0' : ''
      }`}
    >
      {/* Top OSD Header Bar */}
      <div
        className={`absolute top-0 inset-x-0 z-40 p-3 sm:p-4 bg-gradient-to-b from-black/95 via-black/75 to-transparent flex items-center justify-between gap-2 sm:gap-3 transition-opacity duration-300 ${
          showOSD ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0 shadow-md">
            <Film className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xs sm:text-sm font-bold text-white truncate drop-shadow">{title}</h3>
            <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] text-slate-300">
              <span className="font-semibold text-indigo-400">VOD</span>
              <span className="w-1 h-1 rounded-full bg-slate-500 shrink-0"></span>
              <span className="text-emerald-400 font-semibold shrink-0">{diagnostic.strategy}</span>
              {effectiveDuration > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-slate-500 shrink-0"></span>
                  <span className="text-amber-300 font-mono font-semibold shrink-0">{formatTime(effectiveDuration)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Quick Landscape Mode Button (Mobile/Tablet) */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleLandscapeMode();
            }}
            className={`p-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border ${
              isLandscapeMode
                ? 'bg-indigo-600 text-white border-indigo-400 shadow-md'
                : 'bg-white/10 text-slate-200 border-white/10 hover:bg-white/20'
            }`}
            title="Mode Paysage / Rotation"
          >
            <ScreenShare className="w-4 h-4" />
            <span className="hidden md:inline">Paysage</span>
          </button>

          {/* More Options Menu Button ("...") */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowOptionsMenu(!showOptionsMenu);
            }}
            className={`p-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border ${
              showOptionsMenu
                ? 'bg-indigo-600 text-white border-indigo-400 shadow-md shadow-indigo-500/20'
                : 'bg-white/10 text-slate-200 border-white/10 hover:bg-white/20'
            }`}
            title="Options de lecture et réglages (...)"
          >
            <MoreVertical className="w-4 h-4" />
            <span className="hidden sm:inline">Options</span>
          </button>

          {/* Close Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClosePlayer();
            }}
            className="p-2 rounded-xl bg-white/10 hover:bg-rose-500/20 hover:border-rose-500/40 text-white transition cursor-pointer border border-white/10 active:scale-95"
            title="Fermer le lecteur"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Video Viewport */}
      <div 
        className="relative flex-1 bg-black flex items-center justify-center min-h-0 cursor-pointer"
        onClick={togglePlay}
      >
        {/* Loading Spinner */}
        {isLoading && (
          <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4 pointer-events-auto">
            <div className="w-12 h-12 border-3 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
            <p className="text-xs font-bold text-white mb-1">Démarrage du flux VOD...</p>
            <p className="text-[11px] text-slate-400 font-mono">{diagnostic.strategy} ({diagnostic.container})</p>
          </div>
        )}

        {/* Error Overlay */}
        {errorMsg && (
          <div className="absolute inset-0 z-20 bg-black/90 flex flex-col items-center justify-center p-6 text-center pointer-events-auto">
            <AlertCircle className="w-12 h-12 text-rose-400 mb-3" />
            <h4 className="text-sm font-bold text-white mb-1">Erreur de lecture VOD</h4>
            <p className="text-xs text-rose-300/80 mb-4 max-w-md break-words">{errorMsg}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openInDevicePlayer(rawStreamUrl, title, 'vlc');
                }}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-lg"
              >
                <Smartphone className="w-4 h-4" />
                Ouvrir dans VLC
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowOptionsMenu(true);
                }}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer"
              >
                <Sliders className="w-4 h-4" />
                Choisir une application
              </button>
            </div>
          </div>
        )}

        {/* HTML5 Video Element */}
        <video
          ref={videoRef}
          playsInline
          preload="auto"
          className={getVideoClass()}
          onDoubleClick={toggleFullscreen}
        />

        {/* ========================================================================= */}
        {/* MODAL / DRAWER DES OPTIONS "..." (USER REQUEST COMPLETE MENU)           */}
        {/* ========================================================================= */}
        {showOptionsMenu && (
          <div
            className="absolute inset-0 z-50 bg-black/75 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-auto"
            onClick={() => setShowOptionsMenu(false)}
          >
            <div
              className="w-full sm:max-w-xl max-h-[85vh] overflow-y-auto bg-slate-950/98 border border-white/15 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl backdrop-blur-2xl text-white space-y-5 animate-in slide-in-from-bottom duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Menu Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/30 text-indigo-400 border border-indigo-500/40 flex items-center justify-center">
                    <Sliders className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-sm text-white">Options & Paramètres de lecture</h3>
                </div>
                <button
                  onClick={() => setShowOptionsMenu(false)}
                  className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 1. Mode Paysage (Rotation écran) */}
              <div>
                <label className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                  <ScreenShare className="w-3.5 h-3.5" />
                  Orientation & Écran
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={toggleLandscapeMode}
                    className={`p-3 rounded-2xl border text-left transition flex items-center justify-between cursor-pointer ${
                      isLandscapeMode
                        ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                        : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <ScreenShare className="w-4 h-4 text-indigo-400" />
                        Mode Paysage
                      </div>
                      <div className="text-[10px] text-slate-400">Verrouiller ou forcer l'orientation</div>
                    </div>
                    {isLandscapeMode && <Check className="w-4 h-4 text-indigo-400" />}
                  </button>

                  <button
                    onClick={toggleFullscreen}
                    className={`p-3 rounded-2xl border text-left transition flex items-center justify-between cursor-pointer ${
                      isFullscreen
                        ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                        : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Maximize className="w-4 h-4 text-emerald-400" />
                        Plein Écran
                      </div>
                      <div className="text-[10px] text-slate-400">Occuper tout l'écran</div>
                    </div>
                    {isFullscreen && <Check className="w-4 h-4 text-emerald-400" />}
                  </button>
                </div>
              </div>

              {/* 2. Format de l'image (Aspect Ratio) */}
              <div>
                <label className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                  <Tv className="w-3.5 h-3.5" />
                  Format de l'image (Aspect Ratio)
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {[
                    { id: 'fit', label: 'Original', desc: 'Fit standard' },
                    { id: '16:9', label: '16:9', desc: 'Écran large' },
                    { id: '4:3', label: '4:3', desc: 'Classique' },
                    { id: 'fill', label: 'Plein', desc: 'Zoom / Cover' },
                    { id: 'stretch', label: 'Étiré', desc: '100% écran' },
                  ].map((fmt) => (
                    <button
                      key={fmt.id}
                      onClick={() => setAspectRatio(fmt.id as any)}
                      className={`p-2 rounded-xl border text-center transition cursor-pointer ${
                        aspectRatio === fmt.id
                          ? 'bg-indigo-600 text-white border-indigo-400 shadow-md'
                          : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                      }`}
                    >
                      <div className="text-xs font-bold">{fmt.label}</div>
                      <div className="text-[9px] text-slate-400 truncate">{fmt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Pistes Audio (si disponibles) */}
              <div>
                <label className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                  <Languages className="w-3.5 h-3.5" />
                  Piste Audio {diagnostic.audioTracks && `(${diagnostic.audioTracks.length} détectée${diagnostic.audioTracks.length > 1 ? 's' : ''})`}
                </label>
                {diagnostic.audioTracks && diagnostic.audioTracks.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {diagnostic.audioTracks.map((track) => (
                      <button
                        key={track.id}
                        onClick={() => handleSelectAudioTrack(track.id)}
                        className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                          selectedAudioTrack === track.id
                            ? 'bg-indigo-600/30 border-indigo-500 text-white'
                            : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-bold">{track.title}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{track.codec.toUpperCase()} • {track.channels} ch</div>
                        </div>
                        {selectedAudioTrack === track.id && <Check className="w-4 h-4 text-indigo-400" />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-400 flex items-center gap-2">
                    <Radio className="w-4 h-4 text-slate-500" />
                    Piste audio par défaut ({diagnostic.audioCodec || 'AAC'})
                  </div>
                )}
              </div>

              {/* 4. Sous-titres (si disponibles) */}
              <div>
                <label className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                  <Subtitles className="w-3.5 h-3.5" />
                  Sous-titres {diagnostic.subtitleTracks && `(${diagnostic.subtitleTracks.length} disponible${diagnostic.subtitleTracks.length > 1 ? 's' : ''})`}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <button
                    onClick={() => handleSelectSubtitleTrack(-1)}
                    className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                      selectedSubtitleTrack === -1
                        ? 'bg-indigo-600/30 border-indigo-500 text-white'
                        : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                    }`}
                  >
                    <span className="text-xs font-bold">Désactivé</span>
                    {selectedSubtitleTrack === -1 && <Check className="w-4 h-4 text-indigo-400" />}
                  </button>

                  {diagnostic.subtitleTracks && diagnostic.subtitleTracks.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => handleSelectSubtitleTrack(sub.id)}
                      className={`p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                        selectedSubtitleTrack === sub.id
                          ? 'bg-indigo-600/30 border-indigo-500 text-white'
                          : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                      }`}
                    >
                      <div>
                        <div className="text-xs font-bold">{sub.title}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{sub.codec.toUpperCase()}</div>
                      </div>
                      {selectedSubtitleTrack === sub.id && <Check className="w-4 h-4 text-indigo-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* 5. Ouvrir dans une Application Mobile */}
              <div>
                <label className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5" />
                  Ouvrir dans une application mobile
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DEVICE_PLAYER_LIST.map((player) => (
                    <button
                      key={player.id}
                      onClick={() => openInDevicePlayer(rawStreamUrl, title, player.id)}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition text-left cursor-pointer active:scale-95 group"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs border ${player.color}`}>
                          <PlaySquare className="w-3.5 h-3.5" />
                        </div>
                        <div className="text-xs font-bold text-white truncate">{player.name}</div>
                      </div>
                      <div className="text-[9px] text-slate-400 truncate">{player.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 6. URL de la vidéo & Copie */}
              <div>
                <label className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5" />
                    URL du flux vidéo
                  </span>
                  <button
                    onClick={copyUrl}
                    className="text-xs text-indigo-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedUrl ? 'Lien copié !' : 'Copier le lien'}
                  </button>
                </label>
                <div className="p-2.5 rounded-xl bg-black/60 border border-white/10 text-[11px] font-mono break-all text-slate-300 select-all max-h-20 overflow-y-auto">
                  {rawStreamUrl}
                </div>
              </div>

              {/* 7. Bouton Diagnostic Technique */}
              <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                <button
                  onClick={() => {
                    setShowOptionsMenu(false);
                    setShowDiagnostic(true);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-xs font-bold transition flex items-center gap-2 cursor-pointer w-full justify-center"
                >
                  <Activity className="w-4 h-4 text-indigo-400" />
                  Ouvrir le Diagnostic Technique Complet
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Diagnostic Panel Overlay (Opened via button or Options menu) */}
        {showDiagnostic && (
          <div 
            className="absolute top-16 left-3 sm:left-4 z-40 w-72 sm:w-96 max-h-[70vh] overflow-y-auto bg-slate-950/98 border border-indigo-500/30 rounded-2xl p-4 shadow-2xl backdrop-blur-xl font-mono text-[11px] text-slate-200 pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-indigo-500/20">
              <span className="font-bold text-indigo-400 text-xs flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                DIAGNOSTIC TECHNIQUE VOD
              </span>
              <button 
                onClick={() => setShowDiagnostic(false)} 
                className="text-slate-400 hover:text-white cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            {/* Diagnostic Technical Specs */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">FFPROBE :</span>
                <span className={`font-bold ${diagnostic.ffprobeStatus === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {diagnostic.ffprobeStatus || 'FAILED'}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Durée Réelle :</span>
                <span className="font-bold text-amber-300 font-mono">
                  {effectiveDuration > 0 ? `${formatTime(effectiveDuration)} (${Math.round(effectiveDuration)}s)` : 'En cours d\'analyse...'}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Conteneur Source :</span>
                <span className="font-bold text-white">{diagnostic.container}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Codec Vidéo :</span>
                <span className="font-bold text-emerald-400">{diagnostic.videoCodec}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Codec Audio :</span>
                <span className="font-bold text-sky-400">{diagnostic.audioCodec}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-400">Stratégie Flux :</span>
                <span className="font-bold text-amber-300">{diagnostic.strategy}</span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-400">Transcodage Vidéo :</span>
                <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${
                  diagnostic.videoTranscoding 
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {diagnostic.videoTranscoding ? 'OUI' : 'NON'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Transcodage Audio :</span>
                <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${
                  diagnostic.audioTranscoding 
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {diagnostic.audioTranscoding ? 'OUI' : 'NON'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Segments HLS Prêts :</span>
                <span className="font-bold text-indigo-300">
                  {typeof diagnostic.segmentsReady === 'number' && !isNaN(diagnostic.segmentsReady) ? diagnostic.segmentsReady : 0}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">État du lecteur :</span>
                <span className={`font-bold flex items-center gap-1.5 ${
                  playbackStatus === 'PLAYING' ? 'text-emerald-400' : playbackStatus === 'ERROR' ? 'text-rose-400' : 'text-amber-400'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    playbackStatus === 'PLAYING' ? 'bg-emerald-400 animate-pulse' : playbackStatus === 'ERROR' ? 'bg-rose-400' : 'bg-amber-400'
                  }`}></span>
                  {playbackStatus}
                </span>
              </div>

              {/* URL Section */}
              <div className="pt-2 border-t border-indigo-500/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400 text-[10px]">URL du flux :</span>
                  <button
                    onClick={copyUrl}
                    className="text-[10px] text-indigo-300 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {copiedUrl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedUrl ? 'Copié' : 'Copier'}
                  </button>
                </div>
                <div className="p-2 rounded bg-black/60 border border-white/10 text-[10px] break-all max-h-16 overflow-y-auto text-slate-300 select-all">
                  {rawStreamUrl}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM OSD PLAYBACK BAR - ALWAYS ON TOP WITH SAFE-AREA PADDING */}
      <div
        className={`absolute bottom-0 inset-x-0 z-40 bg-gradient-to-t from-black/95 via-black/85 to-transparent px-3 sm:px-5 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom)+0.75rem)] transition-opacity duration-300 ${
          showOSD ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Scrubber / Progress Bar Container */}
        <div className="mb-2.5 sm:mb-3">
          <div
            ref={progressBarRef}
            onMouseMove={handleProgressBarMouseMove}
            onMouseLeave={handleProgressBarMouseLeave}
            onMouseDown={handleProgressBarMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="group relative h-2.5 sm:h-2 hover:h-4 bg-white/20 rounded-full cursor-pointer transition-all duration-150 flex items-center py-2 -my-2"
          >
            {/* Inner background bar */}
            <div className="absolute inset-x-0 h-2 group-hover:h-3 rounded-full bg-white/20 overflow-hidden transition-all duration-150">
              {/* Buffered Bar */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-white/30 rounded-full transition-all duration-200"
                style={{ width: `${bufferedPercent}%` }}
              />

              {/* Played Bar */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full"
                style={{ width: `${currentProgressPercent}%` }}
              />
            </div>

            {/* Hover Tooltip Timestamp */}
            {hoverTime !== null && (
              <div
                className="absolute -top-8 -translate-x-1/2 bg-slate-900 border border-white/20 px-2 py-0.5 rounded-md text-[10px] font-mono text-white pointer-events-none shadow-lg z-50 whitespace-nowrap"
                style={{ left: `${hoverPos}%` }}
              >
                {formatTime(hoverTime)}
              </div>
            )}

            {/* Scrubber Thumb Handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 sm:w-3.5 sm:h-3.5 bg-white rounded-full shadow-md scale-100 sm:scale-0 group-hover:scale-100 transition-transform duration-150 pointer-events-none border-2 border-indigo-500"
              style={{ left: `${currentProgressPercent}%` }}
            />
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between gap-2 text-white">
          {/* Left Controls: Play/Pause, Rewind, Forward, Time Display */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            {/* Play/Pause Button */}
            <button
              onClick={togglePlay}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/25 transition active:scale-95 cursor-pointer shrink-0"
              title={isPlaying ? 'Pause (Espace / K)' : 'Lecture (Espace / K)'}
            >
              {isPlaying ? <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-white" /> : <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-white ml-0.5" />}
            </button>

            {/* Jump -10s */}
            <button
              onClick={() => seekRelative(-10)}
              className="p-1.5 sm:p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white transition cursor-pointer active:scale-95"
              title="Reculer de 10 secondes (Flèche Gauche)"
            >
              <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            {/* Jump +10s */}
            <button
              onClick={() => seekRelative(10)}
              className="p-1.5 sm:p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white transition cursor-pointer active:scale-95"
              title="Avancer de 10 secondes (Flèche Droite)"
            >
              <RotateCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            {/* Volume Control */}
            <div className="flex items-center gap-1 group/vol">
              <button
                onClick={toggleMute}
                className="p-1.5 sm:p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white transition cursor-pointer"
                title={isMuted ? 'Activer le son (M)' : 'Couper le son (M)'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-rose-400" />
                ) : volume < 50 ? (
                  <Volume1 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-200" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-200" />
                )}
              </button>

              <input
                type="range"
                min="0"
                max="100"
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="w-12 sm:w-20 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500 hidden md:block"
                title={`Volume : ${isMuted ? 0 : volume}%`}
              />
            </div>

            {/* Time Display (Real Duration) */}
            <div className="text-[11px] sm:text-xs font-mono text-slate-300 ml-1 sm:ml-2 whitespace-nowrap">
              <span className="text-white font-semibold">{formatTime(activeCurrentTime)}</span>
              <span className="text-slate-500 mx-1">/</span>
              <span className="text-amber-300 font-semibold">{formatTime(effectiveDuration)}</span>
            </div>
          </div>

          {/* Right Controls: Speed, Format, Fullscreen, "..." Menu */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Playback Speed Menu */}
            <div className="relative">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className={`px-2 sm:px-2.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold transition flex items-center gap-1 cursor-pointer border ${
                  playbackRate !== 1
                    ? 'bg-indigo-600/40 text-indigo-300 border-indigo-500/40'
                    : 'bg-white/10 text-slate-300 border-white/10 hover:bg-white/20'
                }`}
                title="Vitesse de lecture"
              >
                <Gauge className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span>{playbackRate}x</span>
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-2 bg-slate-950/95 border border-white/15 rounded-2xl p-1.5 shadow-2xl backdrop-blur-xl flex flex-col gap-1 z-50 min-w-[90px]">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => setSpeed(rate)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold text-left transition cursor-pointer ${
                        playbackRate === rate
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {rate}x {rate === 1 && '(Normal)'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Aspect Ratio Cycle */}
            <button
              onClick={cycleAspectRatio}
              className="px-2 sm:px-2.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold bg-white/10 hover:bg-white/20 text-slate-300 border border-white/10 transition cursor-pointer uppercase hidden xs:inline-block"
              title="Changer le format d'image"
            >
              {aspectRatio === 'fill' ? 'Plein' : aspectRatio === 'fit' ? 'Fit' : aspectRatio === 'stretch' ? 'Étiré' : aspectRatio}
            </button>

            {/* Picture in Picture */}
            <button
              onClick={togglePiP}
              className="p-1.5 sm:p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white border border-white/10 transition cursor-pointer hidden sm:block"
              title="Mode Image dans l'Image (PiP)"
            >
              <PictureInPicture2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 sm:p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white border border-white/10 transition cursor-pointer active:scale-95"
              title={isFullscreen ? 'Quitter le Plein Écran (F)' : 'Plein Écran (F)'}
            >
              {isFullscreen ? <Minimize className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Maximize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
            </button>

            {/* "..." Options Menu Button */}
            <button
              onClick={() => setShowOptionsMenu(!showOptionsMenu)}
              className="p-1.5 sm:p-2 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 transition cursor-pointer active:scale-95"
              title="Plus d'options (...)"
            >
              <MoreVertical className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
