export interface DevicePlayerOption {
  id: string;
  name: string;
  icon: string;
  description: string;
}

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

export function openInDevicePlayer(rawUrl: string, title?: string, playerType: 'generic' | 'vlc' | 'mx' | 'just' | 'tab' = 'generic'): void {
  const absUrl = buildAbsoluteStreamUrl(rawUrl);
  if (!absUrl) return;

  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
  const cleanUrlNoScheme = absUrl.replace(/^https?:\/\//, '');

  if (playerType === 'vlc') {
    // Attempt VLC protocol
    window.location.href = `vlc://${cleanUrlNoScheme}`;
    setTimeout(() => {
      // Fallback to opening direct link
      window.open(absUrl, '_blank');
    }, 1200);
    return;
  }

  if (playerType === 'mx') {
    window.location.href = `intent://${cleanUrlNoScheme}#Intent;package=com.mxtech.videoplayer.ad;type=video/*;scheme=http;end`;
    setTimeout(() => {
      window.open(absUrl, '_blank');
    }, 1200);
    return;
  }

  if (playerType === 'just') {
    window.location.href = `intent://${cleanUrlNoScheme}#Intent;package=com.brouken.player;type=video/*;scheme=http;end`;
    setTimeout(() => {
      window.open(absUrl, '_blank');
    }, 1200);
    return;
  }

  if (playerType === 'tab') {
    const a = document.createElement('a');
    a.href = absUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
    return;
  }

  // Generic player launch
  if (isAndroid) {
    // Android Intent to open system media player / installed app chooser
    const intentUrl = `intent://${cleanUrlNoScheme}#Intent;action=android.intent.action.VIEW;type=video/*;scheme=http;end`;
    window.location.href = intentUrl;
    setTimeout(() => {
      window.open(absUrl, '_blank');
    }, 1200);
  } else {
    // Desktop / iOS: Open in browser native video player window
    const a = document.createElement('a');
    a.href = absUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }
}
