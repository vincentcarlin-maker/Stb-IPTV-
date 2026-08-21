import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
import { 
  Channel, 
  EPGProgram, 
  ServerProfile, 
  ParentalControlSettings, 
  PlayerSettings, 
  AppView, 
  VODItem, 
  TVSeries, 
  ProgramReminder,
  DeviceType,
  DeviceMode,
  ServerLoadingProgress
} from '../types/iptv';
import { DEMO_CHANNELS, DEMO_VOD_MOVIES, DEMO_SERIES, generateDynamicEPG } from '../data/demoChannels';
import { StalkerService } from '../services/stalkerService';
import { StalkerCapabilityService } from '../services/stalkerCapabilityService';
import { XtreamService } from '../services/xtreamService';
import { parseM3U, parseM3UFull } from '../services/m3uParser';
import { EPGService } from '../services/epgService';
import { vodCacheService } from '../services/vodCacheService';
import { useDeviceDetection, DeviceDetectionState } from '../hooks/useDeviceDetection';
import { safeToggleFullscreen } from '../utils/fullscreen';

interface IPTVContextType {
  // Device adaptation
  deviceType: DeviceType;
  detectedType: DeviceType;
  deviceMode: DeviceMode;
  setDeviceMode: (mode: DeviceMode) => void;
  isPhone: boolean;
  isTablet: boolean;
  isTV: boolean;
  isTouch: boolean;
  orientation: 'portrait' | 'landscape';
  screenWidth: number;
  screenHeight: number;

  // Virtual Remote Modal
  isVirtualRemoteOpen: boolean;
  setIsVirtualRemoteOpen: (open: boolean) => void;
  tuningNumber: string | null;

  // Profiles & Servers
  servers: ServerProfile[];
  activeServer: ServerProfile | null;
  addServer: (server: Omit<ServerProfile, 'id'>) => Promise<boolean>;
  updateServer: (id: string, updates: Partial<ServerProfile>) => void;
  deleteServer: (id: string) => void;
  setActiveServerId: (id: string) => void;
  refreshServerData: () => Promise<void>;
  isLoadingServer: boolean;
  serverError: string | null;
  serverProgress: ServerLoadingProgress;
  dismissServerProgress: () => void;

  // Navigation & View
  activeView: AppView;
  setActiveView: (view: AppView) => void;
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // Channels & Playback
  channels: Channel[];
  filteredChannels: Channel[];
  activeChannel: Channel | null;
  setActiveChannel: (ch: Channel | null) => void;
  zapNext: () => void;
  zapPrev: () => void;
  zapToNumber: (num: number) => void;
  
  // VOD & Series
  vodMovies: VODItem[];
  seriesList: TVSeries[];
  activeVOD: VODItem | null;
  setActiveVOD: (vod: VODItem | null) => void;
  
  // Favorites & History
  favorites: string[];
  toggleFavorite: (channelId: string) => void;
  history: { channel: Channel; timestamp: number }[];
  clearHistory: () => void;

  // EPG & Reminders
  epgData: Record<string, EPGProgram[]>;
  reminders: ProgramReminder[];
  addReminder: (reminder: Omit<ProgramReminder, 'id'>) => void;
  removeReminder: (id: string) => void;

  // Parental Control
  parentalSettings: ParentalControlSettings;
  updateParentalSettings: (updates: Partial<ParentalControlSettings>) => void;
  isChannelLocked: (channel: Channel) => boolean;
  isCategoryLocked: (category: string) => boolean;
  isSessionUnlocked: boolean;
  unlockSessionWithPin: (pin: string) => boolean;
  lockSession: () => void;
  requestPinForAction: (onSuccess: () => void, promptTitle?: string) => void;
  isPinModalOpen: boolean;
  closePinModal: () => void;
  pinModalTitle: string;
  handlePinSuccess: () => void;

  // Player Settings
  playerSettings: PlayerSettings;
  updatePlayerSettings: (updates: Partial<PlayerSettings>) => void;
}

const IPTVContext = createContext<IPTVContextType | null>(null);

const DEFAULT_SERVERS: ServerProfile[] = [
  {
    id: 'demo-public-streams',
    name: 'iSTB Démo Gratuite (France & Monde)',
    type: 'demo',
    macAddress: '00:1A:79:44:B2:A1',
    active: true,
    status: 'connected',
    channelCount: DEMO_CHANNELS.length,
    vodCount: DEMO_VOD_MOVIES.length,
    seriesCount: DEMO_SERIES.length,
    expiryDate: 'Illimité (Accès Libre)',
    maxConnections: 1,
    lastConnected: new Date().toLocaleDateString('fr-FR'),
  },
  {
    id: 'stalker-mag-sample',
    name: 'Serveur Stalker Portal (Exemple MAG)',
    type: 'stalker',
    portalUrl: 'http://mag.iptvserver.net:8080/c/',
    macAddress: '00:1A:79:8F:2D:E9',
    active: false,
    status: 'idle',
    channelCount: 1450,
    vodCount: 4200,
    seriesCount: 650,
    expiryDate: '31/12/2026',
    maxConnections: 1,
  },
  {
    id: 'xtream-sample',
    name: 'Serveur Xtream Codes (VIP Pro)',
    type: 'xtream',
    portalUrl: 'http://xtream.vipservice.tv:8000',
    username: 'demo_user_istb',
    password: 'password123',
    active: false,
    status: 'idle',
    channelCount: 3200,
    vodCount: 8900,
    seriesCount: 1200,
    expiryDate: '15/06/2027',
    maxConnections: 2,
  }
];

const DEFAULT_PARENTAL: ParentalControlSettings = {
  enabled: true,
  pinCode: '0000',
  lockedCategories: ['Adulte / +18', 'Charme', 'Horreur 18+'],
  lockedRatings: ['18+'],
  lockedChannelIds: ['adult-midnight-club', 'adult-lounge-xx'],
  requirePinForSettings: false,
  requirePinForAdult: true,
  isSessionUnlocked: false,
  securityQuestion: 'Quelle est votre ville de naissance ?',
  securityAnswer: 'Paris',
};

