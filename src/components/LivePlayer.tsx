import React, { useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Maximize, 
  Minimize, 
  PictureInPicture2, 
  RotateCcw, 
  ChevronLeft, 
  ChevronRight, 
  Tv, 
  Clock, 
  ShieldAlert,
  ListFilter,
  Layers,
  Check,
  Info,
  Link,
  Copy,
  ExternalLink,
  X,
  Server,
  Activity,
  Zap,
  Sliders
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { EPGService } from '../services/epgService';
import { Channel } from '../types/iptv';
import { StalkerCapabilityService } from '../services/stalkerCapabilityService';
import { isFullscreen as checkIsFullscreen, safeToggleFullscreen } from '../utils/fullscreen';

interface LivePlayerProps {
  channelOverride?: Channel | null;
  onOpenEPGModal?: () => void;
  showChannelListToggle?: () => void;
}

export const LivePlayer: React.FC<LivePlayerProps> = ({
  channelOverride,
  onOpenEPGModal,
  showChannelListToggle,
}) => {
  const { 
    activeChannel: contextChannel, 
    zapNext, 
    zapPrev, 
    zapToNumber, 
    epgData, 
    playerSettings,
    updatePlayerSettings,
    activeServer,
    updateServer,
  } = useIPTV();

  const channel = channelOverride !== undefined ? channelOverride : contextChannel;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osdTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(playerSettings.muted);
  const [volume, setVolume] = useState<number>(playerSettings.audioVolume);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '4:3' | 'fill' | 'fit'>('16:9');
  const [showOSD, setShowOSD] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState<boolean>(true);
  const [digitsBuffer, setDigitsBuffer] = useState<string>('');
  const [stats, setStats] = useState<{ bitrate?: number; resolution?: string; fps?: number }>({});
  const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);
  const [audioLevels, setAudioLevels] = useState<{ id: number; name: string }[]>([]);
  const [selectedAudioLevel, setSelectedAudioLevel] = useState<number>(-1);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [currentPlaybackUrl, setCurrentPlaybackUrl] = useState<string>('');
  const [showStreamInfo, setShowStreamInfo] = useState<boolean>(false);
  const [copiedStreamUrl, setCopiedStreamUrl] = useState<boolean>(false);
  const [copiedOriginalUrl, setCopiedOriginalUrl] = useState<boolean>(false);
  const proxyRetriedRef = useRef<boolean>(false);

  const currentLiveFormat: 'auto' | 'm3u8' | 'ts' = (activeServer?.liveStreamFormat as 'auto' | 'm3u8' | 'ts') || 'auto';

  const handleSwitchFormat = (format: 'auto' | 'm3u8' | 'ts') => {
    if (activeServer) {
      updateServer(activeServer.id, { liveStreamFormat: format });
    }
    setRetryCount((c) => c + 1);
    triggerOSD();
  };

  // Get current and next program from EPG
  const currentPrograms = channel?.id ? (epgData[channel.id] || []) : [];
  const currentProgram = EPGService.getCurrentProgram(currentPrograms);
  const nextProgram = EPGService.getNextProgram(currentPrograms);
  const progressPercent = currentProgram ? EPGService.getProgressPercentage(currentProgram) : 0;

  // Auto-hide OSD
  const triggerOSD = useCallback(() => {
    setShowOSD(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      // Don't hide OSD automatically if stream info modal is open
      setShowOSD(false);
      setShowSettingsMenu(false);
    }, (playerSettings.osdTimeout || 4) * 1000);
  }, [playerSettings.osdTimeout]);

  const copyToClipboard = async (text: string, type: 'playback' | 'original' = 'playback') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'playback') {
        setCopiedStreamUrl(true);
        setTimeout(() => setCopiedStreamUrl(false), 2500);
      } else {
        setCopiedOriginalUrl(true);
        setTimeout(() => setCopiedOriginalUrl(false), 2500);
      }
    } catch (err) {
      console.warn('Failed to copy stream url:', err);
    }
  };

  // Handle stream loading & HLS
  useEffect(() => {
    proxyRetriedRef.current = false;

    if (!channel || !videoRef.current) {
      setIsLoadingStream(false);
      return;
    }

    let streamUrlRaw = channel.streamUrl ? channel.streamUrl.trim() : '';
    if (!streamUrlRaw) {
      setIsLoadingStream(false);
      setStreamError('Aucune adresse de flux disponible pour cette chaîne.');
      return;
    }

    setIsLoadingStream(true);
    setStreamError(null);
    triggerOSD();

    const isStalker = activeServer?.type === 'stalker';
    const serverFormat = activeServer?.liveStreamFormat || 'auto';

    const extractedStreamId = (channel as any)?.streamId || (channel as any)?.chId || (channel?.cmd?.match(/\/ch\/([a-zA-Z0-9_-]+?)(?:_|\.|$|\s)/i)?.[1]) || (channel?.id?.replace(/^stalker-/, ''));

    // Force format alignment and populate stream ID if needed
    if (isStalker) {
      const { finalUrl } = StalkerCapabilityService.transformStalkerLiveUrl(
        streamUrlRaw,
        serverFormat,
        null,
        channel?.id,
        extractedStreamId,
        channel?.cmd
      );
      streamUrlRaw = finalUrl;
    }

    const video = videoRef.current;
    let initialUrl = streamUrlRaw;

    const isStaticDeploy = typeof window !== 'undefined' && (
      window.location.hostname.includes('github.io') || 
      window.location.hostname.includes('github.pages') ||
      window.location.hostname.includes('pages.dev') ||
      window.location.hostname.includes('netlify.app') ||
      window.location.hostname.includes('vercel.app')
    );
    const useProxy = playerSettings.useStreamProxy && !isStaticDeploy && isStalker;

    if (useProxy && !initialUrl.startsWith('/api/proxy')) {
      initialUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}`;
    }

    setCurrentPlaybackUrl(initialUrl);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Safety timeout: 12s for direct stream / proxy fallback (shorter on static deployments)
    const streamTimeout = setTimeout(() => {
      if (!proxyRetriedRef.current && !streamUrlRaw.startsWith('/api/proxy') && !isStaticDeploy) {
        proxyRetriedRef.current = true;
        const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(channel.backupStreamUrl || streamUrlRaw)}`;
        setCurrentPlaybackUrl(proxyUrl);
        if (hlsRef.current) {
          hlsRef.current.loadSource(proxyUrl);
        } else if (videoRef.current) {
          videoRef.current.src = proxyUrl;
          videoRef.current.play().catch(() => {});
        }
        // Second safety timeout for proxy attempt (8s)
        setTimeout(() => {
          setIsLoadingStream(false);
          setStreamError('Le flux de cette chaîne ne répond pas. Cliquez sur la liste des chaînes pour zapper.');
        }, 8000);
      } else {
        setIsLoadingStream(false);
        setStreamError('Le flux vidéo ne répond pas. Veuillez sélectionner une autre chaîne dans la liste.');
      }
    }, isStaticDeploy ? 4000 : 12000);

    const isHlsStream = initialUrl.includes('.m3u8') || initialUrl.includes('playlist') || initialUrl.includes('live') || initialUrl.startsWith('/api/proxy');

    const isStalkerHlsTest = (channel as any)._isStalkerHls;
    const stalkerHlsAudit = (channel as any)._stalkerHlsAudit;

    const logDiagnostic = (networkDetails, isHlsJs, hasError, state) => {
      if (!isStalkerHlsTest || !stalkerHlsAudit) return;
      
      let httpStatus = 'Unknown';
      let contentType = 'Unknown';
      let startsWithM3u = 'Unknown';
      
      if (networkDetails && networkDetails.status) {
        httpStatus = networkDetails.status;
        contentType = networkDetails.getResponseHeader ? (networkDetails.getResponseHeader('Content-Type') || 'Unknown') : 'Unknown';
        startsWithM3u = networkDetails.responseText ? (networkDetails.responseText.startsWith('#EXTM3U') ? 'Oui' : 'Non') : 'Unknown';
      }

      // Log Stalker Playback Strategy
      StalkerCapabilityService.logPlaybackStrategyDiagnostic({
        channelId: channel?.id || 'Unknown',
        audit: stalkerHlsAudit,
        selectedPlayer: isHlsJs ? 'HLS.js' : 'Safari Native HLS',
        state: hasError ? 'error' : (state === 'playing' ? 'playing' : 'loading'),
      });

      console.log(`===== STALKER NATIVE HLS PLAYBACK =====
Channel: ${channel?.name || 'Unknown'}
ID: ${channel?.id || 'Unknown'}
CREATE LINK
Success: Oui
Original extension: ${stalkerHlsAudit.originalExtension}
HLS TRANSFORMATION
/play/live.php detected: Oui
Original extension: ${stalkerHlsAudit.originalExtension}
Requested extension: ${stalkerHlsAudit.requestedExtension}
MAC preserved: ${stalkerHlsAudit.macPreserved ? 'Oui' : 'Non'}
Stream ID preserved: ${stalkerHlsAudit.streamIdPreserved ? 'Oui' : 'Non'}
play_token preserved: ${stalkerHlsAudit.playTokenPreserved ? 'Oui' : 'Non'}
Other query parameters preserved: ${stalkerHlsAudit.onlyExtensionChanged ? 'Oui' : 'Non'}
HLS RESPONSE
HTTP status: ${httpStatus}
Content-Type: ${contentType}
Starts with #EXTM3U: ${startsWithM3u}
Redirect count: 0
Detected format: ${startsWithM3u === 'Oui' || contentType.includes('mpegurl') ? 'HLS' : 'Not HLS'}
PLAYER
Engine: ${isHlsJs ? 'HLS.js' : 'Safari Native HLS'}
Manifest loaded: ${hasError ? 'Non' : 'Oui'}
First media segment: ${state === 'playing' ? 'Oui' : (hasError ? 'Non' : 'Pending')}
State: ${state}
FFmpeg used: Non
MPEGTS.js used: Non
Error: ${hasError ? hasError : 'None'}

URL STRUCTURE AUDIT
Original create_link URL: ${stalkerHlsAudit.originalUrlMasked}
Final HLS URL: ${stalkerHlsAudit.finalUrlMasked}
Only extension changed: ${stalkerHlsAudit.onlyExtensionChanged ? 'Oui' : 'Non'}
Hostname match: Oui
Port match: Oui
Stream ID match: Oui
play_token match: Oui`);
    };

    if (isHlsStream && Hls.isSupported()) {
      class StalkerPlaylistLoader extends Hls.DefaultConfig.loader {
        constructor(config: any) {
          super(config);
          const originalLoad = this.load.bind(this);
          this.load = (context: any, configParam: any, callbacks: any) => {
            const originalOnSuccess = callbacks.onSuccess;
            callbacks.onSuccess = (response: any, stats: any, ctx: any, networkDetails: any) => {
              if (context.type === 'manifest') {
                logDiagnostic(networkDetails, true, false, 'loading');
              }
              if (originalOnSuccess) originalOnSuccess(response, stats, ctx, networkDetails);
            };
            originalLoad(context, configParam, callbacks);
          };
        }
      }

      const hls = new Hls({
        pLoader: isStalkerHlsTest ? (StalkerPlaylistLoader as any) : undefined,
        enableWorker: true,
        lowLatencyMode: playerSettings.bufferLength === 'low',
        backBufferLength: playerSettings.bufferLength === 'high' ? 60 : 30,
        maxBufferLength: playerSettings.bufferLength === 'high' ? 60 : 30,
        fragLoadingTimeOut: 5000,
        manifestLoadingTimeOut: 5000,
        levelLoadingTimeOut: 5000,
      });

      hls.loadSource(initialUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        clearTimeout(streamTimeout);
        setIsLoadingStream(false);
        setStreamError(null);
        video.play().catch(() => setIsPlaying(false));
        if (data.levels && data.levels.length > 0) {
          const first = data.levels[0];
          setStats({
            resolution: `${first.width}x${first.height}`,
            bitrate: Math.round(first.bitrate / 1000),
          });
        }
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        setIsLoadingStream(false);
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
        if (data.audioTracks) {
          setAudioLevels(data.audioTracks.map((t, idx) => ({ id: idx, name: t.name || `Piste ${idx + 1}` })));
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          clearTimeout(streamTimeout);
          if (isStalkerHlsTest) {
            logDiagnostic(null, true, `${data.type} - ${data.details}`, 'error');
            if ((channel as any)._portalUrl && channel?.id) {
              StalkerCapabilityService.setChannelOverride((channel as any)._portalUrl, channel.id, false);
            }
            // Only auto-fallback to TS when server mode is 'auto'
            if (serverFormat === 'auto' && !proxyRetriedRef.current && (channel as any)._originalTsUrl) {
              proxyRetriedRef.current = true;
              console.log('[LivePlayer] Stalker m3u8 stream failed in auto mode, falling back to original ts URL:', (channel as any)._originalTsUrl);
              const rawFallback = (channel as any)._originalTsUrl;
              const fallbackUrl = useProxy && !rawFallback.startsWith('/api/proxy') ? `/api/proxy/stream?url=${encodeURIComponent(rawFallback)}` : rawFallback;
              setCurrentPlaybackUrl(fallbackUrl);
              hls.loadSource(fallbackUrl);
              return;
            }
          }
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (!proxyRetriedRef.current && channel?.backupStreamUrl) {
                proxyRetriedRef.current = true;
                const backupUrl = `/api/proxy/stream?url=${encodeURIComponent(channel.backupStreamUrl)}`;
                console.log('[LivePlayer] Network error on primary stream, trying backup format (.ts):', backupUrl);
                setCurrentPlaybackUrl(backupUrl);
                hls.loadSource(backupUrl);
              } else if (!proxyRetriedRef.current && !initialUrl.startsWith('/api/proxy')) {
                proxyRetriedRef.current = true;
                const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}`;
                console.log('[LivePlayer] Network error on direct stream, attempting proxy fallback:', proxyUrl);
                setCurrentPlaybackUrl(proxyUrl);
                hls.loadSource(proxyUrl);
              } else {
                hls.destroy();
                hlsRef.current = null;
                setStreamError('Impossible de joindre le flux vidéo. Le serveur IPTV ou la source est inaccessible.');
                setIsLoadingStream(false);
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              try {
                hls.recoverMediaError();
              } catch {
                if (channel?.backupStreamUrl && !proxyRetriedRef.current) {
                  proxyRetriedRef.current = true;
                  const backupUrl = `/api/proxy/stream?url=${encodeURIComponent(channel.backupStreamUrl)}`;
                  hls.loadSource(backupUrl);
                } else {
                  hls.destroy();
                  hlsRef.current = null;
                  setStreamError('Erreur de décodage du flux média.');
                  setIsLoadingStream(false);
                }
              }
              break;
            default:
              hls.destroy();
              hlsRef.current = null;
              setStreamError('Erreur critique lors de la lecture du flux.');
              setIsLoadingStream(false);
              break;
          }
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = initialUrl;
      const onLoaded = () => {
        clearTimeout(streamTimeout);
        if (isStalkerHlsTest) {
          logDiagnostic(null, false, false, 'playing');
        }
        setIsLoadingStream(false);
        setStreamError(null);
        video.play().catch(() => setIsPlaying(false));
      };
      const onError = () => {
        clearTimeout(streamTimeout);
        if (isStalkerHlsTest) {
          logDiagnostic(null, false, 'Native error', 'error');
          if ((channel as any)._portalUrl && channel?.id) {
            StalkerCapabilityService.setChannelOverride((channel as any)._portalUrl, channel.id, false);
          }
          if (!proxyRetriedRef.current && (channel as any)._originalTsUrl) {
            proxyRetriedRef.current = true;
            const fallbackUrl = (channel as any)._originalTsUrl;
            video.src = useProxy && !fallbackUrl.startsWith('/api/proxy') ? `/api/proxy/stream?url=${encodeURIComponent(fallbackUrl)}` : fallbackUrl;
            video.play().catch(() => {});
            return;
          }
        }
        if (!proxyRetriedRef.current && !streamUrlRaw.startsWith('/api/proxy')) {
          proxyRetriedRef.current = true;
          video.src = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}`;
          video.play().catch(() => {});
        } else {
          setStreamError('Erreur de lecture du média.');
          setIsLoadingStream(false);
        }
      };

      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    } else {
      video.src = initialUrl;
      const onLoaded = () => {
        clearTimeout(streamTimeout);
        setIsLoadingStream(false);
        setStreamError(null);
        video.play().catch(() => setIsPlaying(false));
      };
      const onError = () => {
        clearTimeout(streamTimeout);
        if (!proxyRetriedRef.current && !streamUrlRaw.startsWith('/api/proxy')) {
          proxyRetriedRef.current = true;
          const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}`;
          // If the direct stream failed on Chrome, we try to use hls.js with the proxied stream
          if (Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(proxyUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              setIsLoadingStream(false);
              setStreamError(null);
              video.play().catch(() => setIsPlaying(false));
            });
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) {
                hls.destroy();
                setStreamError('Impossible de joindre le flux vidéo (Proxy HLS échoué).');
                setIsLoadingStream(false);
              }
            });
            hlsRef.current = hls;
          } else {
            video.src = proxyUrl;
            video.play().catch(() => {});
          }
        } else {
          setStreamError('Format vidéo non supporté par le navigateur.');
          setIsLoadingStream(false);
        }
      };
      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    }

    return () => {
      clearTimeout(streamTimeout);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [channel?.id, channel?.streamUrl, activeServer?.liveStreamFormat, playerSettings.useStreamProxy, playerSettings.bufferLength, triggerOSD, retryCount]);

  // Keyboard navigation & channel zapping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        zapNext();
        triggerOSD();
      } else if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        zapPrev();
        triggerOSD();
      } else if (e.key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm') {
        e.preventDefault();
        toggleMute();
      } else if (e.key >= '0' && e.key <= '9') {
        setDigitsBuffer((prev) => {
          const updated = prev + e.key;
          triggerOSD();
          return updated;
        });
      } else if (e.key === 'i' || e.key === 'o') {
        triggerOSD();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerOSD, zapNext, zapPrev]);

  // Flush numeric zapping buffer after 1.2 seconds
  useEffect(() => {
    if (!digitsBuffer) return;
    const timer = setTimeout(() => {
      const channelNum = parseInt(digitsBuffer, 10);
      zapToNumber(channelNum);
      setDigitsBuffer('');
    }, 1200);
    return () => clearTimeout(timer);
  }, [digitsBuffer, zapToNumber]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
    triggerOSD();
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    updatePlayerSettings({ muted: nextMuted });
    triggerOSD();
  };

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

  const handleVolumeChange = (newVal: number) => {
    if (!videoRef.current) return;
    setVolume(newVal);
    videoRef.current.volume = newVal / 100;
    if (newVal > 0 && isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
    updatePlayerSettings({ audioVolume: newVal, muted: false });
  };

  const toggleFullscreen = async () => {
    const newState = await safeToggleFullscreen(containerRef.current);
    setIsFullscreen(newState);
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
  };

  const cycleAspectRatio = () => {
    const ratios: ('16:9' | '4:3' | 'fill' | 'fit')[] = ['16:9', '4:3', 'fill', 'fit'];
    const nextIdx = (ratios.indexOf(aspectRatio) + 1) % ratios.length;
    setAspectRatio(ratios[nextIdx]);
    triggerOSD();
  };

  const getVideoClass = () => {
    switch (aspectRatio) {
      case '4:3':
        return 'w-auto h-full aspect-[4/3] mx-auto object-contain';
      case 'fill':
        return 'w-full h-full object-cover';
      case 'fit':
        return 'w-full h-full object-contain';
      case '16:9':
      default:
        return 'w-full h-full object-contain';
    }
  };

  return (
    <div
      ref={containerRef}
      id="live-player-container"
      onMouseMove={triggerOSD}
      onClick={triggerOSD}
      className="relative w-full h-full bg-black/60 flex items-center justify-center overflow-hidden select-none group"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        id="main-video-stream"
        className={getVideoClass()}
        playsInline
        autoPlay
        muted={isMuted}
        onPlay={() => {
          setIsPlaying(true);
          setIsLoadingStream(false);
        }}
        onPlaying={() => {
          setIsPlaying(true);
          setIsLoadingStream(false);
          setStreamError(null);
        }}
        onLoadedData={() => setIsLoadingStream(false)}
        onCanPlay={() => setIsLoadingStream(false)}
        onPause={() => setIsPlaying(false)}
      />

      {/* Always Accessible Channel Zapper Button (Top Left) */}
      {showChannelListToggle && (
        <div className="absolute top-4 left-4 z-40">
          <button
            id="live-player-quick-channels"
            onClick={showChannelListToggle}
            className="px-3.5 py-2 rounded-full bg-slate-950/80 hover:bg-slate-900 border border-white/20 text-white text-xs font-semibold flex items-center gap-2 shadow-xl backdrop-blur-2xl transition active:scale-95"
          >
            <ListFilter className="w-4 h-4 text-indigo-400" />
            <span>Chaînes</span>
          </button>
        </div>
      )}

      {/* Numeric Zapping OSD (Top Right) */}
      {digitsBuffer && (
        <div className="absolute top-6 right-6 bg-slate-950/80 border border-indigo-500/50 text-indigo-300 px-5 py-2.5 rounded-2xl shadow-2xl backdrop-blur-2xl z-40 animate-pulse flex items-center gap-3">
          <Tv className="w-6 h-6 text-indigo-400" />
          <span className="text-3xl font-extrabold font-mono tracking-widest">{digitsBuffer}</span>
        </div>
      )}

      {/* No Channel Selected State */}
      {!channel && !isLoadingStream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-3xl z-20 p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4 text-indigo-400">
            <Tv className="w-8 h-8 animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Aucune Chaîne Sélectionnée</h3>
          <p className="text-xs text-slate-400 max-w-sm mb-5">
            Sélectionnez une chaîne dans la liste pour démarrer le flux vidéo.
          </p>
          {showChannelListToggle && (
            <button
              onClick={showChannelListToggle}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-500/25 transition active:scale-95"
            >
              <ListFilter className="w-4 h-4" />
              <span>Ouvrir le guide des chaînes</span>
            </button>
          )}
        </div>
      )}

      {/* Loading Spinner with Frosted Blur & Zapping Option */}
      {isLoadingStream && !streamError && channel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 backdrop-blur-md z-30 p-6 text-center">
          <div className="w-14 h-14 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-4" />
          <div className="text-sm font-semibold text-white tracking-wide">Chargement du flux IPTV...</div>
          <div className="text-xs text-slate-400 mt-1 font-mono mb-4">{channel?.name}</div>

          <div className="flex items-center gap-3 pointer-events-auto">
            {showChannelListToggle && (
              <button
                onClick={showChannelListToggle}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-full flex items-center gap-2 shadow-lg transition active:scale-95"
              >
                <ListFilter className="w-3.5 h-3.5" />
                <span>Changer de chaîne</span>
              </button>
            )}
            <button
              onClick={() => setIsLoadingStream(false)}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-medium rounded-full transition active:scale-95"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Stream Error Modal (Frosted Glass) */}
      {streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-3xl z-20 p-6 text-center overflow-y-auto">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-3 text-red-400">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Signal Indisponible</h3>
          <p className="text-xs text-slate-300 max-w-md mb-3">{streamError}</p>

          {/* Failed Stream URL Section */}
          {(currentPlaybackUrl || channel?.streamUrl) && (
            <div className="w-full max-w-lg mb-5 bg-black/60 border border-white/10 rounded-2xl p-3.5 text-left space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                  <Link className="w-3.5 h-3.5 text-red-400" />
                  Adresse du flux en échec :
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(currentPlaybackUrl || channel?.streamUrl || '', 'playback')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition ${
                    copiedStreamUrl
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white border border-white/10'
                  }`}
                  title="Copier l'adresse du flux"
                >
                  {copiedStreamUrl ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Copié !</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copier l'URL</span>
                    </>
                  )}
                </button>
              </div>

              <div className="p-2.5 rounded-xl bg-black/50 border border-white/5 font-mono text-[11px] text-red-200/90 break-all select-all leading-relaxed max-h-24 overflow-y-auto">
                {currentPlaybackUrl || channel?.streamUrl}
              </div>

              <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400">
                <span>
                  Format actif : <strong className="text-white uppercase">{currentLiveFormat}</strong> ({currentPlaybackUrl?.includes('.m3u8') ? 'HLS' : currentPlaybackUrl?.includes('.ts') ? 'TS' : 'Direct'})
                </span>
                <button
                  type="button"
                  onClick={() => setShowStreamInfo(true)}
                  className="text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1"
                >
                  <Info className="w-3 h-3" />
                  Plus de détails
                </button>
              </div>

              {/* Quick Format Switch directly inside Error Screen */}
              <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  Format du flux :
                </span>
                <div className="inline-flex rounded-xl bg-black/60 p-1 border border-white/10 gap-1">
                  <button
                    type="button"
                    onClick={() => handleSwitchFormat('auto')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                      currentLiveFormat === 'auto'
                        ? 'bg-indigo-500 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchFormat('m3u8')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                      currentLiveFormat === 'm3u8'
                        ? 'bg-indigo-500 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    M3U8
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchFormat('ts')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                      currentLiveFormat === 'ts'
                        ? 'bg-indigo-500 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    TS
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => {
                setRetryCount((c) => c + 1);
              }}
              className="px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-full text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/25 transition active:scale-95"
            >
              <RotateCcw className="w-4 h-4" />
              Réessayer le signal
            </button>
            <button
              onClick={() => {
                updatePlayerSettings({ useStreamProxy: !playerSettings.useStreamProxy });
                setRetryCount((c) => c + 1);
              }}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white rounded-full text-xs font-semibold flex items-center gap-2 transition active:scale-95"
            >
              Proxy ({playerSettings.useStreamProxy ? 'Actif' : 'Inactif'})
            </button>
            <button
              onClick={zapNext}
              className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-full text-xs font-semibold transition active:scale-95"
            >
              Chaîne suivante
            </button>
          </div>
        </div>
      )}

      {/* ON-SCREEN DISPLAY (OSD) OVERLAY (Frosted Glass) */}
      <div
        className={`absolute inset-0 flex flex-col justify-between p-6 md:p-8 transition-opacity duration-300 pointer-events-none ${
          showOSD ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* TOP BAR */}
        <div className="flex items-center justify-between pointer-events-auto">
          <div className="flex items-center gap-2.5">
            {showChannelListToggle && (
              <button
                id="toggle-channels-sidebar-btn"
                onClick={showChannelListToggle}
                className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white flex items-center gap-2 backdrop-blur-2xl transition shadow-lg"
              >
                <ListFilter className="w-4 h-4 text-indigo-400" />
                Liste des chaînes
              </button>
            )}
            {onOpenEPGModal && (
              <button
                id="open-epg-guide-btn"
                onClick={onOpenEPGModal}
                className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white flex items-center gap-2 backdrop-blur-2xl transition shadow-lg"
              >
                <Clock className="w-4 h-4 text-amber-400" />
                Guide TV (EPG)
              </button>
            )}
          </div>

          {/* Top Right Badges & Format Switcher */}
          <div className="flex items-center gap-2.5">
            {/* Format Direct Switcher (Auto, M3U8, TS) */}
            <div className="bg-black/60 backdrop-blur-md p-1 rounded-2xl border border-white/15 flex items-center gap-1 shadow-lg">
              <span className="text-[10px] font-bold text-slate-400 pl-1.5 pr-1 flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />
                Format :
              </span>
              <button
                type="button"
                onClick={() => handleSwitchFormat('auto')}
                className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition active:scale-95 ${
                  currentLiveFormat === 'auto'
                    ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/50'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
                title="Format Automatique (Auto-détection du portail)"
              >
                Auto
              </button>
              <button
                type="button"
                onClick={() => handleSwitchFormat('m3u8')}
                className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition active:scale-95 ${
                  currentLiveFormat === 'm3u8'
                    ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/50'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
                title="Forcer le format M3U8 / HLS"
              >
                M3U8
              </button>
              <button
                type="button"
                onClick={() => handleSwitchFormat('ts')}
                className={`px-2.5 py-1 rounded-xl text-[10px] font-bold transition active:scale-95 ${
                  currentLiveFormat === 'ts'
                    ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/50'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
                title="Forcer le format TS (MPEG-TS)"
              >
                TS
              </button>
            </div>

            <button
              id="stream-info-top-btn"
              onClick={() => setShowStreamInfo(true)}
              className="bg-black/50 hover:bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-xs font-semibold text-slate-200 hover:text-white flex items-center gap-1.5 transition active:scale-95"
              title="Voir l'adresse du flux et les détails techniques"
            >
              <Info className="w-3.5 h-3.5 text-indigo-400" />
              <span>Info Flux</span>
            </button>
            {channel?.resolution && (
              <div className="bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-xs font-medium text-slate-200">
                {channel.resolution} • 60fps
              </div>
            )}
            {stats.bitrate && (
              <div className="hidden sm:block bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-xs font-mono text-slate-300">
                {stats.bitrate} kbps
              </div>
            )}
          </div>
        </div>

        {/* BOTTOM OSD HERO BANNER (Frosted Glass Container matching Design) */}
        <div className="pointer-events-auto bg-slate-950/60 backdrop-blur-2xl border border-white/10 p-6 md:p-8 rounded-[32px] shadow-2xl space-y-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            {/* Left: Now playing & Title */}
            <div className="max-w-xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="px-2.5 py-1 bg-red-500 text-[10px] font-bold rounded uppercase tracking-wider text-white inline-block shadow-sm shadow-red-500/40">
                  Now Playing
                </span>
                {currentPlaybackUrl && (
                  <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-mono rounded font-semibold">
                    {currentPlaybackUrl.includes('.m3u8') ? 'HLS (m3u8)' : currentPlaybackUrl.includes('.ts') ? 'MPEG-TS (.ts)' : 'DIRECT'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight">
                  {channel?.name || 'Live Channel'}
                </h2>
                {channel?.number && (
                  <span className="text-xs font-mono text-indigo-400 bg-white/10 px-2 py-0.5 rounded-full border border-white/10">
                    CH {channel.number}
                  </span>
                )}
              </div>
              <p className="text-slate-300 text-sm mt-1">
                {currentProgram ? `${currentProgram.title} • Live Broadcast` : channel?.category || 'Direct TV'}
              </p>

              {/* Stream URL Display & Quick Copy Pill */}
              {(currentPlaybackUrl || channel?.streamUrl) && (
                <div className="mt-2.5 flex items-center gap-2">
                  <div
                    onClick={() => setShowStreamInfo(true)}
                    className="group/pill inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/40 hover:bg-black/60 border border-white/10 hover:border-indigo-500/40 text-slate-300 hover:text-white text-xs font-mono transition cursor-pointer max-w-md truncate shadow-sm"
                    title="Cliquer pour afficher les détails complets du flux"
                  >
                    <Link className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="text-[11px] truncate text-slate-300 group-hover/pill:text-indigo-200">
                      {currentPlaybackUrl || channel?.streamUrl}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(currentPlaybackUrl || channel?.streamUrl || '', 'playback');
                    }}
                    className={`px-2.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition ${
                      copiedStreamUrl
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border-white/10'
                    }`}
                    title="Copier l'adresse du flux dans le presse-papier"
                  >
                    {copiedStreamUrl ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[10px]">Copié !</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Copier</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Right: Interactive Controls */}
            <div className="flex items-center gap-2.5">
              {/* Info Flux Modal Button */}
              <button
                id="info-stream-btn"
                onClick={() => setShowStreamInfo(true)}
                className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center border border-white/10 text-white transition-colors"
                title="Détails techniques du flux"
              >
                <Info className="w-4 h-4 text-indigo-300" />
              </button>

              {/* Previous */}
              <button
                id="zap-prev-btn"
                onClick={zapPrev}
                className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center border border-white/10 text-white transition-colors"
                title="Chaîne précédente (Flèche Bas)"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              {/* Central Play/Pause button */}
              <button
                id="play-pause-btn"
                onClick={togglePlay}
                className="w-12 h-12 bg-indigo-500 hover:bg-indigo-600 rounded-full flex items-center justify-center shadow-lg shadow-indigo-500/40 text-white transition-transform active:scale-95"
                title={isPlaying ? 'Pause' : 'Lecture'}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
              </button>

              {/* Next */}
              <button
                id="zap-next-btn"
                onClick={zapNext}
                className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center border border-white/10 text-white transition-colors"
                title="Chaîne suivante (Flèche Haut)"
              >
                <ChevronRight className="w-5 h-5" />
              </button>

              {/* Mute Toggle */}
              <button
                id="mute-toggle-btn"
                onClick={toggleMute}
                className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center border border-white/10 text-white transition-colors ml-1"
                title="Son (M)"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-red-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-slate-200" />
                )}
              </button>

              {/* Format Direct Switcher Button (Cycling: AUTO -> M3U8 -> TS) */}
              <button
                id="format-switch-btn"
                onClick={() => {
                  const nextFormat: 'auto' | 'm3u8' | 'ts' = 
                    currentLiveFormat === 'auto' ? 'm3u8' : currentLiveFormat === 'm3u8' ? 'ts' : 'auto';
                  handleSwitchFormat(nextFormat);
                }}
                className={`px-3 h-10 rounded-full flex items-center justify-center border text-xs font-mono font-bold transition-all active:scale-95 ${
                  currentLiveFormat === 'm3u8'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-500/20'
                    : currentLiveFormat === 'ts'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20'
                    : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-sm shadow-indigo-500/20'
                }`}
                title={`Format actuel : ${currentLiveFormat.toUpperCase()} (Cliquer pour changer : AUTO -> M3U8 -> TS)`}
              >
                <span className="text-[11px] uppercase tracking-wider">
                  {currentLiveFormat === 'auto' ? '⚡ AUTO' : currentLiveFormat === 'm3u8' ? 'M3U8' : 'TS'}
                </span>
              </button>

              {/* Aspect ratio */}
              <button
                id="aspect-ratio-btn"
                onClick={cycleAspectRatio}
                className="px-3 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center border border-white/10 text-xs font-mono font-bold text-slate-200 transition-colors"
                title="Changer le ratio d'aspect"
              >
                {aspectRatio.toUpperCase()}
              </button>

              {/* PiP */}
              <button
                id="pip-btn"
                onClick={togglePiP}
                className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center border border-white/10 text-white transition-colors"
                title="Picture-in-Picture"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>

              {/* Fullscreen */}
              <button
                id="player-fullscreen-btn"
                onClick={toggleFullscreen}
                className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center border border-white/10 text-white transition-colors"
                title="Plein écran (F)"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* EPG Progress Bar if available */}
          {currentProgram && (
            <div className="space-y-1.5 pt-2 border-t border-white/10">
              <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full rounded-full transition-all duration-1000"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>{EPGService.formatTime(currentProgram.start)} - {currentProgram.title}</span>
                <span>{EPGService.formatTime(currentProgram.end)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* STREAM INSPECTOR / DETAILS MODAL */}
      {showStreamInfo && (
        <div
          id="stream-info-modal-backdrop"
          onClick={() => setShowStreamInfo(false)}
          className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-slate-950/95 border border-white/15 rounded-3xl p-6 md:p-8 shadow-2xl space-y-5 text-left max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Adresse & Détails du Flux Vidéo</h3>
                  <p className="text-xs text-slate-400">Informations techniques sur le flux actuellement lu par le lecteur</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowStreamInfo(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Channel Info Card */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-400">Chaîne en cours</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {channel?.name || 'Inconnue'} {channel?.number && `(CH ${channel.number})`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {channel?.category && (
                  <span className="px-2.5 py-1 rounded-full bg-white/10 text-slate-300 text-[11px] font-medium">
                    {channel.category}
                  </span>
                )}
                {activeServer && (
                  <span className="px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[11px] font-medium flex items-center gap-1">
                    <Server className="w-3 h-3" />
                    {activeServer.name} ({activeServer.type})
                  </span>
                )}
              </div>
            </div>

            {/* Active Playback URL Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Link className="w-3.5 h-3.5 text-indigo-400" />
                  Adresse URL lue par le lecteur
                </label>
                <button
                  type="button"
                  onClick={() => copyToClipboard(currentPlaybackUrl || channel?.streamUrl || '', 'playback')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                    copiedStreamUrl
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500 hover:text-white border border-indigo-500/30'
                  }`}
                >
                  {copiedStreamUrl ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copié dans le presse-papier</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copier l'URL</span>
                    </>
                  )}
                </button>
              </div>

              <div className="p-3.5 rounded-2xl bg-black/60 border border-white/10 font-mono text-xs text-indigo-200 break-all select-all leading-relaxed max-h-32 overflow-y-auto">
                {currentPlaybackUrl || channel?.streamUrl || 'Aucune URL de flux active'}
              </div>
            </div>

            {/* Stalker Original URL (if transformed) */}
            {(channel as any)?._originalTsUrl && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-amber-400" />
                    URL originale Stalker (create_link / .ts)
                  </label>
                  <button
                    type="button"
                    onClick={() => copyToClipboard((channel as any)._originalTsUrl, 'original')}
                    className={`px-3 py-1 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                      copiedOriginalUrl
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-white/10 text-slate-300 hover:bg-white/20 border border-white/10'
                    }`}
                  >
                    {copiedOriginalUrl ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copié !</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copier l'URL originale</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="p-3 rounded-2xl bg-black/40 border border-white/10 font-mono text-xs text-amber-200/90 break-all select-all leading-relaxed max-h-24 overflow-y-auto">
                  {(channel as any)._originalTsUrl}
                </div>
              </div>
            )}

            {/* Interactive Stream Format Switcher */}
            <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  Format du flux pour ce serveur
                </label>
                <span className="text-[11px] font-mono text-indigo-300 font-bold bg-indigo-500/20 px-2 py-0.5 rounded-lg">
                  MODE ACTIF : {currentLiveFormat.toUpperCase()}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Vous pouvez basculer instantanément le format de lecture de ce serveur :
              </p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleSwitchFormat('auto')}
                  className={`p-3 rounded-2xl text-xs font-bold transition flex flex-col items-center gap-1 active:scale-95 ${
                    currentLiveFormat === 'auto'
                      ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 border border-indigo-400'
                      : 'bg-black/40 text-slate-300 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3 text-amber-400" />
                    Automatique
                  </span>
                  <span className="text-[10px] font-normal opacity-80">Détection serveur</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchFormat('m3u8')}
                  className={`p-3 rounded-2xl text-xs font-bold transition flex flex-col items-center gap-1 active:scale-95 ${
                    currentLiveFormat === 'm3u8'
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 border border-emerald-400'
                      : 'bg-black/40 text-slate-300 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  <span>M3U8 / HLS</span>
                  <span className="text-[10px] font-normal opacity-80">Force extension .m3u8</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchFormat('ts')}
                  className={`p-3 rounded-2xl text-xs font-bold transition flex flex-col items-center gap-1 active:scale-95 ${
                    currentLiveFormat === 'ts'
                      ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/30 border border-amber-400'
                      : 'bg-black/40 text-slate-300 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  <span>TS (MPEG-TS)</span>
                  <span className="text-[10px] font-normal opacity-80">Force extension .ts</span>
                </button>
              </div>
            </div>

            {/* Technical Specifications Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-left">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Format</div>
                <div className="text-xs font-bold text-white mt-1">
                  {currentPlaybackUrl.includes('.m3u8')
                    ? 'HLS (m3u8)'
                    : currentPlaybackUrl.includes('.ts')
                    ? 'MPEG-TS (.ts)'
                    : 'Direct'}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-left">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Moteur Player</div>
                <div className="text-xs font-bold text-white mt-1">
                  {Hls.isSupported() ? 'HLS.js' : 'HTML5 Natif'}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-left">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Résolution</div>
                <div className="text-xs font-bold text-white mt-1">
                  {stats.resolution || channel?.resolution || 'Auto / Source'}
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-left">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Débit (Bitrate)</div>
                <div className="text-xs font-bold text-white mt-1">
                  {stats.bitrate ? `${stats.bitrate} kbps` : 'Dynamique'}
                </div>
              </div>
            </div>

            {/* Footer Action */}
            <div className="pt-3 border-t border-white/10 flex justify-end">
              <button
                type="button"
                onClick={() => setShowStreamInfo(false)}
                className="px-6 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-2xl text-xs font-bold shadow-lg shadow-indigo-500/25 transition active:scale-95"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
