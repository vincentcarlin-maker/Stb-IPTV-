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
import { useIPTV } from '../context/IPTVContext';
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

export interface BufferedRange {
  start: number;
  end: number;
  startPercent: number;
  widthPercent: number;
}

export interface VodDiagnosticInfo {
  ffprobeStatus?: 'SUCCESS' | 'FAILED' | string;
  container: string;
  videoCodec: string;
  videoProfile?: string;
  pixFmt?: string;
  resolution?: string;
  isHdr?: 'YES' | 'NO';
  colorTransfer?: string;
  colorSpace?: string;
  colorPrimaries?: string;
  bitRate?: string;
  audioCodec: string;
  audioChannels?: string | number;
  strategy: 'DIRECT' | 'REMUX_COPY_COPY' | 'VIDEO_COPY_AUDIO_AAC' | 'HEVC_COPY_COPY' | 'HEVC_COPY_AUDIO_AAC' | 'TRANSCODE_4K_TO_1080P_H264' | 'TRANSCODE_H264_AAC' | 'PROBE_FAILED' | string;
  videoTranscoding: boolean;
  audioTranscoding: boolean;
  output: string;
  videoTag?: string;
  segmentsReady: number;
  ffmpegSpeed: string;
  timeToPlayable: string;
  timeToFirstSegment?: string;
  player: 'NATIVE_HLS' | 'HLS_JS' | 'NATIVE_HTML5';
  status: 'PREPARING' | 'READY' | 'PLAYING' | 'ERROR' | 'STOPPED' | string;
  duration?: number;
  audioTracks?: AudioTrackItem[];
  subtitleTracks?: SubtitleTrackItem[];
  errorDetails?: string;
  probeError?: string;
  vodResolutionDiag?: VodResolutionDiag;
  ffmpegExitCode?: number | null;
  ffmpegLastError?: string;
  sourceHttpStatus?: number | string;
  hevcCopyResult?: 'SUCCESS' | 'FAILED' | 'NOT_APPLICABLE';
  playerError?: string;
}

interface VODPlayerModalProps {
  title: string;
  rawStreamUrl: string;
  originalCmd?: string;
  onClose: () => void;
  // watch history info
  itemId?: string;
  itemType?: 'movie' | 'series';
  episodeId?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  poster?: string;
  backdrop?: string;
  category?: string;
  releaseYear?: number | string;
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
  itemId,
  itemType,
  episodeId,
  episodeTitle,
  seasonNumber,
  episodeNumber,
  poster,
  backdrop,
  category,
  releaseYear,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const osdTimerRef = useRef<NodeJS.Timeout | null>(null);

  const { saveVODProgress, getVODProgress } = useIPTV();
  const [showResumePrompt, setShowResumePrompt] = useState<boolean>(false);
  const [savedProgress, setSavedProgress] = useState<number>(0);
  const hasCheckedProgressRef = useRef<boolean>(false);
  const showResumePromptRef = useRef<boolean>(false);
  showResumePromptRef.current = showResumePrompt;

