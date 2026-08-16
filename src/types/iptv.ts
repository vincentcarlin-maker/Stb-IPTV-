export type DeviceType = 'phone' | 'tablet' | 'tv';
export type DeviceMode = 'auto' | 'phone' | 'tablet' | 'tv';

export type ServerType = 'stalker' | 'xtream' | 'm3u' | 'demo';

export interface ServerProfile {
  id: string;
  name: string;
  type: ServerType;
  portalUrl?: string; // Stalker Portal or Xtream Server URL
  macAddress?: string; // MAG / Stalker MAC (e.g. 00:1A:79:XX:XX:XX)
  username?: string; // Xtream username
  password?: string; // Xtream password
  m3uUrl?: string; // M3U URL
  epgUrl?: string; // XMLTV EPG URL
  active?: boolean;
  status?: 'connected' | 'error' | 'connecting' | 'idle';
  errorMessage?: string;
  channelCount?: number;
  vodCount?: number;
  seriesCount?: number;
  expiryDate?: string;
  maxConnections?: number;
  lastConnected?: string;
}

export interface EPGProgram {
  id: string;
  channelId: string;
  title: string;
  start: number; // Unix timestamp in ms
  end: number;   // Unix timestamp in ms
  description?: string;
  category?: string;
  rating?: string; // "Tous publics", "10+", "12+", "16+", "18+"
  poster?: string;
  director?: string;
  cast?: string[];
  season?: number;
  episode?: number;
}

export interface Channel {
  id: string;
  number: number;
  name: string;
  streamUrl: string;
  cmd?: string;
  backupStreamUrl?: string;
  logo?: string;
  category: string;
  epgId?: string;
  isLocked?: boolean;
  isFavorite?: boolean;
  resolution?: '4K' | 'FHD' | 'HD' | 'SD';
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  format?: string;
  hasCatchup?: boolean;
  catchupDays?: number;
  audioTracks?: string[];
  subtitles?: string[];
  radio?: boolean;
}

export interface VODItem {
  id: string;
  title: string;
  streamUrl: string;
  poster: string;
  backdrop?: string;
  category: string;
  rating: string;
  releaseYear: number;
  duration: string; // e.g. "1h 54min"
  overview: string;
  genre: string[];
  director?: string;
  cast?: string[];
  isFavorite?: boolean;
  isLocked?: boolean;
  addedDate?: string;
}

export interface TVSeriesEpisode {
  id: string;
  episodeNumber: number;
  title: string;
  streamUrl: string;
  duration: string;
  overview?: string;
  thumbnail?: string;
}

export interface TVSeriesSeason {
  seasonNumber: number;
  title: string;
  episodes: TVSeriesEpisode[];
}

export interface TVSeries {
  id: string;
  title: string;
  poster: string;
  backdrop?: string;
  category: string;
  rating: string;
  releaseYear: number;
  overview: string;
  genre: string[];
  totalSeasons: number;
  seasons: TVSeriesSeason[];
  isFavorite?: boolean;
  isLocked?: boolean;
}

export interface ParentalControlSettings {
  enabled: boolean;
  pinCode: string; // 4 digits
  lockedCategories: string[]; // e.g. ["Adulte / +18", "Charme", "Horreur 18+"]
  lockedRatings: string[]; // e.g. ["16+", "18+"]
  lockedChannelIds: string[];
  requirePinForSettings: boolean;
  requirePinForAdult: boolean;
  isSessionUnlocked: boolean;
  sessionUnlockedUntil?: number;
  securityQuestion: string;
  securityAnswer: string;
}

export interface ProgramReminder {
  id: string;
  programId: string;
  channelId: string;
  channelName: string;
  programTitle: string;
  startTime: number;
  endTime: number;
  notified?: boolean;
}

export interface ServerLoadingProgress {
  isLoading: boolean;
  step: number;
  totalSteps: number;
  message: string;
  percent: number;
  detail?: string;
  error?: string | null;
  serverName?: string;
  serverType?: string;
  isDismissed?: boolean;
  channelsCount?: number;
  vodCount?: number;
  seriesCount?: number;
  expiryDate?: string;
  macAddress?: string;
}

export interface PlayerSettings {
  bufferLength: 'low' | 'standard' | 'high';
  preferredQuality: 'auto' | '4k' | '1080p' | '720p';
  hardwareAcceleration: boolean;
  defaultAspectRatio: '16:9' | '4:3' | 'fit' | 'fill';
  audioVolume: number;
  muted: boolean;
  autoPlayNext: boolean;
  theme: 'dark-blue' | 'obsidian' | 'charcoal' | 'purple';
  useStreamProxy: boolean;
  quickZapping: boolean;
  osdTimeout: number; // in seconds
}

export type AppView = 
  | 'live'
  | 'epg'
  | 'vod'
  | 'series'
  | 'favorites'
  | 'history'
  | 'multiview'
  | 'parental'
  | 'servers'
  | 'settings'
  | 'player-test';
