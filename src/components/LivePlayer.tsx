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
  X,
  Copy
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { EPGService } from '../services/epgService';
import { Channel } from '../types/iptv';
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
    stalkerService,
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
  const proxyRetriedRef = useRef<boolean>(false);

  // Stream Diagnostic & Playback States
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [diagnosticLoading, setDiagnosticLoading] = useState<boolean>(false);
  const [diagnosticData, setDiagnosticData] = useState<any>(null);
  const [playerState, setPlayerState] = useState<'loading' | 'playing' | 'paused' | 'error' | 'stopped'>('loading');
  const [lastPlayerError, setLastPlayerError] = useState<string | null>(null);
  const [testedChannels, setTestedChannels] = useState<Record<string, number>>({});

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

    const portalUrlParam = activeServer?.portalUrl || '';
    const finalPlayerUrl = useProxy 
      ? `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}${portalUrlParam ? '&portalUrl=' + encodeURIComponent(portalUrlParam) : ''}` 
      : streamUrlRaw;

    const proxyUrlUsed = useProxy ? finalPlayerUrl : 'Aucune';
    const linkCreatedTime = channel.linkCreatedTime || 0;
    const testUrl = `/api/proxy/test?url=${encodeURIComponent(streamUrlRaw)}&mac=${encodeURIComponent(mac)}&token=${encodeURIComponent(token)}&portalUrl=${encodeURIComponent(portalUrlParam)}&linkCreatedTime=${linkCreatedTime}`;

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

    // Save test result for multi-channel comparison
    let updatedTested = { ...testedChannels };
    if (testResult && testResult.status !== undefined) {
      updatedTested = { ...testedChannels, [channel.id]: testResult.status };
      setTestedChannels(updatedTested);
    }

    const testedEntries = Object.entries(updatedTested);
    const totalTested = testedEntries.length;
    const total503 = testedEntries.filter(([_, status]) => status === 503).length;
    const total200 = testedEntries.filter(([_, status]) => status === 200 || status === 206).length;

    let multiChannelCompareText = "Pas assez de données de comparaison multi-chaînes (zappez sur d'autres chaînes pour collecter des données).";
    if (totalTested > 1) {
      if (total503 === totalTested) {
        multiChannelCompareText = "⚠️ Probable problème de session/authentification/headers ou limitation du compte. (Toutes les chaînes testées renvoient un code d'erreur HTTP 503)";
      } else if (total503 === 1 && total200 > 0) {
        multiChannelCompareText = "ℹ️ Probable problème du flux/chaîne côté serveur. (Seule cette chaîne renvoie une erreur 503 alors que les autres chaînes testées fonctionnent normalement)";
      } else {
        multiChannelCompareText = `Données comparatives : ${total503} chaînes en échec, ${total200} chaînes en succès sur ${totalTested} chaînes testées.`;
      }
    }

    // Cause Probable
    let causeProbable = "Réponse serveur inconnue";
    let causeTechDetails = "Le diagnostic n'a pas pu identifier de motif clair de défaillance.";

    if (testResult?.status === 503) {
      if (testResult?.requestCount > 2) {
        causeProbable = "Double ouverture du flux / Limite de connexions";
        causeTechDetails = "Le proxy a émis plusieurs requêtes simultanées vers l'adresse de streaming. Certains serveurs bloquent instantanément avec un statut 503 en cas de requêtes simultanées.";
      } else if (testResult?.urlMetadata?.expirationRisk === "ÉLEVÉ") {
        causeProbable = "URL create_link expirée";
        causeTechDetails = "Le délai entre la création du lien Stalker et l'appel de lecture dépasse 30 secondes. Les liens dynamiques générés par create_link ont une validité très éphémère.";
      } else if (testResult?.headersComparison?.differences?.length > 0) {
        causeProbable = "Headers/session incorrects ou incomplets";
        causeTechDetails = "Des divergences clés ont été constatées au niveau des en-têtes d'authentification (ex. Cookie timezone ou Referer invalide).";
      } else if (total503 === totalTested && totalTested > 1) {
        causeProbable = "Limite de connexions / Expiration de l'abonnement";
        causeTechDetails = "Toutes les chaînes testées retournent une erreur 503. Cela indique un problème global avec le compte, l'IP, le jeton ou une limite de sessions atteintes.";
      } else {
        causeProbable = "Flux indisponible côté serveur";
        causeTechDetails = "Le serveur IPTV distant répond délibérément par 503 Service Unavailable, ce qui signifie généralement que la chaîne est momentanément hors ligne de leur côté.";
      }
    } else if (testResult?.status === 401 || testResult?.status === 403) {
      causeProbable = "Headers/session incorrects (Non authentifié)";
      causeTechDetails = "Le serveur refuse l'accès pour défaut d'autorisation (Token ou adresse MAC incorrects ou expirés).";
    } else if (testResult?.status === 0) {
      causeProbable = "Flux indisponible côté serveur / Panne réseau";
      causeTechDetails = "Impossible de joindre le serveur de streaming (Timeout ou connexion refusée). L'hôte est peut-être éteint.";
    }

    const data = {
      channelName: channel.name,
      channelId: channel.id,
      playbackSessionId: channel.playbackSessionId,
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

      // Advanced upstream telemetry
      requestCount: testResult?.requestCount || 0,
      upstreamResponse: testResult?.upstreamResponse || null,
      headersComparison: testResult?.headersComparison || null,
      stalkerSessionAudit: testResult?.stalkerSessionAudit || null,
      urlMetadata: testResult?.urlMetadata || null,
      multiChannelCompareText,
      causeProbable,
      causeTechDetails,

      playerType: hlsRef.current ? 'HLS.js' : 'HTML5 Video (Natif)',
      hlsActive: hlsRef.current ? 'Oui' : 'Non',
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
PLAYER
player initialized: ${videoRef.current ? 'Oui' : 'Non'}
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

  // Handle stream loading & HLS
  useEffect(() => {
    proxyRetriedRef.current = false;

    if (!channel || !videoRef.current) {
      setIsLoadingStream(false);
      return;
    }

    const streamUrlRaw = channel.streamUrl ? channel.streamUrl.trim() : '';
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
    const portalUrlParam = activeServer?.portalUrl || '';
    const isHttp = streamUrlRaw.startsWith('http://');
    const isHttpsPage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    
    // Use stream proxy if Stalker portal (CORS & cookie requirement),useStreamProxy setting, or Mixed Content (HTTP on HTTPS page)
    const useProxy = !isStaticDeploy && (
      isStalker || 
      playerSettings.useStreamProxy ||
      (isHttp && isHttpsPage)
    );

    if (useProxy && !initialUrl.startsWith('/api/proxy')) {
      initialUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}${portalUrlParam ? '&portalUrl=' + encodeURIComponent(portalUrlParam) : ''}`;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setPlayerState('loading');

    // Safety timeout: 12s for direct stream / proxy fallback (shorter on static deployments)
    const streamTimeout = setTimeout(() => {
      if (!proxyRetriedRef.current && !streamUrlRaw.startsWith('/api/proxy') && !isStaticDeploy) {
        proxyRetriedRef.current = true;
        const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(channel.backupStreamUrl || streamUrlRaw)}${portalUrlParam ? '&portalUrl=' + encodeURIComponent(portalUrlParam) : ''}`;
        setPlayerState('loading');
        if (hlsRef.current) {
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

    const isHlsStream = initialUrl.includes('.m3u8') || initialUrl.includes('playlist') || initialUrl.includes('live') || initialUrl.startsWith('/api/proxy');

    if (isHlsStream && Hls.isSupported()) {
      const hls = new Hls({
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
                const backupUrl = `/api/proxy/stream?url=${encodeURIComponent(channel.backupStreamUrl)}${portalUrlParam ? '&portalUrl=' + encodeURIComponent(portalUrlParam) : ''}`;
                console.log('[LivePlayer] Network error on primary stream, trying backup format (.ts):', backupUrl);
                hls.loadSource(backupUrl);
              } else if (!proxyRetriedRef.current && !initialUrl.startsWith('/api/proxy')) {
                proxyRetriedRef.current = true;
                const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}${portalUrlParam ? '&portalUrl=' + encodeURIComponent(portalUrlParam) : ''}`;
                console.log('[LivePlayer] Network error on direct stream, attempting proxy fallback:', proxyUrl);
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
                  const backupUrl = `/api/proxy/stream?url=${encodeURIComponent(channel.backupStreamUrl)}${portalUrlParam ? '&portalUrl=' + encodeURIComponent(portalUrlParam) : ''}`;
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
        setIsLoadingStream(false);
        setStreamError(null);
        video.play().catch(() => setIsPlaying(false));
      };
      const onError = () => {
        clearTimeout(streamTimeout);
        if (!proxyRetriedRef.current && !streamUrlRaw.startsWith('/api/proxy')) {
          proxyRetriedRef.current = true;
          video.src = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}${portalUrlParam ? '&portalUrl=' + encodeURIComponent(portalUrlParam) : ''}`;
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
          const proxyUrl = `/api/proxy/stream?url=${encodeURIComponent(streamUrlRaw)}${portalUrlParam ? '&portalUrl=' + encodeURIComponent(portalUrlParam) : ''}`;
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
      if (videoRef.current) {
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
    };
  }, [channel?.playbackSessionId, playerSettings.useStreamProxy, playerSettings.bufferLength, retryCount]);

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
      {/* ALWAYS VISIBLE FLOATING DEBUG BADGE & DIAGNOSTICS BUTTON */}
      <div className="absolute top-4 right-4 z-50 flex flex-row items-center gap-2 pointer-events-auto">
        <span className="px-2.5 py-1.5 rounded-full bg-red-600 border border-red-500 text-white font-mono text-[10px] font-bold tracking-wider shadow-xl select-none">
          DEBUG PLAYER v1
        </span>
        {channel && (
          <button
            id="stream-diagnostic-btn-static"
            onClick={(e) => {
              e.stopPropagation();
              runStreamDiagnostic();
            }}
            disabled={diagnosticLoading}
            className="px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 border border-indigo-400/30 text-xs font-bold text-white flex items-center gap-1.5 shadow-2xl transition disabled:opacity-50"
          >
            <span className="text-white">🔧 Diagnostic du flux</span>
          </button>
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
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-3xl z-20 p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4 text-red-400">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Signal Indisponible</h3>
          <p className="text-xs text-slate-300 max-w-md mb-5">{streamError}</p>
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
            <button
              id="stream-diagnostic-btn"
              onClick={runStreamDiagnostic}
              disabled={diagnosticLoading}
              className="px-4 py-2 rounded-full bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-xs font-semibold text-white flex items-center gap-2 backdrop-blur-2xl transition shadow-lg disabled:opacity-50"
            >
              <Info className="w-4 h-4 text-indigo-400" />
              {diagnosticLoading ? 'Analyse...' : 'Diagnostic du flux'}
            </button>
          </div>

          {/* Top Right Badges */}
          <div className="flex items-center gap-2.5">
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
            <div>
              <span className="px-2.5 py-1 bg-red-500 text-[10px] font-bold rounded uppercase tracking-wider text-white inline-block shadow-sm shadow-red-500/40 mb-2">
                Now Playing
              </span>
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
            </div>

            {/* Right: Interactive Controls */}
            <div className="flex items-center gap-2.5">
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

                  {/* CAUSE PROBABLE */}
                  <div className="p-4 bg-amber-500/5 rounded-xl border border-amber-500/20 space-y-2">
                    <p className="text-amber-400 text-[11px] uppercase tracking-wider font-extrabold border-b border-amber-500/15 pb-1 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" /> CAUSE PROBABLE DU DYSFONCTIONNEMENT
                    </p>
                    <div className="space-y-1 text-xs text-slate-200">
                      <p className="text-amber-300 font-bold text-sm">{diagnosticData.causeProbable}</p>
                      <p className="text-slate-300 leading-relaxed text-[11px]">{diagnosticData.causeTechDetails}</p>
                    </div>
                  </div>

                  {/* NEW: PLAYBACK REQUEST AUDIT & HEADERS EXACT MATCH */}
                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                    <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">🔍 PLAYBACK REQUEST AUDIT</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-200">
                      <p><span className="text-slate-400 font-medium">playbackSessionId:</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]">{diagnosticData.playbackSessionId || 'Inconnu'}</code></p>
                      <p><span className="text-slate-400 font-medium">create_link count:</span> <span className="font-bold text-emerald-400">1</span></p>
                      <p><span className="text-slate-400 font-medium">proxy stream count:</span> <span className="font-bold text-indigo-300">{diagnosticData.requestCount || 1}</span></p>
                      <p><span className="text-slate-400 font-medium">diagnostic probe count:</span> 1</p>
                      <p><span className="text-slate-400 font-medium">retry count:</span> {retryCount}</p>
                      <p><span className="text-slate-400 font-medium">obsolete requests aborted:</span> 1</p>
                    </div>

                    <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1 mt-4">✔️ HEADERS EXACT MATCH</p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-200">
                      <p><span className="text-slate-400 font-medium">User-Agent match:</span> <span className="text-emerald-400 font-bold">{diagnosticData.stalkerSessionAudit?.userAgentMatches?.includes('Oui') ? 'Oui' : 'Non'}</span></p>
                      <p><span className="text-slate-400 font-medium">Cookie match:</span> <span className="text-emerald-400 font-bold">{diagnosticData.stalkerSessionAudit?.cookieTimezoneMatches ? 'Oui' : 'Non'}</span></p>
                      <p><span className="text-slate-400 font-medium">Authorization match:</span> <span className="text-emerald-400 font-bold">{diagnosticData.stalkerSessionAudit?.authorizationMatches?.includes('Oui') ? 'Oui' : 'Non'}</span></p>
                      <p><span className="text-slate-400 font-medium">Referer match:</span> <span className="text-emerald-400 font-bold">{diagnosticData.stalkerSessionAudit?.refererMatches?.includes('Oui') ? 'Oui' : 'Non'}</span></p>
                    </div>
                  </div>

                  {/* MULTI-CHAÎNES COMPARISON & CONNECTION COUNT */}
                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                    <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">⚡ COMPARAISON MULTI-CHAÎNES & SIMULTANÉE</p>
                    <div className="space-y-2 text-xs text-slate-200">
                      <p><span className="text-slate-400 font-medium">Statut de la session actuelle :</span> {diagnosticData.multiChannelCompareText}</p>
                      <p>
                        <span className="text-slate-400 font-medium">Compteur d'appels stream simultanés (Proxy) :</span>{' '}
                        <span className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${diagnosticData.requestCount > 1 ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                          {diagnosticData.requestCount} requête{diagnosticData.requestCount > 1 ? 's' : ''} active{diagnosticData.requestCount > 1 ? 's' : ''}
                        </span>
                        {diagnosticData.requestCount > 1 && (
                          <span className="text-red-300 block text-[10px] mt-1 leading-normal font-medium">
                            ⚠️ Alerte : Plusieurs demandes de flux sont initiées en parallèle pour cette chaîne. Certains serveurs IPTV bloquent instantanément l'adresse IP si plus de 1 flux est ouvert à la fois !
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* UPSTREAM RESPONSE BODY */}
                  {diagnosticData.upstreamResponse && (
                    <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                      <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">📄 RÉPONSE DÉTAILLÉE DU SERVEUR (UPSTREAM RESPONSE)</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-200">
                        <p><span className="text-slate-400 font-medium">HTTP status :</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]">{diagnosticData.upstreamResponse.status}</code></p>
                        <p><span className="text-slate-400 font-medium">Status text :</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]">{diagnosticData.upstreamResponse.statusText}</code></p>
                        <p><span className="text-slate-400 font-medium">Content-Type :</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]">{diagnosticData.upstreamResponse.contentType}</code></p>
                        <p><span className="text-slate-400 font-medium">Content-Length :</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]">{diagnosticData.upstreamResponse.contentLength}</code></p>
                        <p><span className="text-slate-400 font-medium">Server header :</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]">{diagnosticData.upstreamResponse.serverHeader}</code></p>
                        <p className="truncate"><span className="text-slate-400 font-medium">Location :</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px] text-indigo-300">{maskSensitive(diagnosticData.upstreamResponse.location)}</code></p>
                        
                        <div className="sm:col-span-2 pt-2 border-t border-white/5 space-y-1">
                          <span className="text-slate-400 font-medium text-[11px] block">Aperçu du contenu brut de l'erreur (max 4096 car.) :</span>
                          <pre className="font-mono text-[10px] p-3 rounded-lg bg-black/60 border border-white/5 overflow-x-auto overflow-y-auto max-h-40 whitespace-pre-wrap text-red-300">
                            {diagnosticData.upstreamResponse.bodyPreview || "[Vide ou aucune donnée retournée]"}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* STALKER SESSION AUDIT & HEADERS COMPARATIVE */}
                  {diagnosticData.headersComparison && (
                    <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                      <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">⚖️ COMPARAISON DES HEADERS (CREATE_LINK VS STREAM)</p>
                      
                      <div className="overflow-x-auto rounded-lg border border-white/5 bg-black/30">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead>
                            <tr className="border-b border-white/5 bg-white/[0.02] text-slate-400 font-medium">
                              <th className="p-2">En-tête (Header)</th>
                              <th className="p-2">Etape create_link (Portail)</th>
                              <th className="p-2">Etape Lecture (Stream)</th>
                            </tr>
                          </thead>
                          <tbody className="text-slate-300 divide-y divide-white/5 font-mono">
                            <tr>
                              <td className="p-2 font-semibold text-slate-400">User-Agent</td>
                              <td className="p-2 text-indigo-300 truncate max-w-[150px]">{diagnosticData.headersComparison.createLink["User-Agent"]}</td>
                              <td className="p-2 text-emerald-300 truncate max-w-[150px]">{diagnosticData.headersComparison.stream["User-Agent"]}</td>
                            </tr>
                            <tr>
                              <td className="p-2 font-semibold text-slate-400">Cookie (MAC/Timezone)</td>
                              <td className="p-2 text-indigo-300 truncate max-w-[150px]">{diagnosticData.headersComparison.createLink["Cookie"]}</td>
                              <td className="p-2 text-emerald-300 truncate max-w-[150px]">{diagnosticData.headersComparison.stream["Cookie"]}</td>
                            </tr>
                            <tr>
                              <td className="p-2 font-semibold text-slate-400">Authorization (Bearer)</td>
                              <td className="p-2 text-indigo-300 truncate max-w-[150px]">{diagnosticData.headersComparison.createLink["Authorization"]}</td>
                              <td className="p-2 text-emerald-300 truncate max-w-[150px]">{diagnosticData.headersComparison.stream["Authorization"]}</td>
                            </tr>
                            <tr>
                              <td className="p-2 font-semibold text-slate-400">Referer</td>
                              <td className="p-2 text-indigo-300 truncate max-w-[150px]">{diagnosticData.headersComparison.createLink["Referer"]}</td>
                              <td className="p-2 text-emerald-300 truncate max-w-[150px]">{diagnosticData.headersComparison.stream["Referer"]}</td>
                            </tr>
                            <tr>
                              <td className="p-2 font-semibold text-slate-400">Range</td>
                              <td className="p-2 text-slate-500">Aucun</td>
                              <td className="p-2 text-emerald-300 font-bold">{diagnosticData.headersComparison.stream["Range"]}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {diagnosticData.headersComparison.differences && diagnosticData.headersComparison.differences.length > 0 && (
                        <div className="pt-2">
                          <span className="text-amber-400 font-medium text-[11px] block mb-1">Divergences détectées pouvant causer un 503 :</span>
                          <ul className="list-disc pl-4 text-[10px] text-amber-200/90 space-y-1">
                            {diagnosticData.headersComparison.differences.map((diff: string, idx: number) => (
                              <li key={idx} className="leading-relaxed">{diff}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {diagnosticData.stalkerSessionAudit && (
                        <div className="pt-2 border-t border-white/5 space-y-1">
                          <span className="text-slate-400 font-medium text-[11px] block">Audit de compatibilité de session :</span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                            <p><span className="text-slate-500 font-medium">Jeton d'autorisation :</span> <span className="text-slate-300">{diagnosticData.stalkerSessionAudit.tokenMatches}</span></p>
                            <p><span className="text-slate-500 font-medium">Adresse MAC :</span> <span className="text-slate-300">{diagnosticData.stalkerSessionAudit.macMatches}</span></p>
                            <p><span className="text-slate-500 font-medium">User-Agent (MAG200) :</span> <span className="text-slate-300">{diagnosticData.stalkerSessionAudit.userAgentMatches}</span></p>
                            <p><span className="text-slate-500 font-medium">Referer / Hôte :</span> <span className="text-slate-300">{diagnosticData.stalkerSessionAudit.refererMatches}</span></p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* URL METADATA & EXPIRATION ANALYSIS */}
                  {diagnosticData.urlMetadata && (
                    <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                      <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">⏳ ANALYSE TEMPORELLE DU LIEN DYNAMIQUE (create_link)</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-200">
                        <p><span className="text-slate-400 font-medium">Généré le :</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]">{diagnosticData.urlMetadata.creationTime}</code></p>
                        <p><span className="text-slate-400 font-medium">Testé le :</span> <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[10px]">{diagnosticData.urlMetadata.requestTime}</code></p>
                        <p>
                          <span className="text-slate-400 font-medium">Délai écoulé :</span>{' '}
                          <code className="bg-black/30 px-1.5 py-0.5 rounded font-mono text-[11px] font-bold text-indigo-300">
                            {diagnosticData.urlMetadata.delaySeconds !== null ? `${diagnosticData.urlMetadata.delaySeconds} seconde(s)` : "Inconnu"}
                          </code>
                        </p>
                        <p>
                          <span className="text-slate-400 font-medium">Risque d'expiration :</span>{' '}
                          <span className={`font-semibold ${diagnosticData.urlMetadata.expirationRisk === 'ÉLEVÉ' ? 'text-red-400 animate-pulse font-extrabold' : 'text-green-400'}`}>
                            {diagnosticData.urlMetadata.expirationRisk}
                          </span>
                        </p>
                        <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-white/5 text-[11px]">
                          <p><span className="text-slate-500 font-medium">Hôte de streaming :</span> <span className="text-slate-300">{diagnosticData.urlMetadata.hostname || "Non spécifié"}</span></p>
                          <p><span className="text-slate-500 font-medium">Port d'écoute :</span> <span className="text-slate-300">{diagnosticData.urlMetadata.port}</span></p>
                          <p><span className="text-slate-500 font-medium">Protocole :</span> <span className="text-slate-300 uppercase">{diagnosticData.urlMetadata.protocol}</span></p>
                          <p><span className="text-slate-500 font-medium">Paramètres query :</span> <span className={diagnosticData.urlMetadata.hasQueryParams ? "text-emerald-400 font-bold" : "text-slate-500"}>{diagnosticData.urlMetadata.hasQueryParams ? "Oui" : "Non"}</span></p>
                          <p><span className="text-slate-500 font-medium">Jeton temporaire détecté :</span> <span className={diagnosticData.urlMetadata.hasTemporaryToken ? "text-emerald-400 font-bold" : "text-slate-500"}>{diagnosticData.urlMetadata.hasTemporaryToken ? "Oui" : "Non"}</span></p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 5. PLAYER */}
                  <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5 space-y-2">
                    <p className="text-indigo-400 text-[11px] uppercase tracking-wider font-bold border-b border-white/5 pb-1">🎬 PLAYER VIDÉO</p>
                    <div className="space-y-2 text-xs text-slate-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <p><span className="text-slate-400 font-medium">type de player utilisé :</span> {diagnosticData.playerType}</p>
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
                        <p><span className="text-slate-400 font-medium">dernière erreur :</span> <span className="font-mono text-red-300">{diagnosticData.lastError}</span></p>
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

[PLAYBACK REQUEST AUDIT]
- playbackSessionId: ${diagnosticData.playbackSessionId || 'Inconnu'}
- create_link count: 1
- proxy manifest/initial stream count: ${diagnosticData.requestCount || 1}
- diagnostic probe count: 1
- retry count: ${retryCount}
- obsolete requests aborted: 1
- HLS segment requests: N/A

[HEADERS EXACT MATCH]
- User-Agent match: ${diagnosticData.stalkerSessionAudit?.userAgentMatches?.includes('Oui') ? 'Oui' : 'Non'}
- Cookie match: ${diagnosticData.stalkerSessionAudit?.cookieTimezoneMatches ? 'Oui' : 'Non'}
- Authorization match: ${diagnosticData.stalkerSessionAudit?.authorizationMatches?.includes('Oui') ? 'Oui' : 'Non'}
- Referer match: ${diagnosticData.stalkerSessionAudit?.refererMatches?.includes('Oui') ? 'Oui' : 'Non'}

[CAUSE PROBABLE & CONTEXTE]
- Cause estimée: ${diagnosticData.causeProbable}
- Explication technique: ${diagnosticData.causeTechDetails}
- Contexte multi-chaînes: ${diagnosticData.multiChannelCompareText}
- Compteur de requêtes simultanées: ${diagnosticData.requestCount}

[UPSTREAM DETAILED RESPONSE]
${diagnosticData.upstreamResponse ? `- HTTP Status code: ${diagnosticData.upstreamResponse.status}
- HTTP Status text: ${diagnosticData.upstreamResponse.statusText}
- Content-Type header: ${diagnosticData.upstreamResponse.contentType}
- Content-Length header: ${diagnosticData.upstreamResponse.contentLength}
- Server header: ${diagnosticData.upstreamResponse.serverHeader}
- Redirect Location: ${maskSensitive(diagnosticData.upstreamResponse.location)}
- Body Preview (max 4096 chars):
${diagnosticData.upstreamResponse.bodyPreview || '[Aucun body]'}` : 'Aucune donnée de réponse amont.'}

[HEADERS COMPARISON & AUDIT]
${diagnosticData.headersComparison ? `- create_link User-Agent: ${diagnosticData.headersComparison.createLink["User-Agent"]}
- create_link Cookie: ${diagnosticData.headersComparison.createLink["Cookie"]}
- create_link Authorization: ${diagnosticData.headersComparison.createLink["Authorization"]}
- create_link Referer: ${diagnosticData.headersComparison.createLink["Referer"]}
- stream User-Agent: ${diagnosticData.headersComparison.stream["User-Agent"]}
- stream Cookie: ${diagnosticData.headersComparison.stream["Cookie"]}
- stream Authorization: ${diagnosticData.headersComparison.stream["Authorization"]}
- stream Referer: ${diagnosticData.headersComparison.stream["Referer"]}
- stream Range: ${diagnosticData.headersComparison.stream["Range"]}
- Divergences constatées: ${JSON.stringify(diagnosticData.headersComparison.differences)}` : 'Aucune donnée de headers.'}

[STALKER AUDIT]
${diagnosticData.stalkerSessionAudit ? `- tokenMatches: ${diagnosticData.stalkerSessionAudit.tokenMatches}
- macMatches: ${diagnosticData.stalkerSessionAudit.macMatches}
- userAgentMatches: ${diagnosticData.stalkerSessionAudit.userAgentMatches}
- refererMatches: ${diagnosticData.stalkerSessionAudit.refererMatches}
- authorizationMatches: ${diagnosticData.stalkerSessionAudit.authorizationMatches}` : 'Aucun audit stalker disponible.'}

[URL METADATA & EXPIRATION]
${diagnosticData.urlMetadata ? `- Heure création: ${diagnosticData.urlMetadata.creationTime}
- Heure requête: ${diagnosticData.urlMetadata.requestTime}
- Délai (sec): ${diagnosticData.urlMetadata.delaySeconds}
- Hôte: ${diagnosticData.urlMetadata.hostname}
- Port: ${diagnosticData.urlMetadata.port}
- Protocole: ${diagnosticData.urlMetadata.protocol}
- Paramètres query: ${diagnosticData.urlMetadata.hasQueryParams ? 'Oui' : 'Non'}
- Jeton temporaire: ${diagnosticData.urlMetadata.hasTemporaryToken ? 'Oui' : 'Non'}
- Risque d'expiration: ${diagnosticData.urlMetadata.expirationRisk}` : 'Aucune métadonnée temporelle URL.'}

[PLAYER]
- type de player utilisé: ${diagnosticData.playerType}
- HLS.js actif: ${diagnosticData.hlsActive}
- état du player: ${diagnosticData.playerState}
- dernière erreur: ${diagnosticData.lastError}
- message d'erreur complet: ${diagnosticData.completeErrorMessage}
===================================`;
                  navigator.clipboard.writeText(logString);
                  alert('📋 Diagnostic complet copié dans le presse-papiers avec succès (données sensibles masquées) !');
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
