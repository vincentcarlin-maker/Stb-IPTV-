export interface DevicePlayerOption {
  id: 'generic' | 'vlc' | 'nplayer' | 'infuse' | 'outplayer' | 'iina' | 'mx' | 'just' | 'safari' | 'tab';
  name: string;
  icon: string;
  color: string;
  description: string;
  platform: 'all' | 'ios' | 'android';
}

export const DEVICE_PLAYER_LIST: DevicePlayerOption[] = [
  {
    id: 'vlc',
    name: 'VLC Media Player',
    icon: 'Cone',
    color: 'text-orange-400 bg-orange-500/20 border-orange-500/30',
    description: 'Compatible iOS & Android',
    platform: 'all'
  },
  {
    id: 'nplayer',
    name: 'nPlayer',
    icon: 'PlayCircle',
    color: 'text-sky-400 bg-sky-500/20 border-sky-500/30',
    description: 'Lecteur puissant iOS/Android',
    platform: 'all'
  },
  {
    id: 'infuse',
    name: 'Infuse',
    icon: 'Tv',
    color: 'text-amber-400 bg-amber-500/20 border-amber-500/30',
    description: 'Lecteur Home Cinéma iOS / Apple',
    platform: 'ios'
  },
  {
    id: 'outplayer',
    name: 'Outplayer',
    icon: 'Zap',
    color: 'text-indigo-400 bg-indigo-500/20 border-indigo-500/30',
    description: 'Lecteur léger haute performance iOS',
    platform: 'ios'
  },
  {
    id: 'iina',
    name: 'IINA',
    icon: 'MonitorPlay',
    color: 'text-teal-400 bg-teal-500/20 border-teal-500/30',
    description: 'Lecteur moderne macOS / iOS',
    platform: 'all'
  },
  {
    id: 'mx',
    name: 'MX Player',
    icon: 'Film',
    color: 'text-blue-400 bg-blue-500/20 border-blue-500/30',
    description: 'Lecteur Android avec décodage HW+',
    platform: 'android'
  },
  {
    id: 'just',
    name: 'Just Player',
    icon: 'Play',
    color: 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30',
    description: 'Lecteur léger ExoPlayer Android',
    platform: 'android'
  },
  {
    id: 'safari',
    name: 'Safari / Navigateur Direct',
    icon: 'Globe',
    color: 'text-purple-400 bg-purple-500/20 border-purple-500/30',
    description: 'Ouvrir le lien direct dans un nouvel onglet',
    platform: 'all'
  }
];

export function buildAbsoluteStreamUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
  }
  return rawUrl;
}

export function openInDevicePlayer(
  rawUrl: string,
  title?: string,
  playerType: 'generic' | 'vlc' | 'nplayer' | 'infuse' | 'outplayer' | 'iina' | 'mx' | 'just' | 'safari' | 'tab' = 'generic'
): void {
  const absUrl = buildAbsoluteStreamUrl(rawUrl);
  if (!absUrl) return;

  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
  const cleanUrlNoScheme = absUrl.replace(/^https?:\/\//, '');

  switch (playerType) {
    case 'vlc':
      // Try VLC url scheme, fallback to direct open
      window.location.href = `vlc://${cleanUrlNoScheme}`;
      setTimeout(() => {
        window.open(absUrl, '_blank');
      }, 1400);
      break;

    case 'nplayer':
      if (absUrl.startsWith('https://')) {
        window.location.href = `nplayer-https://${cleanUrlNoScheme}`;
      } else {
        window.location.href = `nplayer-http://${cleanUrlNoScheme}`;
      }
      setTimeout(() => {
        window.open(absUrl, '_blank');
      }, 1400);
      break;

    case 'infuse':
      window.location.href = `infuse://control/play?url=${encodeURIComponent(absUrl)}`;
      setTimeout(() => {
        window.open(absUrl, '_blank');
      }, 1400);
      break;

    case 'outplayer':
      window.location.href = `outplayer://${absUrl}`;
      setTimeout(() => {
        window.open(absUrl, '_blank');
      }, 1400);
      break;

    case 'iina':
      window.location.href = `iina://weblink?url=${encodeURIComponent(absUrl)}`;
      setTimeout(() => {
        window.open(absUrl, '_blank');
      }, 1400);
      break;

    case 'mx':
      window.location.href = `intent://${cleanUrlNoScheme}#Intent;package=com.mxtech.videoplayer.ad;type=video/*;scheme=http;end`;
      setTimeout(() => {
        window.open(absUrl, '_blank');
      }, 1400);
      break;

    case 'just':
      window.location.href = `intent://${cleanUrlNoScheme}#Intent;package=com.brouken.player;type=video/*;scheme=http;end`;
      setTimeout(() => {
        window.open(absUrl, '_blank');
      }, 1400);
      break;

    case 'safari':
    case 'tab': {
      const a = document.createElement('a');
      a.href = absUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
      break;
    }

    case 'generic':
    default:
      if (isAndroid) {
        const intentUrl = `intent://${cleanUrlNoScheme}#Intent;action=android.intent.action.VIEW;type=video/*;scheme=http;end`;
        window.location.href = intentUrl;
        setTimeout(() => {
          window.open(absUrl, '_blank');
        }, 1400);
      } else {
        const a = document.createElement('a');
        a.href = absUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.click();
      }
      break;
  }
}