const isStaticHost = typeof window !== 'undefined' && (
  window.location.hostname.includes('github.io') || 
  window.location.hostname.includes('github.pages') ||
  window.location.hostname.includes('pages.dev') ||
  window.location.hostname.includes('netlify.app') ||
  window.location.hostname.includes('vercel.app')
);

const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  bufferLength: 'standard',
  preferredQuality: 'auto',
  hardwareAcceleration: true,
  defaultAspectRatio: '16:9',
  audioVolume: 80,
  muted: false,
  autoPlayNext: true,
  theme: 'dark-blue',
  useStreamProxy: !isStaticHost,
  quickZapping: true,
  osdTimeout: 4,
};

export function sanitizeChannel(ch: Partial<Channel> | null | undefined): Channel {
  if (!ch) {
    return {
      id: `ch-fallback-${Math.random().toString(36).slice(2, 7)}`,
      number: 1,
      name: 'Chaîne',
      streamUrl: '',
      category: 'Généraliste',
      resolution: 'HD',
      fps: 50,
    };
  }

  let url = typeof ch.streamUrl === 'string' ? ch.streamUrl.trim() : '';

  // France 24 legacy URLs
  if (url.includes('stream.france24.com') || url.includes('2037568/F24_FR_LO_HLS')) {
    url = 'https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8';
  }
  // Clubbing TV legacy Amagi URLs
  else if (url.includes('amg00071-clubbingtv') || url.includes('clubbingtv-samsungfr') || url.includes('clubbingtv/clubbingtv')) {
    url = 'https://a-cdn.klowdtv.com/live3/clubbingtv_720p/playlist.m3u8';
  }
  // ARTE legacy URLs
  else if (url.includes('artesimulcast.akamaized.net')) {
    url = 'https://dash4.antik.sk/live/test_arte_avc_25p/playlist.m3u8';
  }
  // Euronews legacy Wurl URLs
  else if (url.includes('euronews-french-1-fr.samsung.wurl.tv') || url.includes('euronews-euronews-french')) {
    url = 'https://cdn-euronews.akamaized.net/live/eds/africanews-fr/25050/index.m3u8';
  }
  // Extreme sports legacy URLs
  else if (url.includes('extremesports-samsunguk') || url.includes('amg01201')) {
    url = 'https://africa24.vedge.infomaniak.com/livecast/ik:africa24sport/manifest.m3u8';
  }
  else if (url.includes('demo_test_public_stream')) {
    url = 'https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8';
  }

  // Localhost / loopback Stalker and MAG URLs fallback
  else if (url.includes('localhost/ch/') || url.includes('127.0.0.1/ch/') || url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
    if (url.includes('24527') || url.includes('/1_') || url.includes('/1.')) {
      url = 'https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8';
    } else if (url.includes('/2_') || url.includes('/2.')) {
      url = 'https://dash4.antik.sk/live/test_arte_avc_25p/playlist.m3u8';
    } else if (url.includes('/3_') || url.includes('/3.')) {
      url = 'https://a-cdn.klowdtv.com/live3/clubbingtv_720p/playlist.m3u8';
    } else if (url.includes('/4_') || url.includes('/4.')) {
      url = 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8';
    } else if (url.includes('/5_') || url.includes('/5.')) {
      url = 'https://d3b73b34o7cvkq.cloudfront.net/v1/master/3722c60a815c199d9c0ef36c5b73da68a62b09d1/cc-gz2sgqzp076kf/adn.m3u8';
    } else {
      url = 'https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_2300.m3u8';
    }
  }

  const num = typeof ch.number === 'number' && !isNaN(ch.number) ? ch.number : 1;
  const name = (typeof ch.name === 'string' && ch.name.trim()) ? ch.name.trim() : `Canal ${num}`;
  const id = (typeof ch.id === 'string' && ch.id.trim()) ? ch.id.trim() : `ch-${num}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  let category = (typeof ch.category === 'string' && ch.category.trim()) ? ch.category.trim() : '';
  if (!category || category === 'Généraliste') {
    const pipeMatch = name.match(/^([^|:]+)\s*[|:]\s*(.+)$/);
    if (pipeMatch) {
      const candidate = pipeMatch[1].trim();
      if (candidate.length >= 2 && candidate.length <= 40) {
        category = candidate;
      }
    }
  }
  if (!category) category = 'Généraliste';

  return {
    id,
    number: num,
    name,
    streamUrl: url,
    backupStreamUrl: ch.backupStreamUrl,
    cmd: ch.cmd,
    logo: ch.logo || undefined,
    category,
    epgId: ch.epgId || undefined,
    resolution: ch.resolution || 'HD',
    hasCatchup: Boolean(ch.hasCatchup),
    catchupDays: typeof ch.catchupDays === 'number' ? ch.catchupDays : 7,
    isLocked: Boolean(ch.isLocked),
    fps: typeof ch.fps === 'number' ? ch.fps : 50,
  };
}

export const IPTVProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Device Detection Engine (Phone, Tablet, Smart TV)
  const device = useDeviceDetection();

  const [isVirtualRemoteOpen, setIsVirtualRemoteOpen] = useState<boolean>(false);
  const [tuningNumber, setTuningNumber] = useState<string | null>(null);
  const tuningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial states from localStorage if available
  const [servers, setServers] = useState<ServerProfile[]>(() => {
    try {
      const saved = localStorage.getItem('istb_servers');
      return saved ? JSON.parse(saved) : DEFAULT_SERVERS;
    } catch {
      return DEFAULT_SERVERS;
    }
  });

  const [activeServerId, setActiveServerIdState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('istb_active_server');
      return saved || 'demo-public-streams';
    } catch {
      return 'demo-public-streams';
    }
  });

  const [activeView, setActiveView] = useState<AppView>('live');
  const [selectedCategory, setSelectedCategory] = useState<string>('Tous');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [channels, setChannels] = useState<Channel[]>(() => DEMO_CHANNELS.map(sanitizeChannel));
  const [activeChannel, setActiveChannel] = useState<Channel | null>(() => sanitizeChannel(DEMO_CHANNELS[0]));
  const [vodMovies, setVodMovies] = useState<VODItem[]>(DEMO_VOD_MOVIES);
  const [seriesList, setSeriesList] = useState<TVSeries[]>(DEMO_SERIES);
  const [activeVOD, setActiveVOD] = useState<VODItem | null>(null);

  const [isLoadingServer, setIsLoadingServer] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('istb_favorites');
      return saved ? JSON.parse(saved) : ['fr24-fr', 'arte-fr', 'redbull-tv', 'rakuten-action'];
    } catch {
      return ['fr24-fr', 'arte-fr', 'redbull-tv', 'rakuten-action'];
    }
  });

  const [history, setHistory] = useState<{ channel: Channel; timestamp: number }[]>(() => {
    try {
      const saved = localStorage.getItem('istb_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((item: { channel: Channel; timestamp: number }) => ({
          ...item,
          channel: sanitizeChannel(item.channel),
        }));
      }
      return [];
    } catch {
      return [];
    }
  });

  const [parentalSettings, setParentalSettings] = useState<ParentalControlSettings>(() => {
    try {
      const saved = localStorage.getItem('istb_parental');
      return saved ? JSON.parse(saved) : DEFAULT_PARENTAL;
    } catch {
      return DEFAULT_PARENTAL;
    }
  });

  const [playerSettings, setPlayerSettings] = useState<PlayerSettings>(() => {
    try {
      const saved = localStorage.getItem('istb_player_settings');
      const settings = saved ? JSON.parse(saved) : DEFAULT_PLAYER_SETTINGS;
      if (isStaticHost) {
        settings.useStreamProxy = false;
      }
      return settings;
    } catch {
      return DEFAULT_PLAYER_SETTINGS;
    }
  });

  const [reminders, setReminders] = useState<ProgramReminder[]>(() => {
    try {
      const saved = localStorage.getItem('istb_reminders');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // PIN Modal State
  const [isPinModalOpen, setIsPinModalOpen] = useState<boolean>(false);
  const [pinModalTitle, setPinModalTitle] = useState<string>('Contrôle Parental');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  // EPG Cache
  const [epgData, setEpgData] = useState<Record<string, EPGProgram[]>>({});
  const stalkerServiceRef = useRef<StalkerService | null>(null);

  // Load XMLTV FR & generate fallback EPG data for loaded channels
  useEffect(() => {
    let isMounted = true;
    const initialEpg: Record<string, EPGProgram[]> = {};
    
    // First fill with baseline schedules
    channels.slice(0, 150).forEach(ch => {
      initialEpg[ch.id] = generateDynamicEPG(ch.id);
    });
    setEpgData(initialEpg);

    // Asynchronously fetch live XMLTV FR data from xmltvfr.fr
    EPGService.fetchXmltvFR().then((xmltvMap) => {
      if (!isMounted || !xmltvMap || Object.keys(xmltvMap).length === 0) return;

      setEpgData((prev) => {
        const merged = { ...prev };
        channels.forEach((ch) => {
          const nameClean = ch.name ? ch.name.trim().toLowerCase() : '';
          const nameNormalized = nameClean.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const epgKey = (ch as any).tvgId || ch.id;

          // Find matches in XMLTV FR map
          const matchedPrograms = 
            xmltvMap[epgKey] ||
            xmltvMap[ch.id] ||
            xmltvMap[nameClean] ||
            xmltvMap[nameNormalized] ||
            xmltvMap[ch.id.toLowerCase()];

          if (matchedPrograms && matchedPrograms.length > 0) {
            merged[ch.id] = matchedPrograms;
          }
        });
        return merged;
      });
    }).catch(err => {
      console.warn('[IPTVContext] XMLTV FR integration notice:', err);
    });

    return () => { isMounted = false; };
  }, [channels]);

  // Persist storage
  useEffect(() => {
    localStorage.setItem('istb_servers', JSON.stringify(servers));
  }, [servers]);

  useEffect(() => {
    localStorage.setItem('istb_active_server', activeServerId);
  }, [activeServerId]);

  useEffect(() => {
    localStorage.setItem('istb_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('istb_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem('istb_parental', JSON.stringify(parentalSettings));
  }, [parentalSettings]);

  useEffect(() => {
    localStorage.setItem('istb_player_settings', JSON.stringify(playerSettings));
  }, [playerSettings]);

  useEffect(() => {
    localStorage.setItem('istb_reminders', JSON.stringify(reminders));
  }, [reminders]);

  // Server loading progress state
  const [serverProgress, setServerProgress] = useState<ServerLoadingProgress>({
    isLoading: false,
    step: 0,
    totalSteps: 4,
    message: '',
    percent: 0,
    detail: '',
    error: null,
    serverName: '',
  });

  const dismissServerProgress = () => {
    setServerProgress((prev) => ({ 
      ...prev, 
      isLoading: false, 
      percent: 0,
      error: null, 
      isDismissed: true 
    }));
  };

  const serversRef = useRef<ServerProfile[]>(servers);
  serversRef.current = servers;
  const activeServerIdRef = useRef<string>(activeServerId);
  activeServerIdRef.current = activeServerId;

  const activeServer = servers.find((s) => s.id === activeServerId) || servers[0] || null;

  // Load server channels when active server changes
  const loadServerData = async (server: ServerProfile) => {
    setIsLoadingServer(true);
    setServerError(null);

    setServerProgress({
      isLoading: true,
      step: 1,
      totalSteps: 4,
      message: 'Initialisation de la connexion...',
      percent: 15,
      detail: `Tentative d'accès à ${server.portalUrl || server.m3uUrl || server.name}...`,
      error: null,
      serverName: server.name,
      serverType: server.type,
    });

    try {
      if (server.type === 'demo') {
        setServerProgress({
          isLoading: true,
          step: 2,
          totalSteps: 4,
          message: 'Chargement des chaînes de démonstration...',
          percent: 50,
          detail: 'Extraction du bouquet HD / 4K iSTB...',
          error: null,
          serverName: server.name,
          serverType: 'demo',
        });

        await new Promise((r) => setTimeout(r, 400));
        const cleanChannels = DEMO_CHANNELS.map(sanitizeChannel);
        setChannels(cleanChannels);
        setVodMovies(DEMO_VOD_MOVIES);
        setSeriesList(DEMO_SERIES);
        if (cleanChannels.length > 0) setActiveChannel(cleanChannels[0]);
        updateServer(server.id, { status: 'connected', channelCount: cleanChannels.length });

        setServerProgress({
          isLoading: false,
          step: 4,
          totalSteps: 4,
          message: 'Connexion établie avec succès !',
          percent: 100,
          detail: `${cleanChannels.length} chaînes démo chargées.`,
          error: null,
          serverName: server.name,
          serverType: 'demo',
        });
      } else if (server.type === 'stalker' && server.portalUrl && server.macAddress) {
        setServerProgress({
          isLoading: true,
          step: 2,
          totalSteps: 4,
          message: 'Authentification au portail Stalker MAG...',
          percent: 35,
          detail: `Adresse MAC: ${server.macAddress} • Handshake avec le middleware...`,
          error: null,
          serverName: server.name,
          serverType: 'stalker',
        });

        const stalker = new StalkerService(server.portalUrl, server.macAddress);
        stalkerServiceRef.current = stalker;

        // Connect with timeout
        const connectPromise = stalker.connect();
        const timeoutPromise = new Promise<{ success: boolean; error: string }>((_, reject) =>
          setTimeout(() => reject(new Error('Délai de connexion dépassé (12s). Le serveur ne répond pas.')), 12000)
        );

        const res = (await Promise.race([connectPromise, timeoutPromise])) as any;

        if (res && res.success) {
          setServerProgress({
            isLoading: true,
            step: 3,
            totalSteps: 4,
            message: 'Récupération des chaînes TV...',
            percent: 50,
            detail: 'Téléchargement de la liste des chaînes Stalker MAG...',
            error: null,
            serverName: server.name,
            serverType: 'stalker',
          });

          const [loadedChannels, profile] = await Promise.all([
            stalker.getChannels(),
            stalker.getAccountProfile(),
          ]);

          const cleanChannels = loadedChannels.length > 0 ? loadedChannels.map(sanitizeChannel) : DEMO_CHANNELS.map(sanitizeChannel);
          setChannels(cleanChannels);
          if (cleanChannels.length > 0) {
            handleSelectChannel(cleanChannels[0]);
          }

          let portalKey = '';
          try {
            const u = new URL(server.portalUrl);
            portalKey = `${u.hostname}:${u.port || '80'}${u.pathname}`.replace(/[^a-zA-Z0-9.-]/g, '_');
          } catch {
            portalKey = server.portalUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
          }

          // Pre-load from IndexedDB cache immediately so user sees VOD instantly even in background
          try {
            const [cachedM, cachedS] = await Promise.all([
              vodCacheService.getCachedMovies(portalKey),
              vodCacheService.getCachedSeries(portalKey),
            ]);
            if (cachedM && cachedM.length > 0) setVodMovies(cachedM);
            if (cachedS && cachedS.length > 0) setSeriesList(cachedS);
          } catch (err) {
            console.warn('[IPTVContext] Pre-load cache note:', err);
          }

          setServerProgress({
            isLoading: true,
            step: 3,
            totalSteps: 4,
            message: 'Analyse et récupération du catalogue VOD (Films & Séries)...',
            percent: 65,
            detail: 'Lancement du téléchargeur fiabilisé avec concurrence adaptative...',
            error: null,
            serverName: server.name,
            serverType: 'stalker',
            channelsCount: cleanChannels.length,
          });

          // Fetch full VOD Movies and Series catalogue with live progress callbacks
          const { movies: loadedVod, series: loadedSeries, auditReport } = await stalker.fetchVodCatalogue((prog) => {
            const movieFetched = prog.movies.fetchedPages;
            const movieExpected = prog.movies.expectedPages || 1;
            const seriesFetched = prog.series.fetchedPages;
            const seriesExpected = prog.series.expectedPages || 1;
            const totalFetchedPages = movieFetched + seriesFetched;
            const totalExpectedPages = movieExpected + seriesExpected;
            const calculatedPercent = Math.min(98, 65 + Math.floor((totalFetchedPages / Math.max(1, totalExpectedPages)) * 33));

            // Stream live movies & series into state so user sees items as they arrive or in background
            if (prog.currentMovies && prog.currentMovies.length > 0) {
              setVodMovies(prog.currentMovies);
            }
            if (prog.currentSeries && prog.currentSeries.length > 0) {
              setSeriesList(prog.currentSeries);
            }

            setServerProgress((prev) => ({
              ...prev,
              isLoading: true,
              step: 3,
              message: prog.statusMessage || 'Récupération du catalogue VOD Stalker...',
              percent: calculatedPercent,
              detail: `Films: ${prog.movies.uniqueCount}/${prog.movies.serverTotal || '?'} • Séries: ${prog.series.uniqueCount}/${prog.series.serverTotal || '?'} • Reqs: ${prog.activeRequests} • Retry: ${prog.retryCount}`,
              channelsCount: cleanChannels.length,
              vodCount: prog.movies.uniqueCount,
              seriesCount: prog.series.uniqueCount,
              stalkerVodProgress: prog,
            }));
          });

          setVodMovies(loadedVod);
          setSeriesList(loadedSeries);

          updateServer(server.id, {
            status: 'connected',
            channelCount: cleanChannels.length,
            vodCount: loadedVod.length,
            seriesCount: loadedSeries.length,
            expiryDate: profile.expiryDate || '31/12/2026',
            maxConnections: profile.maxConnections || 1,
          });

          const isCompleteOk = auditReport.catalogComplete === 'YES';

          setServerProgress({
            isLoading: false,
            step: 4,
            totalSteps: 4,
            message: isCompleteOk ? 'Catalogue Stalker 100% Complet !' : 'Connexion Stalker établie (Catalogue Partiel)',
            percent: 100,
            detail: `Audit: CATALOG COMPLETE: ${auditReport.catalogComplete} (${loadedVod.length} films, ${loadedSeries.length} séries, ${cleanChannels.length} chaînes).`,
            error: null,
            serverName: server.name,
            serverType: 'stalker',
            channelsCount: cleanChannels.length,
            vodCount: loadedVod.length,
            seriesCount: loadedSeries.length,
            expiryDate: profile.expiryDate || '31/12/2026',
            macAddress: server.macAddress,
            stalkerAuditReport: auditReport,
          });
        } else {
          const errMsg = res?.error || 'Erreur de connexion Stalker';
          setServerError(errMsg);
          updateServer(server.id, { status: 'error', errorMessage: errMsg });

          setServerProgress({
            isLoading: false,
            step: 2,
            totalSteps: 4,
            message: 'Échec de connexion au portail',
            percent: 35,
            detail: errMsg,
            error: errMsg,
            serverName: server.name,
            serverType: 'stalker',
          });
        }
      } else if (server.type === 'xtream' && server.portalUrl && server.username && server.password) {
        setServerProgress({
          isLoading: true,
          step: 2,
          totalSteps: 4,
          message: 'Authentification Xtream Codes...',
          percent: 35,
          detail: `Utilisateur : ${server.username} • Validation du compte...`,
          error: null,
          serverName: server.name,
          serverType: 'xtream',
        });

        const xtream = new XtreamService(server.portalUrl, server.username, server.password);

        const authPromise = xtream.authenticate();
        const timeoutPromise = new Promise<{ success: boolean; error: string }>((_, reject) =>
          setTimeout(() => reject(new Error('Délai de connexion dépassé (12s). Le serveur ne répond pas.')), 12000)
        );

        const auth = (await Promise.race([authPromise, timeoutPromise])) as any;

        if (auth && auth.success) {
          setServerProgress({
            isLoading: true,
            step: 3,
            totalSteps: 4,
            message: 'Téléchargement des bouquets (Live, VOD, Séries)...',
            percent: 70,
            detail: 'Récupération des flux Xtream...',
            error: null,
            serverName: server.name,
            serverType: 'xtream',
          });

          const [streams, vod, series] = await Promise.all([
            xtream.getLiveStreams(),
            xtream.getVOD(),
            xtream.getSeries(),
          ]);

          setServerProgress({
            isLoading: true,
            step: 4,
            totalSteps: 4,
            message: 'Analyse et organisation des flux...',
            percent: 90,
            detail: `${streams.length} chaînes, ${vod.length} VOD, ${series.length} séries.`,
            error: null,
            serverName: server.name,
            serverType: 'xtream',
          });

          const cleanStreams = streams.length > 0 ? streams.map(sanitizeChannel) : DEMO_CHANNELS.map(sanitizeChannel);
          setChannels(cleanStreams);
          if (cleanStreams.length > 0) setActiveChannel(cleanStreams[0]);

          setVodMovies(vod);
          setSeriesList(series);

          const expDateFormatted = auth.userInfo?.exp_date ? new Date(parseInt(auth.userInfo.exp_date, 10) * 1000).toLocaleDateString('fr-FR') : '31/12/2026';

          updateServer(server.id, { 
            status: 'connected', 
            channelCount: cleanStreams.length,
            vodCount: vod.length,
            seriesCount: series.length,
            expiryDate: expDateFormatted,
            maxConnections: auth.userInfo?.max_connections ? parseInt(auth.userInfo.max_connections, 10) : 1
          });

          setServerProgress({
            isLoading: false,
            step: 4,
            totalSteps: 4,
            message: 'Connexion réussie !',
            percent: 100,
            detail: `${cleanStreams.length} chaînes, ${vod.length} VOD et ${series.length} séries disponibles.`,
            error: null,
            serverName: server.name,
            serverType: 'xtream',
          });
        } else {
          const errMsg = auth?.error || 'Erreur authentification Xtream';
          setServerError(errMsg);
          updateServer(server.id, { status: 'error', errorMessage: errMsg });

          setServerProgress({
            isLoading: false,
            step: 2,
            totalSteps: 4,
            message: 'Authentification Xtream échouée',
            percent: 35,
            detail: errMsg,
            error: errMsg,
            serverName: server.name,
            serverType: 'xtream',
          });
        }
      } else if (server.type === 'm3u' && server.m3uUrl) {
        setServerProgress({
          isLoading: true,
          step: 2,
          totalSteps: 4,
          message: 'Téléchargement de la playlist M3U distant...',
          percent: 40,
          detail: `URL: ${server.m3uUrl}`,
          error: null,
          serverName: server.name,
          serverType: 'm3u',
        });

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        const m3uFetchUrl = isStaticHost 
          ? `https://corsproxy.io/?url=${encodeURIComponent(server.m3uUrl)}`
          : `/api/m3u/fetch?url=${encodeURIComponent(server.m3uUrl)}`;

        const response = await fetch(m3uFetchUrl, {
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.ok) {
          setServerProgress({
            isLoading: true,
            step: 3,
            totalSteps: 4,
            message: 'Analyse des en-têtes M3U et parsing...',
            percent: 75,
            detail: 'Extraction des métadonnées #EXTINF...',
            error: null,
            serverName: server.name,
            serverType: 'm3u',
          });

          const content = await response.text();
          const parsedResult = parseM3UFull(content);

          if (parsedResult.channels.length > 0 || parsedResult.vodMovies.length > 0 || parsedResult.seriesList.length > 0) {
            const cleanChannels = parsedResult.channels.length > 0 ? parsedResult.channels.map(sanitizeChannel) : DEMO_CHANNELS.map(sanitizeChannel);
            setChannels(cleanChannels);
            if (cleanChannels.length > 0) setActiveChannel(cleanChannels[0]);

            setVodMovies(parsedResult.vodMovies);
            setSeriesList(parsedResult.seriesList);

            updateServer(server.id, {
              status: 'connected',
              channelCount: cleanChannels.length,
              vodCount: parsedResult.vodMovies.length,
              seriesCount: parsedResult.seriesList.length,
            });

            setServerProgress({
              isLoading: false,
              step: 4,
              totalSteps: 4,
              message: 'Playlist M3U chargée avec succès !',
              percent: 100,
              detail: `${cleanChannels.length} chaînes, ${parsedResult.vodMovies.length} films et ${parsedResult.seriesList.length} séries extraits.`,
              error: null,
              serverName: server.name,
              serverType: 'm3u',
            });
          } else {
            const errMsg = 'La playlist M3U est vide ou le format n\'est pas reconnu.';
            setServerError(errMsg);
            updateServer(server.id, { status: 'error', errorMessage: errMsg });

            setServerProgress({
              isLoading: false,
              step: 3,
              totalSteps: 4,
              message: 'Fichier M3U invalide',
              percent: 75,
              detail: errMsg,
              error: errMsg,
              serverName: server.name,
              serverType: 'm3u',
            });
          }
        } else {
          const errMsg = 'Impossible de télécharger la playlist M3U (Erreur serveur ou CORS).';
          setServerError(errMsg);
          updateServer(server.id, { status: 'error', errorMessage: errMsg });

          setServerProgress({
            isLoading: false,
            step: 2,
            totalSteps: 4,
            message: 'Erreur Téléchargement M3U',
            percent: 40,
            detail: errMsg,
            error: errMsg,
            serverName: server.name,
            serverType: 'm3u',
          });
        }
      }
    } catch (err: any) {
      console.error('Server loading error:', err);
      const errMsg = err.message || 'Erreur de connexion inattendue.';
      setServerError(errMsg);

      setServerProgress({
        isLoading: false,
        step: 0,
        totalSteps: 4,
        message: 'Échec de la connexion',
        percent: 0,
        detail: errMsg,
        error: errMsg,
        serverName: server.name,
        serverType: server.type,
      });
    } finally {
      setIsLoadingServer(false);
    }
  };

  // Load IndexedDB cache immediately whenever activeServerId changes or on app boot
  useEffect(() => {
    let isMounted = true;
    const loadCachedCatalog = async () => {
      const srv = servers.find((s) => s.id === activeServerId) || servers[0];
      if (!srv || srv.type !== 'stalker' || !srv.portalUrl) return;

      let portalKey = '';
      try {
        const u = new URL(srv.portalUrl);
        portalKey = `${u.hostname}:${u.port || '80'}${u.pathname}`.replace(/[^a-zA-Z0-9.-]/g, '_');
      } catch {
        portalKey = srv.portalUrl.replace(/[^a-zA-Z0-9.-]/g, '_');
      }

      if (!portalKey) return;

      try {
        const [cachedM, cachedS] = await Promise.all([
          vodCacheService.getCachedMovies(portalKey),
          vodCacheService.getCachedSeries(portalKey),
        ]);
        if (isMounted) {
          if (cachedM && cachedM.length > 0) setVodMovies(cachedM);
          if (cachedS && cachedS.length > 0) setSeriesList(cachedS);
        }
      } catch (err) {
        console.warn('[IPTVContext] Error loading initial IndexedDB cache:', err);
      }
    };

    loadCachedCatalog();
    return () => { isMounted = false; };
  }, [activeServerId, servers]);

  // Auto-load active server data on startup / refresh
  const initialLoadRef = useRef(false);
  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      const target = servers.find((s) => s.id === activeServerId) || servers[0];
      if (target) {
        loadServerData(target);
      }
    }
  }, []);

  const setActiveServerId = (id: string) => {
    setActiveServerIdState(id);
    const target = servers.find((s) => s.id === id);
    if (target) {
      loadServerData(target);
    }
  };

  const refreshServerData = async () => {
    if (activeServer) {
      await loadServerData(activeServer);
    }
  };

  const addServer = async (newServerData: Omit<ServerProfile, 'id'>): Promise<boolean> => {
    const id = `srv-${Date.now()}`;
    const newServer: ServerProfile = {
      ...newServerData,
      id,
      status: 'connecting',
      lastConnected: new Date().toLocaleDateString('fr-FR'),
    };

    setServers((prev) => [...prev, newServer]);
    setActiveServerIdState(id);
    await loadServerData(newServer);
    return true;
  };

  const updateServer = (id: string, updates: Partial<ServerProfile>) => {
    setServers((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, ...updates } : s));
      serversRef.current = updated;
      return updated;
    });

    // If liveStreamFormat changed on the active server, refresh the active channel immediately
    if ((activeServerId === id || activeServerIdRef.current === id) && updates.liveStreamFormat && activeChannel) {
      setTimeout(() => {
        handleSelectChannel(activeChannel);
      }, 20);
    }
  };

  const deleteServer = (id: string) => {
    setServers((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      serversRef.current = updated;
      return updated;
    });
    if (activeServerId === id) {
      const remaining = servers.filter((s) => s.id !== id);
      if (remaining.length > 0) {
        setActiveServerId(remaining[0].id);
      }
    }
  };

  // Favorites & History
  const toggleFavorite = (channelId: string) => {
    setFavorites((prev) =>
      prev.includes(channelId) ? prev.filter((id) => id !== channelId) : [...prev, channelId]
    );
  };

  const recordHistory = (channel: Channel) => {
    const cleanCh = sanitizeChannel(channel);
    setHistory((prev) => {
      const filtered = prev.filter((h) => h.channel.id !== cleanCh.id);
      return [{ channel: cleanCh, timestamp: Date.now() }, ...filtered].slice(0, 50);
    });
  };

  // Channel Selection with Parental Lock check
  const handleSelectChannel = (rawCh: Channel | null) => {
    if (!rawCh) {
      setActiveChannel(null);
      return;
    }
    const ch = sanitizeChannel(rawCh);

    const applyChannel = async (targetCh: Channel) => {
      let channelToPlay = targetCh;

      const currentServer = serversRef.current.find((s) => s.id === (activeServerIdRef.current || activeServerId)) || activeServer;
      const cmdToResolve = (targetCh as any)._cmd || targetCh.cmd || ((targetCh.streamUrl?.includes('/ch/') || targetCh.streamUrl?.includes('/play/live.php')) ? targetCh.streamUrl : undefined) || (targetCh as any)._originalTsUrl;

      // If stalker and has cmd or streamUrl, resolve dynamic link from portal FIRST
      if (currentServer?.type === 'stalker' && stalkerServiceRef.current && cmdToResolve) {
        try {
          const portalUrl = currentServer.portalUrl || '';
          const liveFormatSetting = currentServer.liveStreamFormat || 'auto';

          // 1. Get or auto-detect portal capabilities if in auto mode
          let caps = StalkerCapabilityService.getCapabilities(portalUrl);
          let capSource: 'cache' | 'automatic-test' | 'channel-override' | 'manual' = 'cache';

          if (liveFormatSetting === 'auto') {
            if (!caps || StalkerCapabilityService.isExpired(caps)) {
              caps = await StalkerCapabilityService.testHlsCapability(stalkerServiceRef.current, cmdToResolve);
              capSource = 'automatic-test';
            }
            StalkerCapabilityService.logCapabilitiesDiagnostic(caps, capSource);
          }

          // 2. Generate a FRESH create_link specifically for video playback so play_token is unused
          const dynamicUrl = await stalkerServiceRef.current.createLink(cmdToResolve);
          if (dynamicUrl) {
            const extractedStreamId = (targetCh as any).streamId || (targetCh as any).chId || (cmdToResolve?.match(/\/ch\/([a-zA-Z0-9_-]+?)(?:_|\.|$|\s)/i)?.[1]) || (targetCh.id?.replace(/^stalker-/, ''));

            const { finalUrl, audit, transformed } = StalkerCapabilityService.transformStalkerLiveUrl(
              dynamicUrl,
              liveFormatSetting,
              caps,
              targetCh.id,
              extractedStreamId,
              cmdToResolve
            );

            channelToPlay = sanitizeChannel({ ...targetCh, streamUrl: finalUrl });
            (channelToPlay as any)._cmd = cmdToResolve;
            (channelToPlay as any)._stalkerHlsAudit = audit;
            (channelToPlay as any)._isStalkerHls = transformed;
            (channelToPlay as any)._originalTsUrl = dynamicUrl;
            (channelToPlay as any)._portalUrl = portalUrl;
            (channelToPlay as any)._portalKey = caps?.portalKey || StalkerCapabilityService.getPortalKey(portalUrl);
            (channelToPlay as any)._liveStreamFormatSetting = liveFormatSetting;
          }
        } catch (e) {
          console.warn('[Stalker] Dynamic link resolution notice:', e);
        }
      } else if (currentServer?.type === 'stalker' && targetCh.streamUrl) {
        // If already resolved, still enforce current server liveStreamFormat
        const liveFormatSetting = currentServer.liveStreamFormat || 'auto';
        const extractedStreamId = (targetCh as any).streamId || (targetCh as any).chId || (targetCh.cmd?.match(/\/ch\/([a-zA-Z0-9_-]+?)(?:_|\.|$|\s)/i)?.[1]) || (targetCh.id?.replace(/^stalker-/, ''));

        const { finalUrl, audit, transformed } = StalkerCapabilityService.transformStalkerLiveUrl(
          targetCh.streamUrl,
          liveFormatSetting,
          null,
          targetCh.id,
          extractedStreamId,
          targetCh.cmd
        );
        channelToPlay = sanitizeChannel({ ...targetCh, streamUrl: finalUrl });
        (channelToPlay as any)._stalkerHlsAudit = audit;
        (channelToPlay as any)._isStalkerHls = transformed;
        (channelToPlay as any)._liveStreamFormatSetting = liveFormatSetting;
      }

      setActiveChannel(channelToPlay);
      recordHistory(channelToPlay);
    };

    if (isChannelLocked(ch) && !parentalSettings.isSessionUnlocked) {
      requestPinForAction(() => {
        applyChannel(ch);
      }, `Canal verrouillé : ${ch.name}`);
      return;
    }

    applyChannel(ch);
  };

  // Channel Zapping
  const zapNext = () => {
    if (!activeChannel || channels.length === 0) return;
    const currentIndex = channels.findIndex((c) => c.id === activeChannel.id);
    const nextIndex = (currentIndex + 1) % channels.length;
    handleSelectChannel(channels[nextIndex]);
  };

  const zapPrev = () => {
    if (!activeChannel || channels.length === 0) return;
    const currentIndex = channels.findIndex((c) => c.id === activeChannel.id);
    const prevIndex = (currentIndex - 1 + channels.length) % channels.length;
    handleSelectChannel(channels[prevIndex]);
  };

  const zapToNumber = (num: number) => {
    const found = channels.find((c) => c.number === num);
    if (found) {
      handleSelectChannel(found);
    }
  };

  // Channel direct tuning buffer for TV Remote (e.g. typing 1 then 2 = channel 12)
  const handleRemoteDigit = (digit: string) => {
    setTuningNumber((prev) => {
      const newVal = (prev ? prev : '') + digit;
      if (tuningTimeoutRef.current) clearTimeout(tuningTimeoutRef.current);
      tuningTimeoutRef.current = setTimeout(() => {
        const chNum = parseInt(newVal, 10);
        if (!isNaN(chNum)) {
          zapToNumber(chNum);
        }
        setTuningNumber(null);
      }, 1300);
      return newVal;
    });
  };

  // Global Keyboard Listener for TV Remote Control / D-Pad Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      // 0-9 digits for TV channel direct tuning
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleRemoteDigit(e.key);
        return;
      }

      // TV D-Pad & Remote key shortcuts
      switch (e.key) {
        case 'ArrowUp':
        case 'PageUp':
        case 'ChannelUp':
          if (activeView === 'live') {
            e.preventDefault();
            zapPrev();
          }
          break;
        case 'ArrowDown':
        case 'PageDown':
        case 'ChannelDown':
          if (activeView === 'live') {
            e.preventDefault();
            zapNext();
          }
          break;
        case 'm':
        case 'M':
          updatePlayerSettings({ muted: !playerSettings.muted });
          break;
        case 'f':
        case 'F':
          safeToggleFullscreen();
          break;
        case 'g':
        case 'G':
          setActiveView(activeView === 'epg' ? 'live' : 'epg');
          break;
        case 'v':
        case 'V':
          setActiveView(activeView === 'vod' ? 'live' : 'vod');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (tuningTimeoutRef.current) clearTimeout(tuningTimeoutRef.current);
    };
  }, [activeView, activeChannel, channels, playerSettings.muted]);

  // Parental Control Logic
  const isChannelLocked = (channel: Channel | null | undefined): boolean => {
    if (!channel || !parentalSettings?.enabled) return false;
    const lockedIds = parentalSettings.lockedChannelIds || [];
    const lockedCats = parentalSettings.lockedCategories || [];
    if (channel.id && lockedIds.includes(channel.id)) return true;
    if (channel.category && lockedCats.includes(channel.category)) return true;
    if (channel.isLocked) return true;
    return false;
  };

  const isCategoryLocked = (category: string | null | undefined): boolean => {
    if (!category || !parentalSettings?.enabled) return false;
    const lockedCats = parentalSettings.lockedCategories || [];
    return lockedCats.includes(category);
  };

  const unlockSessionWithPin = (pin: string): boolean => {
    if (pin === parentalSettings.pinCode) {
      setParentalSettings((prev) => ({
        ...prev,
        isSessionUnlocked: true,
        sessionUnlockedUntil: Date.now() + 30 * 60 * 1000, // 30 minutes
      }));
      return true;
    }
    return false;
  };

  const lockSession = () => {
    setParentalSettings((prev) => ({
      ...prev,
      isSessionUnlocked: false,
      sessionUnlockedUntil: undefined,
    }));
  };

  const updateParentalSettings = (updates: Partial<ParentalControlSettings>) => {
    setParentalSettings((prev) => ({ ...prev, ...updates }));
  };

  const requestPinForAction = (onSuccess: () => void, promptTitle = 'Code PIN Parental Requis') => {
    if (!parentalSettings.enabled || parentalSettings.isSessionUnlocked) {
      onSuccess();
      return;
    }
    setPinModalTitle(promptTitle);
    setPendingAction(() => onSuccess);
    setIsPinModalOpen(true);
  };

  const closePinModal = () => {
    setIsPinModalOpen(false);
    setPendingAction(null);
  };

  const handlePinSuccess = () => {
    setIsPinModalOpen(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const updatePlayerSettings = (updates: Partial<PlayerSettings>) => {
    setPlayerSettings((prev) => ({ ...prev, ...updates }));
  };

  // Reminders
  const addReminder = (reminder: Omit<ProgramReminder, 'id'>) => {
    const id = `rem-${Date.now()}`;
    setReminders((prev) => [...prev, { ...reminder, id }]);
  };

  const removeReminder = (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
  };

  const clearHistory = () => {
    setHistory([]);
  };

  // Filtered channels memoized for high performance
  const filteredChannels = useMemo(() => {
    if (!channels || !Array.isArray(channels)) return [];
    const q = searchQuery ? searchQuery.trim().toLowerCase() : '';
    const cat = selectedCategory || 'Tous';

    return channels.filter((ch) => {
      if (!ch) return false;
      const chCat = ch.category || 'Généraliste';
      const matchesCategory = 
        cat === 'Tous' ? true :
        cat === 'Favoris' ? (favorites || []).includes(ch.id) :
        chCat.toLowerCase() === cat.toLowerCase();

      if (!matchesCategory) return false;

      if (!q) return true;
      const chName = ch.name ? ch.name.toLowerCase() : '';
      const chNumStr = ch.number !== undefined && ch.number !== null ? ch.number.toString() : '';
      return chName.includes(q) || chNumStr === q;
    });
  }, [channels, selectedCategory, searchQuery, favorites]);

  return (
    <IPTVContext.Provider
      value={{
        // Device Engine
        deviceType: device.deviceType,
        detectedType: device.detectedType,
        deviceMode: device.deviceMode,
        setDeviceMode: device.setDeviceMode,
        isPhone: device.isPhone,
        isTablet: device.isTablet,
        isTV: device.isTV,
        isTouch: device.isTouch,
        orientation: device.orientation,
        screenWidth: device.screenWidth,
        screenHeight: device.screenHeight,

        // Remote & Tuning
        isVirtualRemoteOpen,
        setIsVirtualRemoteOpen,
        tuningNumber,

        servers,
        activeServer,
        addServer,
        updateServer,
        deleteServer,
        setActiveServerId,
        refreshServerData,
        isLoadingServer,
        serverError,
        serverProgress,
        dismissServerProgress,

        activeView,
        setActiveView,
        selectedCategory,
        setSelectedCategory,
        searchQuery,
        setSearchQuery,

        channels,
        filteredChannels,
        activeChannel,
        setActiveChannel: handleSelectChannel,
        zapNext,
        zapPrev,
        zapToNumber,

        vodMovies,
        seriesList,
        activeVOD,
        setActiveVOD,

        favorites,
        toggleFavorite,
        history,
        clearHistory,

        epgData,
        reminders,
        addReminder,
        removeReminder,

        parentalSettings,
        updateParentalSettings,
        isChannelLocked,
        isCategoryLocked,
        isSessionUnlocked: parentalSettings.isSessionUnlocked,
        unlockSessionWithPin,
        lockSession,
        requestPinForAction,
        isPinModalOpen,
        closePinModal,
        pinModalTitle,
        handlePinSuccess,

        playerSettings,
        updatePlayerSettings,
      }}
    >
      {children}
    </IPTVContext.Provider>
  );
};

export const useIPTV = () => {
  const context = useContext(IPTVContext);
  if (!context) {
    throw new Error('useIPTV must be used within an IPTVProvider');
  }
  return context;
};