  // Video resolution state (from video element or diagnostic ffprobe)
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    if (itemId && !hasCheckedProgressRef.current) {
      hasCheckedProgressRef.current = true;
      const progItem = getVODProgress(itemId, episodeId);
      if (progItem && progItem.progress > 5 && progItem.progress < progItem.duration - 10) {
        setSavedProgress(progItem.progress);
        setShowResumePrompt(true);
      }
    }
  }, [itemId, episodeId, getVODProgress]);

  useEffect(() => {
    if (showResumePrompt && videoRef.current) {
      videoRef.current.pause();
    }
  }, [showResumePrompt]);

  const lastSavedTimeRef = useRef<number>(0);

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
  const [bufferedRanges, setBufferedRanges] = useState<BufferedRange[]>([]);
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

  const showDiagnosticRef = useRef(showDiagnostic);
  showDiagnosticRef.current = showDiagnostic;
  const showSpeedMenuRef = useRef(showSpeedMenu);
  showSpeedMenuRef.current = showSpeedMenu;
  const showOptionsMenuRef = useRef(showOptionsMenu);
  showOptionsMenuRef.current = showOptionsMenu;

  // Trigger and auto-hide OSD (Stable, does not cause effects to re-run)
  const triggerOSD = useCallback(() => {
    setShowOSD(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !showDiagnosticRef.current && !showSpeedMenuRef.current && !showOptionsMenuRef.current) {
        setShowOSD(false);
      }
    }, 4000);
  }, []);

  // Toggle OSD visibility on tap/click without altering playback state
  const toggleOSD = useCallback(() => {
    setShowOSD((prev) => {
      const next = !prev;
      if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
      if (next) {
        osdTimerRef.current = setTimeout(() => {
          if (videoRef.current && !videoRef.current.paused && !showDiagnosticRef.current && !showSpeedMenuRef.current && !showOptionsMenuRef.current) {
            setShowOSD(false);
          }
        }, 4000);
      }
      return next;
    });
  }, []);

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
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
      }
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

    const updateBufferedInfo = () => {
      const activeDuration = (video.duration && isFinite(video.duration) && video.duration > 0) ? video.duration : probedDuration;
      if (activeDuration <= 0) return;

      if (video.buffered && video.buffered.length > 0) {
        const ranges: BufferedRange[] = [];
        let maxBufferedEnd = 0;
        for (let i = 0; i < video.buffered.length; i++) {
          const start = video.buffered.start(i);
          const end = video.buffered.end(i);
          if (end > maxBufferedEnd) maxBufferedEnd = end;
          const startPercent = Math.max(0, Math.min(100, (start / activeDuration) * 100));
          const endPercent = Math.max(0, Math.min(100, (end / activeDuration) * 100));
          const widthPercent = Math.max(0, endPercent - startPercent);
          if (widthPercent > 0) {
            ranges.push({ start, end, startPercent, widthPercent });
          }
        }
        setBufferedRanges(ranges);
        setBufferedPercent(Math.min(100, (maxBufferedEnd / activeDuration) * 100));
      }
    };

    const handleTimeUpdate = () => {
      if (!isSeeking) {
        setCurrentTime(video.currentTime);
      }
      const dur = video.duration || duration || probedDuration || 0;
      if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      } else if (probedDuration > 0) {
        setDuration(probedDuration);
      }
      updateBufferedInfo();

      // Save progress to watch history periodically (every 5 seconds)
      const currentSec = Math.floor(video.currentTime);
      if (itemId && Math.abs(currentSec - lastSavedTimeRef.current) >= 5 && dur > 0) {
        lastSavedTimeRef.current = currentSec;
        saveVODProgress({
          id: itemId + (episodeId ? `-${episodeId}` : ''),
          itemType: itemType || 'movie',
          itemId,
          title,
          episodeId,
          episodeTitle,
          seasonNumber,
          episodeNumber,
          poster,
          backdrop,
          category: category || 'VOD',
          progress: video.currentTime,
          duration: dur,
          completed: video.currentTime / dur > 0.9,
          streamUrl: rawStreamUrl,
          originalCmd,
        });
      }
    };

    const handleProgress = () => {
      updateBufferedInfo();
    };

    const handleLoadedMetadata = () => {
      if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      } else if (probedDuration > 0) {
        setDuration(probedDuration);
      }
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
      }
      updateBufferedInfo();
      setIsLoading(false);
    };

    video.addEventListener('playing', handlePlaying);
    video.addEventListener('pause', handlePause);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('error', handleError);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('progress', handleProgress);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('seeked', handleProgress);

    return () => {
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('error', handleError);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('progress', handleProgress);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('seeked', handleProgress);
    };
  }, [isSeeking, probedDuration]);

  // Initialize VOD session on backend
  const [isFallbackMode, setIsFallbackMode] = useState<boolean>(false);
  const [fallbackToast, setFallbackToast] = useState<string | null>(null);

  const initVodSession = useCallback(async (forceFallback = false) => {
    setIsLoading(true);
    setErrorMsg(null);
    setPlaybackStatus('PREPARING');
    triggerOSD();

    try {
      const response = await fetch('/api/vod/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawStreamUrl, title, originalCmd, fallback: forceFallback })
      });

      if (!response.ok) {
        throw new Error(`Erreur serveur (${response.status})`);
      }

      const data = await response.json();

      if (data.sessionId) {
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
          if (showResumePromptRef.current) {
            videoEl.pause();
          } else {
            videoEl.play().catch(() => {});
          }
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
            setIsLoading(false);
            setDiagnostic((prev) => ({ ...prev, player: 'HLS_JS' }));
            if (showResumePromptRef.current) {
              videoEl.pause();
            } else {
              videoEl.play().catch(() => {});
            }
          });

          hls.on(Hls.Events.BUFFER_APPENDED, () => {
            if (videoEl) {
              const activeDur = (videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > 0) ? videoEl.duration : probedDuration;
              if (activeDur > 0 && videoEl.buffered && videoEl.buffered.length > 0) {
                const ranges: BufferedRange[] = [];
                let maxEnd = 0;
                for (let i = 0; i < videoEl.buffered.length; i++) {
                  const start = videoEl.buffered.start(i);
                  const end = videoEl.buffered.end(i);
                  if (end > maxEnd) maxEnd = end;
                  const startPct = Math.max(0, Math.min(100, (start / activeDur) * 100));
                  const endPct = Math.max(0, Math.min(100, (end / activeDur) * 100));
                  const widthPct = Math.max(0, endPct - startPct);
                  if (widthPct > 0) {
                    ranges.push({ start, end, startPercent: startPct, widthPercent: widthPct });
                  }
                }
                setBufferedRanges(ranges);
                setBufferedPercent(Math.min(100, (maxEnd / activeDur) * 100));
              }
            }
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              console.warn('[VOD HLS.js Fatal Error]', data);
              // Automatic fallback for unsupported HEVC hardware decoding in browser
              if (!forceFallback && (data.details === 'bufferAppendError' || data.type === Hls.ErrorTypes.MEDIA_ERROR)) {
                console.warn('[VOD Player] HEVC playback buffer error detected. Attempting fallback transcode to 1080p H.264...');
                setFallbackToast("Décodage matériel HEVC non supporté par ce navigateur. Basculement automatique en 1080p H.264...");
                setTimeout(() => setFallbackToast(null), 6000);
                setIsFallbackMode(true);
                initVodSession(true);
                return;
              }

              setErrorMsg(`Erreur de flux vidéo HLS (${data.type})`);
              setIsLoading(false);
              setPlaybackStatus('ERROR');
              setDiagnostic(prev => ({
                ...prev,
                playerError: `${data.type} - ${data.details || 'fatal error'}`
              }));
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
      console.error('[VOD Player Init Error]', err);
      setErrorMsg(err.message || 'Impossible d\'initialiser la VOD');
      setIsLoading(false);
      setPlaybackStatus('ERROR');
    }
  }, [rawStreamUrl, title, originalCmd, probedDuration, triggerOSD]);

  useEffect(() => {
    initVodSession(false);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (sessionId) {
        fetch(`/api/vod/session/${sessionId}/stop`, { method: 'POST' }).catch(() => {});
      }
    };
  }, [rawStreamUrl, initVodSession, sessionId]);

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
    if (videoRef.current && itemId) {
      const dur = videoRef.current.duration || duration || probedDuration || 0;
      if (dur > 0) {
        saveVODProgress({
          id: itemId + (episodeId ? `-${episodeId}` : ''),
          itemType: itemType || 'movie',
          itemId,
          title,
          episodeId,
          episodeTitle,
          seasonNumber,
          episodeNumber,
          poster,
          backdrop,
          category: category || 'VOD',
          progress: videoRef.current.currentTime,
          duration: dur,
          completed: videoRef.current.currentTime / dur > 0.9,
          streamUrl: rawStreamUrl,
          originalCmd,
        });
      }
    }
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

  // Compute video resolution & quality tier (4K, FHD, HD, SD)
  let streamWidth = videoDimensions.width > 0 ? videoDimensions.width : 0;
  let streamHeight = videoDimensions.height > 0 ? videoDimensions.height : 0;

  if ((streamWidth === 0 || streamHeight === 0) && diagnostic.resolution) {
    const parts = diagnostic.resolution.split('x');
    if (parts.length === 2) {
      const w = parseInt(parts[0], 10);
      const h = parseInt(parts[1], 10);
      if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
        streamWidth = w;
        streamHeight = h;
      }
    }
  }

  const getQualityBadge = () => {
    if (streamWidth >= 3800 || streamHeight >= 2100 || title.toUpperCase().includes('4K') || title.toUpperCase().includes('UHD')) {
      return { tag: '4K', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
    }
    if (streamWidth >= 1900 || streamHeight >= 1000 || title.toUpperCase().includes('FHD') || title.toUpperCase().includes('1080P') || title.toUpperCase().includes('1080')) {
      return { tag: 'FHD', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
    }
    if (streamWidth >= 1200 || streamHeight >= 700 || title.toUpperCase().includes('HD') || title.toUpperCase().includes('720P') || title.toUpperCase().includes('720')) {
      return { tag: 'HD', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' };
    }
    if (streamWidth > 0 || streamHeight > 0 || title.toUpperCase().includes('SD')) {
      return { tag: 'SD', color: 'bg-slate-500/20 text-slate-300 border-slate-500/40' };
    }
    return { tag: 'HD', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' };
  };

  const qualityInfo = getQualityBadge();
  const resolutionText = streamWidth > 0 && streamHeight > 0 ? `${streamWidth}x${streamHeight}` : (diagnostic.resolution || (qualityInfo.tag === '4K' ? '3840x2160' : qualityInfo.tag === 'FHD' ? '1920x1080' : qualityInfo.tag === 'HD' ? '1280x720' : '720x480'));

  // Extract release date/year if provided or from title
  const displayDate = releaseYear 
    ? String(releaseYear) 
    : (() => {
        const match = title.match(/\b(19\d\d|20\d\d)\b/);
        return match ? match[1] : null;
      })();

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
            <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] text-slate-300 font-medium">
              {displayDate && (
                <>
                  <span className="text-slate-300 shrink-0 font-medium">{displayDate}</span>
                  <span className="w-1 h-1 rounded-full bg-slate-500 shrink-0"></span>
                </>
              )}
              <span className="text-slate-300 font-mono shrink-0">{resolutionText}</span>
              <span className="w-1 h-1 rounded-full bg-slate-500 shrink-0"></span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border tracking-wider shrink-0 ${qualityInfo.color}`}>
                {qualityInfo.tag}
              </span>
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
        className="relative flex-1 bg-black flex items-center justify-center min-h-0 select-none cursor-default"
        onClick={toggleOSD}
      >
        {/* Resume Prompt Overlay */}
        {showResumePrompt && (
          <div className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <div className="w-full max-w-md bg-slate-900 border border-indigo-500/30 rounded-3xl p-6 text-center space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="w-12 h-12 bg-indigo-500/20 text-indigo-400 rounded-full flex items-center justify-center mx-auto border border-indigo-500/30">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Reprendre la lecture ?</h3>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                  Vous avez commencé ce programme récemment. Voulez-vous reprendre là où vous en étiez (à <span className="text-indigo-300 font-bold font-mono">{formatTime(savedProgress)}</span>) ou recommencer ?
                </p>
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowResumePrompt(false);
                    if (videoRef.current) {
                      videoRef.current.currentTime = savedProgress;
                      setCurrentTime(savedProgress);
                      videoRef.current.play().catch(() => {});
                    }
                  }}
                  className="w-full py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-xs shadow-lg shadow-indigo-500/20 transition cursor-pointer"
                >
                  Reprendre depuis {formatTime(savedProgress)}
                </button>
                <button
                  onClick={() => {
                    setShowResumePrompt(false);
                    if (videoRef.current) {
                      videoRef.current.currentTime = 0;
                      setCurrentTime(0);
                      videoRef.current.play().catch(() => {});
                    }
                  }}
                  className="w-full py-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-semibold text-xs transition cursor-pointer"
                >
                  Recommencer du début
                </button>
              </div>
            </div>
          </div>
        )}

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

              {/* 7. Mode de Lecture & Compatibilité */}
              <div>
                <label className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider block mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Mode VOD & Pipeline
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                    isFallbackMode ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}>
                    {isFallbackMode ? 'Transcodage 1080p' : 'Direct Copy (HEVC 4K)'}
                  </span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setIsFallbackMode(false);
                      setFallbackToast("Activation du mode Direct Copy HEVC 4K / Passthrough...");
                      setTimeout(() => setFallbackToast(null), 4000);
                      initVodSession(false);
                    }}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      !isFallbackMode
                        ? 'bg-emerald-600/30 border-emerald-500 text-emerald-100 shadow-md'
                        : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold text-white flex items-center justify-between mb-0.5">
                      <span>Direct Copy 4K</span>
                      {!isFallbackMode && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </div>
                    <div className="text-[9px] text-slate-400">Qualité originale sans perte CPU</div>
                  </button>

                  <button
                    onClick={() => {
                      setIsFallbackMode(true);
                      setFallbackToast("Activation du transcodage de compatibilité 1080p H.264...");
                      setTimeout(() => setFallbackToast(null), 4000);
                      initVodSession(true);
                    }}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      isFallbackMode
                        ? 'bg-amber-600/30 border-amber-500 text-amber-100 shadow-md'
                        : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                    }`}
                  >
                    <div className="text-xs font-bold text-white flex items-center justify-between mb-0.5">
                      <span>Transcodage 1080p</span>
                      {isFallbackMode && <Check className="w-3.5 h-3.5 text-amber-400" />}
                    </div>
                    <div className="text-[9px] text-slate-400">Fallback H.264 universel</div>
                  </button>
                </div>
              </div>

              {/* 8. Bouton Diagnostic Technique */}
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
            className="absolute top-16 left-3 sm:left-4 z-40 w-80 sm:w-[420px] max-h-[75vh] overflow-y-auto bg-slate-950/98 border border-indigo-500/30 rounded-2xl p-4 shadow-2xl backdrop-blur-xl font-mono text-[11px] text-slate-200 pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-indigo-500/20">
              <span className="font-bold text-indigo-400 text-xs flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                ===== VOD 4K / HEVC =====
              </span>
              <button 
                onClick={() => setShowDiagnostic(false)} 
                className="text-slate-400 hover:text-white cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            {/* Diagnostic Technical Specs */}
            <div className="space-y-1.5">
              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">CONTAINER:</span>
                <span className="font-bold text-white">{diagnostic.container || 'N/A'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">VIDEO CODEC:</span>
                <span className="font-bold text-emerald-400">{diagnostic.videoCodec || 'N/A'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">PROFILE:</span>
                <span className="font-bold text-cyan-300">{diagnostic.videoProfile || 'N/A'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">PIX FORMAT:</span>
                <span className="font-bold text-slate-200">{diagnostic.pixFmt || 'N/A'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">RESOLUTION:</span>
                <span className="font-bold text-purple-300">{diagnostic.resolution || 'N/A'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">HDR:</span>
                <span className={`font-bold ${diagnostic.isHdr === 'YES' ? 'text-amber-400' : 'text-slate-400'}`}>
                  {diagnostic.isHdr || 'NO'}
                </span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">COLOR TRANSFER:</span>
                <span className="font-bold text-slate-300">{diagnostic.colorTransfer || 'N/A'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">COLOR SPACE:</span>
                <span className="font-bold text-slate-300">{diagnostic.colorSpace || 'N/A'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">AUDIO CODEC:</span>
                <span className="font-bold text-sky-400">{diagnostic.audioCodec || 'N/A'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">STRATEGY:</span>
                <span className="font-bold text-amber-300">{diagnostic.strategy}</span>
              </div>

              <div className="flex items-center justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">VIDEO TRANSCODING:</span>
                <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${
                  diagnostic.videoTranscoding 
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {diagnostic.videoTranscoding ? 'YES' : 'NO'}
                </span>
              </div>

              <div className="flex items-center justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">AUDIO TRANSCODING:</span>
                <span className={`font-bold px-1.5 py-0.5 rounded text-[9px] ${
                  diagnostic.audioTranscoding 
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' 
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}>
                  {diagnostic.audioTranscoding ? 'YES' : 'NO'}
                </span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">OUTPUT:</span>
                <span className="font-bold text-white">{diagnostic.output || 'HLS fMP4'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">VIDEO TAG:</span>
                <span className="font-bold text-indigo-300">{diagnostic.videoTag || 'hvc1'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">FFMPEG SPEED:</span>
                <span className="font-bold text-emerald-300">{diagnostic.ffmpegSpeed || '1.0x'}</span>
              </div>

              <div className="flex justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">TIME TO FIRST SEGMENT:</span>
                <span className="font-bold text-teal-300">{diagnostic.timeToFirstSegment || '1.2s'}</span>
              </div>

              <div className="flex items-center justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">SEGMENTS READY:</span>
                <span className="font-bold text-indigo-300">
                  {typeof diagnostic.segmentsReady === 'number' && !isNaN(diagnostic.segmentsReady) ? diagnostic.segmentsReady : 0}
                </span>
              </div>

              <div className="flex items-center justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">PLAYER:</span>
                <span className="font-bold text-indigo-200">{diagnostic.player || 'NATIVE_HLS / HLS_JS'}</span>
              </div>

              <div className="flex items-center justify-between py-0.5 border-b border-white/5">
                <span className="text-slate-400">STATUS:</span>
                <span className={`font-bold flex items-center gap-1.5 ${
                  playbackStatus === 'PLAYING' ? 'text-emerald-400' : playbackStatus === 'ERROR' ? 'text-rose-400' : 'text-amber-400'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    playbackStatus === 'PLAYING' ? 'bg-emerald-400 animate-pulse' : playbackStatus === 'ERROR' ? 'bg-rose-400' : 'bg-amber-400'
                  }`}></span>
                  {playbackStatus}
                </span>
              </div>

              {/* Error Diagnostics details if any */}
              {(diagnostic.ffmpegLastError || diagnostic.probeError || diagnostic.errorDetails || diagnostic.playerError || diagnostic.sourceHttpStatus || diagnostic.hevcCopyResult) && (
                <div className="pt-2 border-t border-rose-500/20 space-y-1 bg-rose-950/20 p-2 rounded-xl border border-rose-500/10">
                  <div className="text-rose-400 font-bold text-[10px] mb-1">DÉTAILS TECHNIQUES & ERREURS :</div>
                  
                  {diagnostic.ffmpegExitCode !== undefined && diagnostic.ffmpegExitCode !== null && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">FFMPEG EXIT CODE:</span>
                      <span className="font-bold text-rose-300">{diagnostic.ffmpegExitCode}</span>
                    </div>
                  )}

                  {diagnostic.ffmpegLastError && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-slate-400">FFMPEG LAST ERROR:</span>
                      <span className="text-rose-300 break-all text-[10px] bg-black/40 p-1 rounded font-mono">{diagnostic.ffmpegLastError}</span>
                    </div>
                  )}

                  {diagnostic.sourceHttpStatus && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">SOURCE HTTP:</span>
                      <span className={`font-bold ${Number(diagnostic.sourceHttpStatus) >= 400 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {diagnostic.sourceHttpStatus}
                      </span>
                    </div>
                  )}

                  {diagnostic.hevcCopyResult && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">HEVC COPY RESULT:</span>
                      <span className={`font-bold ${diagnostic.hevcCopyResult === 'SUCCESS' ? 'text-emerald-400' : diagnostic.hevcCopyResult === 'FAILED' ? 'text-rose-400' : 'text-slate-300'}`}>
                        {diagnostic.hevcCopyResult}
                      </span>
                    </div>
                  )}

                  {diagnostic.playerError && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-slate-400">PLAYER ERROR:</span>
                      <span className="text-rose-300 break-all text-[10px] bg-black/40 p-1 rounded font-mono">{diagnostic.playerError}</span>
                    </div>
                  )}
                </div>
              )}

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

      {/* Toast notification for fallback / mode changes */}
      {fallbackToast && (
        <div className="absolute top-16 right-4 z-50 max-w-sm p-3 rounded-2xl bg-indigo-950/95 border border-indigo-500/40 text-white text-xs shadow-2xl backdrop-blur-md flex items-center gap-2 animate-in fade-in slide-in-from-top duration-200 pointer-events-auto">
          <Zap className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
          <span>{fallbackToast}</span>
        </div>
      )}

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
            className="group relative h-2.5 sm:h-2 hover:h-4 bg-slate-900/60 rounded-full cursor-pointer transition-all duration-150 flex items-center py-2 -my-2"
          >
            {/* Inner background bar */}
            <div className="absolute inset-x-0 h-2 group-hover:h-3 rounded-full bg-slate-800/90 border border-white/10 overflow-hidden transition-all duration-150 shadow-inner">
              {/* Ghost Hover Preview Bar */}
              {hoverPos > 0 && (
                <div
                  className="absolute left-0 top-0 bottom-0 bg-white/15 rounded-full pointer-events-none transition-opacity duration-100"
                  style={{ width: `${hoverPos}%` }}
                />
              )}

              {/* Buffered Bar(s) - Loaded content in distinct luminous Sky/Cyan */}
              {bufferedRanges.length > 0 ? (
                bufferedRanges.map((range, idx) => (
                  <div
                    key={idx}
                    className="absolute top-0 bottom-0 bg-sky-400/45 border-r border-sky-300/80 rounded-full transition-all duration-150 shadow-[0_0_8px_rgba(56,189,248,0.25)]"
                    style={{
                      left: `${range.startPercent}%`,
                      width: `${range.widthPercent}%`
                    }}
                    title={`Zone pré-chargée : ${Math.round(range.startPercent)}% - ${Math.round(range.startPercent + range.widthPercent)}%`}
                  />
                ))
              ) : bufferedPercent > 0 ? (
                <div
                  className="absolute left-0 top-0 bottom-0 bg-sky-400/45 border-r border-sky-300/80 rounded-full transition-all duration-200 shadow-[0_0_8px_rgba(56,189,248,0.25)]"
                  style={{ width: `${bufferedPercent}%` }}
                />
              ) : null}

              {/* Played / Progress Bar */}
              <div
                className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-indigo-500 via-indigo-400 to-violet-400 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.6)]"
                style={{ width: `${currentProgressPercent}%` }}
              />
            </div>

            {/* Hover Tooltip Timestamp */}
            {hoverTime !== null && (
              <div
                className="absolute -top-8 -translate-x-1/2 bg-slate-900/95 border border-sky-400/30 px-2 py-0.5 rounded-md text-[10px] font-mono text-white pointer-events-none shadow-xl z-50 whitespace-nowrap flex items-center gap-1.5"
                style={{ left: `${hoverPos}%` }}
              >
                <span>{formatTime(hoverTime)}</span>
                {bufferedPercent > 0 && hoverPos <= bufferedPercent && (
                  <span className="text-[9px] text-sky-300 font-sans font-medium">• Chargé</span>
                )}
              </div>
            )}

            {/* Scrubber Thumb Handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 sm:w-3.5 sm:h-3.5 bg-white rounded-full shadow-lg scale-100 sm:scale-0 group-hover:scale-100 transition-transform duration-150 pointer-events-none border-2 border-indigo-500 ring-2 ring-indigo-400/30"
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
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs font-mono text-slate-300 ml-1 sm:ml-2 whitespace-nowrap">
              <div>
                <span className="text-white font-semibold">{formatTime(activeCurrentTime)}</span>
                <span className="text-slate-500 mx-1">/</span>
                <span className="text-amber-300 font-semibold">{formatTime(effectiveDuration)}</span>
              </div>
              {bufferedPercent > 0 && (
                <span
                  className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-500/15 border border-sky-400/30 text-[10px] font-sans font-medium text-sky-300 shadow-sm"
                  title="Pourcentage du média actuellement chargé en mémoire tampon"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                  Chargé : {Math.round(bufferedPercent)}%
                </span>
              )}
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
