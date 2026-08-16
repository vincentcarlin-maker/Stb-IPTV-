import React, { useRef, useEffect, useState, useCallback } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
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
  X,
  Copy,
  Cpu,
  MoreHorizontal,
  Grid3X3,
  Star
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { EPGService } from '../services/epgService';
import { Channel } from '../types/iptv';
import { isFullscreen as checkIsFullscreen, safeToggleFullscreen } from '../utils/fullscreen';
import { PlayerQuickMenu } from './PlayerQuickMenu';
import { MediaDetailsModal, MediaDetailsInfo } from './MediaDetailsModal';

export type PlayerEngineType = 'mpegts' | 'hls' | 'native';

/**
 * Stream Engine Detection Logic
 * - video/mp2t (.ts, output=ts, format=ts) -> mpegts.js
 * - m3u8 manifests (.m3u8, application/x-mpegURL, format=m3u8) -> HLS.js
 * - mp4 (.mp4, video/mp4, format=mp4) -> Native HTML5
 */
export function detectStreamEngine(url: string, explicitFormat?: string): PlayerEngineType {
  let urlToCheck = (url || '').trim();
  const formatLower = (explicitFormat || '').toLowerCase();

  // If URL is a proxied URL, extract and decode target URL first
  if (urlToCheck.includes('/api/proxy/stream') && urlToCheck.includes('url=')) {
    try {
      const parsed = new URL(urlToCheck, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
      const targetParam = parsed.searchParams.get('url');
      if (targetParam) {
        urlToCheck = decodeURIComponent(targetParam);
      }
    } catch {
      const match = urlToCheck.match(/[?&]url=([^&]+)/);
      if (match && match[1]) {
        try {
          urlToCheck = decodeURIComponent(match[1]);
        } catch {
          urlToCheck = match[1];
        }
      }
    }
  }

  const urlLower = urlToCheck.toLowerCase();

  // 1. MPEG2-TS / Transport Stream (H.264 / AVC + AAC in MPEG-TS container)
  // Handles: video/mp2t, extension=ts, extension%3Dts, .ts, output=ts, format=ts, /play/live.php, /live.php?, stalker IPTV streams
  if (
    formatLower.includes('video/mp2t') ||
    formatLower.includes('video/ts') ||
    formatLower.includes('mp2t') ||
    formatLower === 'ts' ||
    formatLower.includes('h264') ||
    formatLower.includes('avc') ||
    urlLower.includes('extension=ts') ||
    urlLower.includes('extension%3dts') ||
    urlLower.includes('.ts') ||
    urlLower.includes('output=ts') ||
    urlLower.includes('output%3dts') ||
    urlLower.includes('format=ts') ||
    urlLower.includes('format%3dts') ||
    urlLower.includes('/play/live.php') ||
    urlLower.includes('/live.php') ||
    urlLower.includes('stream=') ||
    urlLower.includes('play_token=')
  ) {
    return 'mpegts';
  }

  // 2. MP4 / progressive video formats
  if (
    formatLower.includes('video/mp4') ||
    formatLower.includes('mp4') ||
    urlLower.includes('.mp4') ||
    urlLower.includes('format=mp4') ||
    urlLower.includes('output=mp4')
  ) {
    return 'native';
  }

  // 3. HLS (.m3u8 manifests)
  if (
    formatLower.includes('mpegurl') ||
    formatLower.includes('m3u8') ||
    formatLower === 'hls' ||
    urlLower.includes('.m3u8') ||
    urlLower.includes('output=m3u8') ||
    urlLower.includes('output=hls') ||
    urlLower.includes('format=m3u8') ||
    urlLower.includes('format=hls')
  ) {
    return 'hls';
  }

  // Default fallback: If ts/live.php in URL, use mpegts; if .mp4, use native; else HLS
  if (urlLower.includes('ts') || urlLower.includes('live.php')) return 'mpegts';
  if (urlLower.includes('.mp4')) return 'native';
  return 'hls';
}

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
    stalkerService,
    favorites,
    toggleFavorite,
    setActiveView,
    setIsVirtualRemoteOpen,
    requestPinForAction,
  } = useIPTV();

  const channel = channelOverride !== undefined ? channelOverride : contextChannel;
  const isFavorite = channel ? favorites.includes(channel.id) : false;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const activeEngineRef = useRef<PlayerEngineType | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osdTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [activeEngineName, setActiveEngineName] = useState<string>('HLS.js');
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
  const proxyRetriedRef = useRef<boolean>(false);

  // Stream Diagnostic & Playback States
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [diagnosticLoading, setDiagnosticLoading] = useState<boolean>(false);
  const [diagnosticData, setDiagnosticData] = useState<any>(null);
  const [playerState, setPlayerState] = useState<'loading' | 'playing' | 'paused' | 'error' | 'stopped'>('loading');
  const [lastPlayerError, setLastPlayerError] = useState<string | null>(null);

  // Quick Actions Menu & Media Details Modal (Specification from Screenshot)
  const [showQuickMenu, setShowQuickMenu] = useState<boolean>(false);
  const [showMediaDetails, setShowMediaDetails] = useState<boolean>(false);
  const [mediaDetails, setMediaDetails] = useState<MediaDetailsInfo>({
    videoCodec: 'h264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
    resolution: '1920.0x1080.0',
    fps: '50.0fps',
    audioCodec: 'aac AAC (Advanced Audio Coding)',
    audioChannels: '2 channels',
    url: '',
  });
  const [subtitlesActive, setSubtitlesActive] = useState<boolean>(false);
  const [cropActive, setCropActive] = useState<boolean>(false);
  const [activeFilterIndex, setActiveFilterIndex] = useState<number>(0);
  const [sleepTimerMinutes, setSleepTimerMinutes] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  /**
   * Safe destruction of any existing stream engine instances
   * Ensures .destroy() is strictly invoked before instantiating new engines
   */
  const destroyEngines = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.stopLoad();
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
      } catch (err) {
        console.warn('[LivePlayer] Error destroying HLS instance:', err);
      }
      hlsRef.current = null;
    }

    if (mpegtsRef.current) {
      try {
        mpegtsRef.current.pause();
        mpegtsRef.current.unload();
        mpegtsRef.current.detachMediaElement();
        mpegtsRef.current.destroy();
      } catch (err) {
        console.warn('[LivePlayer] Error destroying mpegts instance:', err);
      }
      mpegtsRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      } catch {
        // ignore
      }
    }

    activeEngineRef.current = null;
  }, []);

  const maskSensitive = (val: string): string => {
    if (!val) return 'Aucun';
    // Mask MAC Address e.g. 00:1A:79:33:44:55 -> 00:1A:79:XX:XX:XX
    if (/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(val) || val.includes(':')) {
      const parts = val.split(/[: -]/);
      if (parts.length === 6) {
        return `${parts[0]}:${parts[1]}:${parts[2]}:XX:XX:XX`;
      }
    }
    // Mask generic tokens
    if (val.length > 8) {
      return `${val.substring(0, 4)}...XXXX...${val.substring(val.length - 4)}`;
    }
    return 'XXXX';
  };

  const runStreamDiagnostic = async () => {
    if (!channel) return;
    setDiagnosticLoading(true);
    setShowDiagnostics(true);

    const streamUrlRaw = channel.streamUrl ? channel.streamUrl.trim() : '';
    const isStalker = activeServer?.type === 'stalker';
    const isXtream = activeServer?.type === 'xtream';
    const isM3U = !isStalker && !isXtream;
    const mac = isStalker ? (stalkerService?.getMac() || activeServer?.macAddress || '') : '';
    const token = isStalker ? (stalkerService?.getToken() || '') : '';

    const serverTypeLabel = isStalker ? 'Stalker Portal' : (isXtream ? 'Xtream Codes' : 'M3U Playlist');

    // Diagnose browser blocks (Mixed Content / CORS)
    const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const isHttpStream = streamUrlRaw.startsWith('http://');
    let browserBlockNotice = '';
    if (isHttpsPage && isHttpStream && !playerSettings.useStreamProxy) {
      browserBlockNotice = "Le navigateur va probablement bloquer ce flux en raison des règles de sécurité sur le contenu mixte (flux HTTP sur page HTTPS). Veuillez activer le proxy de flux dans les réglages.";
    }

    const isStaticDeploy = typeof window !== 'undefined' && (
      window.location.hostname.includes('github.io') || 
      window.location.hostname.includes('github.pages') ||
      window.location.hostname.includes('pages.dev') ||
      window.location.hostname.includes('netlify.app') ||
      window.location.hostname.includes('vercel.app')
    );

    const useProxy = !isStaticDeploy && (
      isStalker || 
      playerSettings.useStreamProxy ||
      (isHttpStream && isHttpsPage)
    );

    const finalPlayerUrl = useProxy 
      ? `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}` 
      : streamUrlRaw;

    const proxyUrlUsed = useProxy ? finalPlayerUrl : 'Aucune';

    const testUrl = `/api/proxy/test?url=${encodeURIComponent(streamUrlRaw)}&mac=${encodeURIComponent(mac)}&token=${encodeURIComponent(token)}`;

    let testResult: any = null;
    try {
      const res = await fetch(testUrl);
      if (res.ok) {
        testResult = await res.json();
      } else {
        testResult = { status: res.status, error: res.statusText };
      }
    } catch (e: any) {
      testResult = { status: 0, error: e.message || 'Erreur de connexion réseau' };
    }

    const data = {
      channelName: channel.name,
      channelId: channel.id,
      channelType: serverTypeLabel,
      cmd: channel.cmd || 'Aucun',
      
      portalType: serverTypeLabel,
      portalUrl: activeServer?.portalUrl || activeServer?.m3uUrl || 'Aucune',
      macPresent: mac ? 'Oui' : 'Non',
      tokenPresent: token ? 'Oui' : 'Non',
      cookiesPresent: isStalker && mac ? 'Oui (cookie mac=...)' : 'Non',
      mac,
      token,

      originalCmd: channel.cmd || 'Aucun',
      createLinkUrl: isStalker ? streamUrlRaw : 'Non applicable (Xtream/M3U)',
      finalPlayerUrl,
      useProxy: useProxy ? 'Oui' : 'Non',
      proxyUrlUsed,
      resolvedUrl: streamUrlRaw,

      httpStatus: testResult?.status !== undefined ? testResult.status : 'N/A',
      statusText: testResult?.statusText || 'N/A',
      contentType: testResult?.contentType || 'N/A',
      redirect: !!testResult?.redirect,
      redirectUrl: testResult?.redirectUrl || 'N/A',
      formatDetected: testResult?.contentType ? testResult.contentType : (streamUrlRaw.includes('.m3u8') ? 'application/x-mpegURL (m3u8)' : 'video/mp2t (.ts)'),
      errorText: testResult?.error || 'Aucune',

      // New diagnostic fields
      source503: testResult?.source === 'UPSTREAM_SERVER' ? 'Serveur IPTV' : (testResult?.source === 'LOCAL_PROXY' ? 'Proxy local' : 'Aucune (Flux OK)'),
      networkError: testResult?.errorCode && testResult.errorCode !== 'none' ? testResult.errorCode : 'aucune',
      dnsResolved: testResult?.dnsResolved !== undefined ? (testResult.dnsResolved ? 'Oui' : 'Non') : 'N/A',
      tcpConnected: testResult?.tcpConnected !== undefined ? (testResult.tcpConnected ? 'Oui' : 'Non') : 'N/A',

      playerType: mpegtsRef.current 
        ? 'mpegts.js (MPEG2-TS / video/mp2t)' 
        : (hlsRef.current 
            ? 'HLS.js (Manifeste .m3u8)' 
            : (activeEngineRef.current === 'native' ? 'HTML5 Video (Natif / MP4)' : 'HTML5 Video (Natif)')),
      mpegtsActive: mpegtsRef.current ? 'Oui' : 'Non',
      hlsActive: hlsRef.current ? 'Oui' : 'Non',
      engineSelected: activeEngineRef.current || detectStreamEngine(streamUrlRaw),
      playerState: playerState,
      lastError: lastPlayerError || 'Aucune',
      completeErrorMessage: lastPlayerError || 'Aucune erreur détectée',
      browserBlockNotice,
    };

    setDiagnosticData(data);
    setDiagnosticLoading(false);

    // Format console logs exactly as requested in SPECIFICATION 5
    console.log(`===== CHANNEL PLAYBACK DEBUG =====
CHANNEL CLICKED
name: ${data.channelName}
id: ${data.channelId}
cmd: ${data.cmd}
SESSION
token présent: ${data.tokenPresent}
cookies présents: ${data.cookiesPresent}
MAC configurée: ${mac ? maskSensitive(mac) : 'Non'}
CREATE LINK REQUEST
endpoint: ${isStalker ? '/api/stalker/proxy (create_link)' : 'N/A (Xtream/M3U)'}
method: POST
parameters: ${isStalker ? JSON.stringify({ cmd: data.cmd, action: 'create_link' }) : 'N/A'}
CREATE LINK RESPONSE
HTTP status: ${isStalker && data.resolvedUrl ? '200' : 'N/A'}
response: ${isStalker && data.resolvedUrl ? JSON.stringify({ js: { cmd: maskSensitive(data.resolvedUrl) } }) : 'N/A'}
FINAL STREAM
original cmd: ${data.cmd}
resolved URL: ${maskSensitive(data.resolvedUrl)}
protocol: ${data.resolvedUrl.startsWith('https') ? 'HTTPS' : 'HTTP'}
format détecté: ${data.formatDetected}
engine sélectionné: ${data.engineSelected}
PLAYER
player initialized: ${videoRef.current ? 'Oui' : 'Non'}
player engine: ${data.playerType}
mpegts.js active: ${data.mpegtsActive}
hls.js active: ${data.hlsActive}
media URL: ${maskSensitive(finalPlayerUrl)}
playback state: ${data.playerState}
HTTP error: ${data.httpStatus !== 200 && data.httpStatus !== 'N/A' ? `${data.httpStatus} ${data.statusText}` : 'Aucune'}
player error: ${data.lastError}
codec error: ${data.lastError.includes('decode') || data.lastError.includes('media') ? 'Oui' : 'Non'}
==================================`);
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
      setShowOSD(false);
      setShowSettingsMenu(false);
    }, (playerSettings.osdTimeout || 4) * 1000);
  }, [playerSettings.osdTimeout]);

  // Handle stream loading with dedicated engine selection:
  // - mpegts.js for video/mp2t (MPEG2-TS)
  // - HLS.js for .m3u8 manifests
  // - HTML5 native for .mp4 and browser supported streams
  useEffect(() => {
    proxyRetriedRef.current = false;

    // Clean up previous player instances before initializing a new one
    destroyEngines();

    if (!channel || !videoRef.current) {
      setIsLoadingStream(false);
      return;
    }

    const streamUrlRaw = channel.streamUrl ? channel.streamUrl.trim() : (channel.cmd || '');
    
    // Always initialize mediaDetails with channel data so it is immediately accessible even if stream is down
    setMediaDetails({
      videoCodec: channel.videoCodec || 'h264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
      resolution: channel.resolution ? `${channel.resolution}.0` : '1920.0x1080.0',
      fps: '50.0fps',
      audioCodec: channel.audioCodec || 'aac AAC (Advanced Audio Coding)',
      audioChannels: '2 channels',
      url: streamUrlRaw,
    });

    if (!streamUrlRaw) {
      setIsLoadingStream(false);
      setStreamError('Aucune adresse de flux disponible pour cette chaîne.');
      return;
    }

    setIsLoadingStream(true);
    setStreamError(null);
    triggerOSD();

    const video = videoRef.current;
    let initialUrl = streamUrlRaw;

    const isStaticDeploy = typeof window !== 'undefined' && (
      window.location.hostname.includes('github.io') || 
      window.location.hostname.includes('github.pages') ||
      window.location.hostname.includes('pages.dev') ||
      window.location.hostname.includes('netlify.app') ||
      window.location.hostname.includes('vercel.app')
    );
    const isStalker = activeServer?.type === 'stalker';
    const isHttp = streamUrlRaw.startsWith('http://');
    const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    
    // Use stream proxy if Stalker portal (CORS & cookie requirement), useStreamProxy setting, or Mixed Content (HTTP on HTTPS page)
    const useProxy = !isStaticDeploy && (
      isStalker || 
      playerSettings.useStreamProxy ||
      (isHttp && isHttpsPage)
    );

    if (useProxy && !initialUrl.startsWith('/api/proxy')) {
      const macQuery = isStalker && activeServer?.macAddress ? `&mac=${encodeURIComponent(activeServer.macAddress)}` : '';
      initialUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}${macQuery}`;
    }

    setPlayerState('loading');

    // Detect appropriate engine for the stream format
    const selectedEngine = detectStreamEngine(initialUrl, (channel as any).format);

    // Safety timeout: 12s for direct stream / proxy fallback (shorter on static deployments)
    const streamTimeout = setTimeout(() => {
      if (!proxyRetriedRef.current && !streamUrlRaw.startsWith('/api/proxy') && !isStaticDeploy) {
        proxyRetriedRef.current = true;
        const macQuery = isStalker && activeServer?.macAddress ? `&mac=${encodeURIComponent(activeServer.macAddress)}` : '';
        const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(channel.backupStreamUrl || streamUrlRaw)}${macQuery}`;
        setPlayerState('loading');
        
        if (selectedEngine === 'mpegts' && mpegts.isSupported()) {
          destroyEngines();
          const retryPlayer = mpegts.createPlayer(
            { type: 'mpegts', isLive: true, url: proxyUrl },
            { enableWorker: true, enableStashBuffer: false }
          );
          retryPlayer.attachMediaElement(video);
          retryPlayer.load();
          const playRes = retryPlayer.play();
          if (playRes && typeof (playRes as any).catch === 'function') {
            (playRes as Promise<void>).catch(() => {});
          }
          mpegtsRef.current = retryPlayer;
        } else if (hlsRef.current) {
          hlsRef.current.loadSource(proxyUrl);
        } else if (videoRef.current) {
          videoRef.current.src = proxyUrl;
          videoRef.current.play().catch(() => {});
        }

        // Second safety timeout for proxy attempt (8s)
        setTimeout(() => {
          setIsLoadingStream(false);
          setPlayerState('error');
          setStreamError('Le flux de cette chaîne ne répond pas. Cliquez sur la liste des chaînes pour zapper.');
          setLastPlayerError('Timeout: Aucune réponse de l\'adresse de streaming.');
        }, 8000);
      } else {
        setIsLoadingStream(false);
        setPlayerState('error');
        setStreamError('Le flux vidéo ne répond pas. Veuillez sélectionner une autre chaîne dans la liste.');
        setLastPlayerError('Timeout: Pas de flux reçu.');
      }
    }, isStaticDeploy ? 4000 : 12000);

    // ==========================================
    // 1. MPEG-TS ENGINE (mpegts.js) for video/mp2t
    // ==========================================
    if (selectedEngine === 'mpegts' && mpegts.isSupported()) {
      activeEngineRef.current = 'mpegts';
      setActiveEngineName('MPEG-TS (mpegts.js)');

      try {
        const mpegtsPlayer = mpegts.createPlayer(
          {
            type: 'mpegts',
            isLive: true,
            url: initialUrl,
            cors: true,
            hasAudio: true,
            hasVideo: true,
          },
          {
            enableWorker: true,
            enableStashBuffer: false,
            stashInitialSize: 128,
            liveBufferLatencyChasing: true,
            liveBufferLatencyMaxLatency: 3.0,
            liveBufferLatencyMinRemain: 0.5,
            lazyLoad: false,
            autoCleanupSourceBuffer: true,
            autoCleanupMaxBackwardDuration: 30,
            autoCleanupMinBackwardDuration: 15,
            fixAudioTimestampGap: true,
            accurateSeek: false,
          }
        );

        mpegtsPlayer.attachMediaElement(video);
        mpegtsPlayer.load();

        mpegtsPlayer.on(mpegts.Events.MEDIA_INFO, (info: any) => {
          clearTimeout(streamTimeout);
          setIsLoadingStream(false);
          setStreamError(null);
          setPlayerState('playing');
          setLastPlayerError(null);
          if (info?.width && info?.height) {
            setStats(prev => ({
              ...prev,
              resolution: `${info.width}x${info.height}`,
              fps: info.fps ? Math.round(info.fps) : prev.fps,
            }));
          }
          setMediaDetails(prev => ({
            ...prev,
            videoCodec: info?.videoCodec ? `${info.videoCodec} H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10` : prev.videoCodec,
            resolution: info?.width && info?.height ? `${info.width.toFixed(1)}x${info.height.toFixed(1)}` : prev.resolution,
            fps: info?.fps ? `${info.fps.toFixed(1)}fps` : prev.fps,
            audioCodec: info?.audioCodec ? `${info.audioCodec} AAC (Advanced Audio Coding)` : prev.audioCodec,
            audioChannels: info?.audioChannelCount ? `${info.audioChannelCount} channels` : prev.audioChannels,
            url: streamUrlRaw,
          }));
        });

        mpegtsPlayer.on(mpegts.Events.STATISTICS_INFO, (statInfo: any) => {
          if (statInfo?.speed) {
            setStats(prev => ({ ...prev, bitrate: Math.round(statInfo.speed * 8) }));
          }
          if (statInfo?.decodedFrames && statInfo.decodedFrames > 0) {
            setIsLoadingStream(false);
            setPlayerState('playing');
          }
        });

        mpegtsPlayer.on(mpegts.Events.ERROR, (errorType: string, errorDetail: string, errorInfo: any) => {
          console.warn('[LivePlayer mpegts.js] Error:', errorType, errorDetail, errorInfo);
          setPlayerState('error');
          setLastPlayerError(`${errorType}: ${errorDetail}`);

          if (errorType === mpegts.ErrorTypes.NETWORK_ERROR) {
            if (!proxyRetriedRef.current && !initialUrl.startsWith('/api/proxy')) {
              proxyRetriedRef.current = true;
              const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}`;
              console.log('[LivePlayer] Network error on direct TS stream, attempting proxy fallback:', proxyUrl);
              destroyEngines();
              const retryPlayer = mpegts.createPlayer(
                { type: 'mpegts', isLive: true, url: proxyUrl },
                { enableWorker: true, enableStashBuffer: false, liveBufferLatencyChasing: true }
              );
              retryPlayer.attachMediaElement(video);
              retryPlayer.load();
              const playRes = retryPlayer.play();
              if (playRes && typeof (playRes as any).catch === 'function') {
                (playRes as Promise<void>).catch(() => {});
              }
              mpegtsRef.current = retryPlayer;
              return;
            }
          }

          destroyEngines();
          setStreamError('Impossible de joindre le flux vidéo MPEG2-TS (video/mp2t).');
          setIsLoadingStream(false);
        });

        const playPromise = mpegtsPlayer.play();
        if (playPromise && typeof (playPromise as any).catch === 'function') {
          (playPromise as Promise<void>).catch(() => {
            setIsPlaying(false);
            setPlayerState('paused');
          });
        }

        mpegtsRef.current = mpegtsPlayer;
      } catch (err: any) {
        console.warn('[LivePlayer] Failed to instantiate mpegts.js player:', err);
        // Fallback to native HTML5 if mpegts initialization failed
        activeEngineRef.current = 'native';
        setActiveEngineName('HTML5 Video');
        video.src = initialUrl;
        video.play().catch(() => {});
      }
    } 
    // ==========================================
    // 2. HLS ENGINE (Hls.js) for .m3u8 manifests
    // ==========================================
    else if (selectedEngine === 'hls' && Hls.isSupported()) {
      activeEngineRef.current = 'hls';
      setActiveEngineName('HLS (HLS.js)');

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: playerSettings.bufferLength === 'low',
        backBufferLength: playerSettings.bufferLength === 'high' ? 60 : 30,
        maxBufferLength: playerSettings.bufferLength === 'high' ? 60 : 30,
        fragLoadingTimeOut: 8000,
        manifestLoadingTimeOut: 8000,
        levelLoadingTimeOut: 8000,
      });

      hls.loadSource(initialUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        clearTimeout(streamTimeout);
        setIsLoadingStream(false);
        setStreamError(null);
        setPlayerState('playing');
        setLastPlayerError(null);
        video.play().catch(() => {
          setIsPlaying(false);
          setPlayerState('paused');
        });
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
        setPlayerState('error');
        setLastPlayerError(`${data.type}: ${data.details}`);
        if (data.fatal) {
          clearTimeout(streamTimeout);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (!proxyRetriedRef.current && channel?.backupStreamUrl) {
                proxyRetriedRef.current = true;
                const backupUrl = `/api/proxy/stream?url=${encodeURIComponent(channel.backupStreamUrl)}`;
                console.log('[LivePlayer] Network error on primary stream, trying backup format:', backupUrl);
                hls.loadSource(backupUrl);
              } else if (!proxyRetriedRef.current && !initialUrl.startsWith('/api/proxy')) {
                proxyRetriedRef.current = true;
                const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}`;
                console.log('[LivePlayer] Network error on direct stream, attempting proxy fallback:', proxyUrl);
                hls.loadSource(proxyUrl);
              } else {
                destroyEngines();
                setStreamError('Impossible de joindre le flux vidéo HLS. Le serveur IPTV ou la source est inaccessible.');
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
                  destroyEngines();
                  setStreamError('Erreur de décodage du flux média HLS.');
                  setIsLoadingStream(false);
                }
              }
              break;
            default:
              destroyEngines();
              setStreamError('Erreur critique lors de la lecture du flux HLS.');
              setIsLoadingStream(false);
              break;
          }
        }
      });

      hlsRef.current = hls;
    } 
    // ==========================================
    // 2b. Safari Native HLS Fallback
    // ==========================================
    else if (selectedEngine === 'hls' && video.canPlayType('application/vnd.apple.mpegurl')) {
      activeEngineRef.current = 'native';
      setActiveEngineName('HLS (Natif Apple)');
      video.src = initialUrl;
      const onLoaded = () => {
        clearTimeout(streamTimeout);
        setIsLoadingStream(false);
        setStreamError(null);
        setPlayerState('playing');
        video.play().catch(() => setIsPlaying(false));
      };
      const onError = () => {
        clearTimeout(streamTimeout);
        if (!proxyRetriedRef.current && !streamUrlRaw.startsWith('/api/proxy')) {
          proxyRetriedRef.current = true;
          video.src = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}`;
          video.play().catch(() => {});
        } else {
          setStreamError('Erreur de lecture du média HLS natif.');
          setIsLoadingStream(false);
        }
      };

      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    } 
    // ==========================================
    // 3. NATIVE HTML5 ENGINE for .mp4 / progressive
    // ==========================================
    else {
      activeEngineRef.current = 'native';
      setActiveEngineName(selectedEngine === 'native' ? 'MP4 (HTML5 Natif)' : 'HTML5 Natif');
      video.src = initialUrl;
      const onLoaded = () => {
        clearTimeout(streamTimeout);
        setIsLoadingStream(false);
        setStreamError(null);
        setPlayerState('playing');
        setLastPlayerError(null);
        video.play().catch(() => setIsPlaying(false));
        if (video.videoWidth && video.videoHeight) {
          setStats(prev => ({
            ...prev,
            resolution: `${video.videoWidth}x${video.videoHeight}`,
          }));
          setMediaDetails(prev => ({
            ...prev,
            resolution: `${video.videoWidth.toFixed(1)}x${video.videoHeight.toFixed(1)}`,
            url: streamUrlRaw,
          }));
        }
      };
      const onError = () => {
        clearTimeout(streamTimeout);
        if (!proxyRetriedRef.current && !streamUrlRaw.startsWith('/api/proxy')) {
          proxyRetriedRef.current = true;
          const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}`;
          // Try fallback engines if initial direct format failed
          if (selectedEngine === 'mpegts' && mpegts.isSupported()) {
            destroyEngines();
            const retryPlayer = mpegts.createPlayer(
              { type: 'mpegts', isLive: true, url: proxyUrl },
              { enableWorker: true }
            );
            retryPlayer.attachMediaElement(video);
            retryPlayer.load();
            const playRes = retryPlayer.play();
            if (playRes && typeof (playRes as any).catch === 'function') {
              (playRes as Promise<void>).catch(() => {});
            }
            mpegtsRef.current = retryPlayer;
          } else if (Hls.isSupported()) {
            destroyEngines();
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
                destroyEngines();
                setStreamError('Impossible de joindre le flux vidéo (Proxy échoué).');
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
          setPlayerState('error');
          setLastPlayerError('Erreur de lecture HTML5 video.');
        }
      };
      video.addEventListener('loadeddata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    }

    return () => {
      clearTimeout(streamTimeout);
      destroyEngines();
    };
  }, [channel?.id, channel?.streamUrl, playerSettings.useStreamProxy, playerSettings.bufferLength, triggerOSD, retryCount, destroyEngines]);

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

  const filters = [
    { label: 'Normal', css: '' },
    { label: 'Vif', css: 'saturate-[1.35] contrast-[1.08]' },
    { label: 'Cinéma', css: 'contrast-[1.2] brightness-95' },
    { label: 'Chaud', css: 'sepia-[0.18] contrast-[1.05]' },
  ];

  const toggleSubtitles = () => {
    setSubtitlesActive((prev) => {
      const next = !prev;
      showToast(next ? 'Sous-titres : Activés' : 'Sous-titres : Désactivés');
      return next;
    });
  };

  const toggleCrop = () => {
    setCropActive((prev) => {
      const next = !prev;
      setAspectRatio(next ? 'fill' : '16:9');
      showToast(next ? 'Mode Recadrage : Plein Écran (Crop)' : 'Mode Normal : Format 16:9');
      return next;
    });
  };

  const cycleFilter = () => {
    const nextIdx = (activeFilterIndex + 1) % filters.length;
    setActiveFilterIndex(nextIdx);
    showToast(`Filtre Vidéo : ${filters[nextIdx].label}`);
  };

  const cycleAudioTrack = () => {
    showToast('Piste Audio : Principale (Stéréo AAC)');
  };

  const cycleSleepTimer = () => {
    if (sleepTimerMinutes === null) {
      setSleepTimerMinutes(30);
      showToast('Minuteur de veille activé : 30 min');
    } else if (sleepTimerMinutes === 30) {
      setSleepTimerMinutes(60);
      showToast('Minuteur de veille activé : 60 min');
    } else {
      setSleepTimerMinutes(null);
      showToast('Minuteur de veille désactivé');
    }
  };

  const sleepTimerLabel = sleepTimerMinutes ? `${sleepTimerMinutes}m` : 'Off';

  const cycleAspectRatio = () => {
    const ratios: ('16:9' | '4:3' | 'fill' | 'fit')[] = ['16:9', '4:3', 'fill', 'fit'];
    const nextIdx = (ratios.indexOf(aspectRatio) + 1) % ratios.length;
    setAspectRatio(ratios[nextIdx]);
    showToast(`Format d'écran : ${ratios[nextIdx].toUpperCase()}`);
    triggerOSD();
  };

  const getVideoClass = () => {
    const filterClass = filters[activeFilterIndex]?.css || '';
    let ratioClass = 'w-full h-full object-contain';
    switch (aspectRatio) {
      case '4:3':
        ratioClass = 'w-auto h-full aspect-[4/3] mx-auto object-contain';
        break;
      case 'fill':
        ratioClass = 'w-full h-full object-cover';
        break;
      case 'fit':
        ratioClass = 'w-full h-full object-contain';
        break;
      case '16:9':
      default:
        ratioClass = 'w-full h-full object-contain';
        break;
    }
    return `${ratioClass} ${filterClass}`.trim();
  };

  return (
    <div
      ref={containerRef}
      id="live-player-container"
      onMouseMove={triggerOSD}
      onClick={triggerOSD}
      className="relative w-full h-full bg-black/60 flex items-center justify-center overflow-hidden select-none group"
    >
      {/* ALWAYS VISIBLE FLOATING DEBUG BADGE & ACTION BUTTONS */}
      <div className="absolute top-4 right-4 z-50 flex flex-row items-center gap-2 pointer-events-auto">
        <span className="px-2.5 py-1.5 rounded-full bg-red-600 border border-red-500 text-white font-mono text-[10px] font-bold tracking-wider shadow-xl select-none">
          DEBUG PLAYER v1
        </span>
        {channel && (
          <>
            <button
              id="media-details-btn-floating"
              onClick={(e) => {
                e.stopPropagation();
                setShowMediaDetails(true);
              }}
              className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 border border-white/20 text-xs font-bold text-white flex items-center gap-1.5 shadow-2xl transition cursor-pointer"
              title="Afficher les détails techniques du média (URL, Codec, Définition)"
            >
              <Info className="w-3.5 h-3.5 text-indigo-400" />
              <span>Détails du média</span>
            </button>
            <button
              id="stream-diagnostic-btn-static"
              onClick={(e) => {
                e.stopPropagation();
                runStreamDiagnostic();
              }}
              disabled={diagnosticLoading}
              className="px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 border border-indigo-400/30 text-xs font-bold text-white flex items-center gap-1.5 shadow-2xl transition disabled:opacity-50 cursor-pointer"
            >
              <span className="text-white">🔧 Diagnostic du flux</span>
            </button>
          </>
        )}
      </div>

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

          <div className="flex flex-wrap items-center justify-center gap-3 pointer-events-auto">
            {showChannelListToggle && (
              <button
                onClick={showChannelListToggle}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-full flex items-center gap-2 shadow-lg transition active:scale-95 cursor-pointer"
              >
                <ListFilter className="w-3.5 h-3.5" />
                <span>Changer de chaîne</span>
              </button>
            )}
            <button
              onClick={() => setShowMediaDetails(true)}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-full flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
            >
              <Info className="w-3.5 h-3.5 text-indigo-400" />
              <span>Détails du média</span>
            </button>
            <button
              onClick={() => setIsLoadingStream(false)}
              className="px-4 py-2 bg-white/5 hover:bg-white/15 text-slate-300 text-xs font-medium rounded-full transition active:scale-95 cursor-pointer"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Stream Error Modal (Frosted Glass) */}
      {streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-3xl z-30 p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4 text-red-400">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Signal Indisponible</h3>
          <p className="text-xs text-slate-300 max-w-md mb-5">{streamError}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* Direct Media Details Button when stream is unavailable */}
            <button
              id="error-media-details-btn"
              onClick={() => setShowMediaDetails(true)}
              className="px-4 py-2.5 bg-white/15 hover:bg-white/25 border border-white/20 text-white rounded-full text-xs font-semibold flex items-center gap-2 shadow-lg transition active:scale-95 cursor-pointer"
              title="Consulter les détails du média (URL, Codec, Audio)"
            >
              <Info className="w-4 h-4 text-indigo-400" />
              <span>Détails du média</span>
            </button>
            <button
              id="error-diagnostics-btn"
              onClick={runStreamDiagnostic}
              className="px-4 py-2.5 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-200 rounded-full text-xs font-semibold flex items-center gap-2 transition active:scale-95 cursor-pointer"
            >
              <span>🔧 Diagnostic technique</span>
            </button>
            <button
              onClick={() => {
                setRetryCount((c) => c + 1);
              }}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-xs font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/25 transition active:scale-95 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Réessayer le signal
            </button>
            <button
              onClick={() => {
                updatePlayerSettings({ useStreamProxy: !playerSettings.useStreamProxy });
                setRetryCount((c) => c + 1);
              }}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white rounded-full text-xs font-semibold flex items-center gap-2 transition active:scale-95 cursor-pointer"
            >
              Proxy ({playerSettings.useStreamProxy ? 'Actif' : 'Inactif'})
            </button>
            <button
              onClick={zapNext}
              className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-full text-xs font-semibold transition active:scale-95 cursor-pointer"
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
                className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white flex items-center gap-2 backdrop-blur-2xl transition shadow-lg cursor-pointer"
              >
                <ListFilter className="w-4 h-4 text-indigo-400" />
                Liste des chaînes
              </button>
            )}
            {onOpenEPGModal && (
              <button
                id="open-epg-guide-btn"
                onClick={onOpenEPGModal}
                className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white flex items-center gap-2 backdrop-blur-2xl transition shadow-lg cursor-pointer"
              >
                <Clock className="w-4 h-4 text-amber-400" />
                Guide TV (EPG)
              </button>
            )}
            <button
              id="top-bar-media-details-btn"
              onClick={() => setShowMediaDetails(true)}
              className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white flex items-center gap-2 backdrop-blur-2xl transition shadow-lg cursor-pointer"
            >
              <Info className="w-4 h-4 text-indigo-400" />
              Détails du média
            </button>
            <button
              id="stream-diagnostic-btn"
              onClick={runStreamDiagnostic}
              disabled={diagnosticLoading}
              className="px-4 py-2 rounded-full bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-xs font-semibold text-white flex items-center gap-2 backdrop-blur-2xl transition shadow-lg disabled:opacity-50 cursor-pointer"
            >
              <Info className="w-4 h-4 text-indigo-400" />
              {diagnosticLoading ? 'Analyse...' : 'Diagnostic du flux'}
            </button>
          </div>

          {/* Top Right Badges */}
          <div className="flex items-center gap-2.5">
            <div className="bg-indigo-500/20 backdrop-blur-md px-3 py-1.5 rounded-xl border border-indigo-500/30 text-xs font-semibold text-indigo-200 flex items-center gap-1.5 shadow-sm">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span>{activeEngineName}</span>
            </div>
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

        {/* Floating Toast Notification */}
        {toastMessage && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-[#1c1c1e]/90 backdrop-blur-xl border border-white/20 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150 flex items-center gap-2 pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Quick Menu Popover (above bottom bar, positioned on right above ...) */}
        <PlayerQuickMenu
          isOpen={showQuickMenu}
          onClose={() => setShowQuickMenu(false)}
          onOpenMediaDetails={() => setShowMediaDetails(true)}
          onToggleSubtitles={toggleSubtitles}
          subtitlesActive={subtitlesActive}
          onCycleAspectRatio={cycleAspectRatio}
          aspectRatio={aspectRatio}
          onToggleCrop={toggleCrop}
          cropActive={cropActive}
          onCycleAudio={cycleAudioTrack}
          onCycleFilter={cycleFilter}
          activeFilterName={filters[activeFilterIndex].label}
          onOpenMultiView={() => setActiveView('multiview')}
          onToggleFullscreen={toggleFullscreen}
          onTogglePiP={togglePiP}
          onOpenEPG={() => {
            if (onOpenEPGModal) onOpenEPGModal();
            else setActiveView('epg');
          }}
          onOpenParentalControl={() => {
            requestPinForAction(() => {
              showToast('Contrôle Parental');
            }, 'Contrôle Parental');
          }}
          onCycleSleepTimer={cycleSleepTimer}
          sleepTimerLabel={sleepTimerLabel}
          onOpenVOD={() => setActiveView('vod')}
        />

        {/* BOTTOM OSD BAR (Matching screenshot layout IMG_2672.jpeg) */}
        <div className="pointer-events-auto bg-slate-950/80 backdrop-blur-2xl border border-white/10 p-3 sm:p-4 rounded-[28px] shadow-2xl space-y-3">
          <div className="flex items-center justify-between gap-3">
            {/* Left: Play/Pause circle button, Channel Logo, Channel Name and Subtitle */}
            <div className="flex items-center gap-3 min-w-0">
              {/* Circular Play / Pause button */}
              <button
                id="play-pause-btn"
                onClick={togglePlay}
                className="w-10 h-10 rounded-full border border-white/30 hover:border-white bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all active:scale-95 shrink-0 cursor-pointer"
                title={isPlaying ? 'Pause (K / Espace)' : 'Lecture (K / Espace)'}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
              </button>

              {/* Channel Logo */}
              {channel?.logo ? (
                <img 
                  src={channel.logo} 
                  alt={channel.name} 
                  className="w-9 h-9 object-contain rounded-xl bg-black/40 p-1 border border-white/10 shrink-0" 
                  onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-white font-bold text-xs shrink-0">
                  <Tv className="w-4 h-4 text-indigo-300" />
                </div>
              )}

              {/* Title & Program / Category */}
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight truncate flex items-center gap-2">
                  <span>{channel?.number ? `${channel.number}. ` : ''}{channel?.name || 'Chaîne Live'}</span>
                  {isFavorite && <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400 shrink-0" />}
                </h2>
                <p className="text-slate-400 text-xs truncate">
                  {currentProgram ? currentProgram.title : (channel?.category || 'Direct TV')}
                </p>
              </div>
            </div>

            {/* Right: Quick actions (...), Remote/List (:::), Favorite (★), plus zap and fullscreen */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Zap Prev */}
              <button
                id="zap-prev-btn"
                onClick={zapPrev}
                className="w-8 h-8 sm:w-9 sm:h-9 bg-white/5 hover:bg-white/15 rounded-full flex items-center justify-center border border-white/10 text-white transition-colors cursor-pointer"
                title="Chaîne précédente (Flèche Bas)"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Zap Next */}
              <button
                id="zap-next-btn"
                onClick={zapNext}
                className="w-8 h-8 sm:w-9 sm:h-9 bg-white/5 hover:bg-white/15 rounded-full flex items-center justify-center border border-white/10 text-white transition-colors cursor-pointer"
                title="Chaîne suivante (Flèche Haut)"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* More Actions Menu Button (...) */}
              <button
                id="quick-actions-menu-btn"
                onClick={() => setShowQuickMenu((prev) => !prev)}
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border transition-all active:scale-95 cursor-pointer ${
                  showQuickMenu
                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                    : 'bg-white/5 hover:bg-white/15 border-white/10 text-white'
                }`}
                title="Options et Renseignements (...)"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>

              {/* Matrix / Virtual Remote / Channel List (:::) */}
              <button
                id="virtual-remote-btn"
                onClick={() => {
                  if (showChannelListToggle) {
                    showChannelListToggle();
                  } else {
                    setIsVirtualRemoteOpen(true);
                  }
                }}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer"
                title="Liste des chaînes / Télécommande (:::)"
              >
                <Grid3X3 className="w-4 h-4" />
              </button>

              {/* Favorite (★) */}
              <button
                id="toggle-fav-btn"
                onClick={() => channel && toggleFavorite(channel.id)}
                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border transition-all active:scale-95 cursor-pointer ${
                  isFavorite
                    ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400'
                    : 'bg-white/5 hover:bg-white/15 border-white/10 text-slate-300 hover:text-yellow-400'
                }`}
                title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              >
                <Star className={`w-4 h-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
              </button>

              {/* Fullscreen */}
              <button
                id="player-fullscreen-btn"
                onClick={toggleFullscreen}
                className="w-9 h-9 sm:w-10 sm:h-10 bg-white/5 hover:bg-white/15 rounded-full flex items-center justify-center border border-white/10 text-white transition-colors cursor-pointer"
                title="Plein écran (F)"
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* EPG Progress Bar if available */}
          {currentProgram ? (
            <div className="space-y-1 pt-1.5 border-t border-white/10">
              <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full rounded-full transition-all duration-1000"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>{EPGService.formatTime(currentProgram.start)} - {currentProgram.title}</span>
                <span>{EPGService.formatTime(currentProgram.end)}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Media Details Modal (Matching screenshot IMG_2671.jpeg) */}
      {showMediaDetails && (
        <MediaDetailsModal
          details={mediaDetails}
          onClose={() => setShowMediaDetails(false)}
        />
      )}

      {/* Diagnostic Modal overlay */}
      {showDiagnostics && (
        <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-md z-[100] flex items-center justify-center p-4 overflow-y-auto pointer-events-auto">
          <div className="bg-slate-900 border border-white/10 rounded-[24px] max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center gap-2.5">
                <Info className="w-5 h-5 text-indigo-400 animate-pulse" />
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>🔧 Diagnostic Technique du Flux</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-600 text-white font-bold tracking-wider uppercase">v1</span>
                </h3>
              </div>
              <button 
                onClick={() => setShowDiagnostics(false)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-5 text-sm">
              {diagnosticLoading ? (
                <div className="flex flex-col items-center justify-center py-16 space-y-4">
                  <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-slate-300 text-xs font-semibold">Sondage et analyse du flux IPTV en cours...</p>
                </div>
              ) : diagnosticData ? (
                <div className="space-y-4">
                  {diagnosticData.browserBlockNotice && (
                    <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs rounded-xl flex items-start gap-2.5">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Avertissement de contenu mixte : </span>
                        {diagnosticData.browserBlockNotice}
                      </div>
                    </div>
                  )}

                  {/* 1. CHAÎNE */}
                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                    <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">📺 CHAÎNE</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-200">
                      <p><span className="text-slate-400 font-medium">Nom :</span> {diagnosticData.channelName}</p>
                      <p><span className="text-slate-400 font-medium">ID :</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]">{diagnosticData.channelId}</code></p>
                      <p><span className="text-slate-400 font-medium">Type :</span> {diagnosticData.channelType}</p>
                      <p className="sm:col-span-2 truncate"><span className="text-slate-400 font-medium">cmd original :</span> <code className="bg-black/40 px-1 py-0.5 rounded font-mono text-[10px] text-slate-300">{diagnosticData.cmd}</code></p>
                    </div>
                  </div>

                  {/* 2. PORTAIL */}
                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                    <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">🌐 PORTAIL</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-200">
                      <p><span className="text-slate-400 font-medium">Type :</span> {diagnosticData.portalType}</p>
                      <p><span className="text-slate-400 font-medium">MAC présente :</span> <span className={diagnosticData.macPresent === 'Oui' ? 'text-green-400 font-bold' : 'text-slate-400'}>{diagnosticData.macPresent}</span></p>
                      <p><span className="text-slate-400 font-medium">Token présent :</span> <span className={diagnosticData.tokenPresent === 'Oui' ? 'text-green-400 font-bold' : 'text-slate-400'}>{diagnosticData.tokenPresent}</span></p>
                      <p><span className="text-slate-400 font-medium">Cookies présents :</span> {diagnosticData.cookiesPresent}</p>
                      <p className="sm:col-span-2 truncate"><span className="text-slate-400 font-medium">URL du portail :</span> <span className="font-mono text-[11px] text-indigo-300">{maskSensitive(diagnosticData.portalUrl)}</span></p>
                    </div>
                  </div>

                  {/* 3. RÉSOLUTION DU FLUX */}
                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                    <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">⚙️ RÉSOLUTION DU FLUX</p>
                    <div className="space-y-2 text-xs text-slate-200">
                      <p className="truncate"><span className="text-slate-400 font-medium">cmd original :</span> <code className="bg-black/40 px-1.5 py-0.5 rounded font-mono text-[10px]">{diagnosticData.originalCmd}</code></p>
                      <p className="truncate"><span className="text-slate-400 font-medium">URL obtenue après create_link :</span> <span className="font-mono text-[10px] text-slate-300 break-all">{maskSensitive(diagnosticData.createLinkUrl)}</span></p>
                      <p className="truncate"><span className="text-slate-400 font-medium">URL finale utilisée par le player :</span> <span className="font-mono text-[10px] text-indigo-300 break-all">{maskSensitive(diagnosticData.finalPlayerUrl)}</span></p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-white/5">
                        <p><span className="text-slate-400 font-medium">utilisation du proxy :</span> <span className={diagnosticData.useProxy === 'Oui' ? 'text-green-400 font-bold' : 'text-slate-400'}>{diagnosticData.useProxy}</span></p>
                        <p className="truncate"><span className="text-slate-400 font-medium">URL proxy utilisée :</span> <span className="font-mono text-[10px] text-slate-400">{maskSensitive(diagnosticData.proxyUrlUsed)}</span></p>
                      </div>
                    </div>
                  </div>

                  {/* 4. TEST SERVEUR */}
                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                    <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">⚡ TEST SERVEUR (PRE-FLIGHT PROBE)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-200">
                      <p>
                        <span className="text-slate-400 font-medium">statut HTTP :</span>{' '}
                        <span className={`font-mono font-bold ${diagnosticData.httpStatus === 200 ? 'text-green-400' : 'text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded'}`}>
                          {diagnosticData.httpStatus} {diagnosticData.statusText}
                        </span>
                      </p>
                      <p><span className="text-slate-400 font-medium">Content-Type :</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]">{diagnosticData.contentType}</code></p>
                      <p><span className="text-slate-400 font-medium">redirection éventuelle :</span> {diagnosticData.redirect ? 'Oui' : 'Non'}</p>
                      <p><span className="text-slate-400 font-medium">erreur éventuelle :</span> <span className={diagnosticData.errorText !== 'Aucune' ? 'text-red-300' : 'text-slate-400'}>{diagnosticData.errorText}</span></p>
                      
                      <div className="sm:col-span-2 border-t border-white/5 pt-2 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <p><span className="text-slate-400 font-medium">ORIGINE DU 503 :</span> <span className="text-amber-300 font-semibold">{diagnosticData.source503}</span></p>
                        <p><span className="text-slate-400 font-medium">ERREUR RÉSEAU :</span> <code className="text-red-300 font-mono bg-red-950/30 px-1 py-0.5 rounded text-[10px]">{diagnosticData.networkError}</code></p>
                        <p><span className="text-slate-400 font-medium">DNS Résolu :</span> <span className={diagnosticData.dnsResolved === 'Oui' ? 'text-green-400 font-bold' : 'text-slate-400'}>{diagnosticData.dnsResolved}</span></p>
                        <p><span className="text-slate-400 font-medium">Connexion TCP :</span> <span className={diagnosticData.tcpConnected === 'Oui' ? 'text-green-400 font-bold' : 'text-slate-400'}>{diagnosticData.tcpConnected}</span></p>
                      </div>

                      {diagnosticData.redirect && (
                        <p className="sm:col-span-2 truncate"><span className="text-slate-400 font-medium">URL redirigée :</span> <span className="font-mono text-[10px] text-slate-400">{maskSensitive(diagnosticData.redirectUrl)}</span></p>
                      )}
                    </div>
                  </div>

                  {/* 5. PLAYER */}
                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                    <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">🎬 PLAYER VIDÉO</p>
                    <div className="space-y-2 text-xs text-slate-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <p><span className="text-slate-400 font-medium">moteur actif :</span> <span className="text-indigo-300 font-semibold">{diagnosticData.playerType}</span></p>
                        <p><span className="text-slate-400 font-medium">mpegts.js actif :</span> <span className={diagnosticData.mpegtsActive === 'Oui' ? 'text-indigo-400 font-bold' : 'text-slate-400'}>{diagnosticData.mpegtsActive}</span></p>
                        <p><span className="text-slate-400 font-medium">HLS.js actif :</span> <span className={diagnosticData.hlsActive === 'Oui' ? 'text-green-400 font-bold' : 'text-slate-400'}>{diagnosticData.hlsActive}</span></p>
                        <p>
                          <span className="text-slate-400 font-medium">état du player :</span>{' '}
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase ${
                            diagnosticData.playerState === 'playing' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                            diagnosticData.playerState === 'loading' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse' :
                            'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}>
                            {diagnosticData.playerState}
                          </span>
                        </p>
                        <p className="sm:col-span-2"><span className="text-slate-400 font-medium">dernière erreur :</span> <span className="font-mono text-red-300">{diagnosticData.lastError}</span></p>
                      </div>
                      <div className="pt-2 border-t border-white/5">
                        <span className="text-slate-400 font-medium block mb-1">message d'erreur complet :</span>
                        <pre className="font-mono text-[10px] text-red-300 bg-black/40 p-2.5 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-24">
                          {diagnosticData.completeErrorMessage}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-slate-400 text-center py-6">Aucune donnée de diagnostic disponible.</p>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-white/5 flex flex-col sm:flex-row justify-end gap-2.5 bg-slate-950/40">
              <button
                onClick={() => {
                  if (!diagnosticData) return;
                  const logString = `===== IPTV STREAM DIAGNOSTIC =====
[CHAÎNE]
- Nom: ${diagnosticData.channelName}
- ID: ${diagnosticData.channelId}
- Type: ${diagnosticData.channelType}
- cmd original: ${diagnosticData.cmd}

[PORTAIL]
- Type: ${diagnosticData.portalType}
- URL du portail: ${maskSensitive(diagnosticData.portalUrl)}
- MAC présente: ${diagnosticData.macPresent}
- Token présent: ${diagnosticData.tokenPresent}
- Cookies présents: ${diagnosticData.cookiesPresent}

[RÉSOLUTION DU FLUX]
- cmd original: ${diagnosticData.originalCmd}
- URL obtenue après create_link si applicable: ${maskSensitive(diagnosticData.createLinkUrl)}
- URL finale utilisée par le player: ${maskSensitive(diagnosticData.finalPlayerUrl)}
- utilisation du proxy: ${diagnosticData.useProxy}
- URL proxy utilisée: ${maskSensitive(diagnosticData.proxyUrlUsed)}

[TEST SERVEUR]
- statut HTTP: ${diagnosticData.httpStatus}
- Content-Type: ${diagnosticData.contentType}
- redirection éventuelle: ${diagnosticData.redirect ? 'Oui (' + maskSensitive(diagnosticData.redirectUrl) + ')' : 'Non'}
- erreur éventuelle: ${diagnosticData.errorText}
- origine du 503: ${diagnosticData.source503}
- erreur réseau: ${diagnosticData.networkError}
- DNS Résolu: ${diagnosticData.dnsResolved}
- Connexion TCP: ${diagnosticData.tcpConnected}

[PLAYER]
- type de player utilisé: ${diagnosticData.playerType}
- HLS.js actif: ${diagnosticData.hlsActive}
- état du player: ${diagnosticData.playerState}
- dernière erreur: ${diagnosticData.lastError}
- message d'erreur complet: ${diagnosticData.completeErrorMessage}
===================================`;
                  navigator.clipboard.writeText(logString);
                  alert('📋 Diagnostic copié dans le presse-papiers avec succès (données sensibles masquées) !');
                }}
                disabled={!diagnosticData}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                Copier le diagnostic
              </button>
              <button
                onClick={() => setShowDiagnostics(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
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
