// Cross-browser & iOS Safari safe Fullscreen Helper Utilities

interface FullscreenElementWithVendor extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
}

interface FullscreenDocWithVendor extends Document {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
}

interface HTMLVideoElementWithWebKit extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
}

/**
 * Checks if the document is currently in fullscreen mode
 */
export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FullscreenDocWithVendor;
  return !!(
    doc.fullscreenElement ||
    doc.webkitFullscreenElement ||
    doc.mozFullScreenElement ||
    doc.msFullscreenElement
  );
}

/**
 * Safely requests fullscreen on an element or fallback video
 */
export async function safeRequestFullscreen(element: HTMLElement | null = null): Promise<boolean> {
  if (typeof document === 'undefined') return false;

  const target = (element || document.documentElement) as FullscreenElementWithVendor;
  if (!target) return false;

  try {
    if (typeof target.requestFullscreen === 'function') {
      await target.requestFullscreen();
      return true;
    } else if (typeof target.webkitRequestFullscreen === 'function') {
      target.webkitRequestFullscreen();
      return true;
    } else if (typeof target.mozRequestFullScreen === 'function') {
      target.mozRequestFullScreen();
      return true;
    } else if (typeof target.msRequestFullscreen === 'function') {
      target.msRequestFullscreen();
      return true;
    }

    // iOS Safari fallback on video elements
    const video = (target.tagName === 'VIDEO' ? target : target.querySelector('video')) as HTMLVideoElementWithWebKit | null;
    if (video && typeof video.webkitEnterFullscreen === 'function') {
      video.webkitEnterFullscreen();
      return true;
    }
  } catch (err) {
    console.warn('Fullscreen request failed or was prevented by browser policy:', err);
  }

  return false;
}

/**
 * Safely exits fullscreen mode
 */
export async function safeExitFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const doc = document as FullscreenDocWithVendor;

  try {
    if (typeof doc.exitFullscreen === 'function') {
      await doc.exitFullscreen();
      return true;
    } else if (typeof doc.webkitExitFullscreen === 'function') {
      doc.webkitExitFullscreen();
      return true;
    } else if (typeof doc.mozCancelFullScreen === 'function') {
      doc.mozCancelFullScreen();
      return true;
    } else if (typeof doc.msExitFullscreen === 'function') {
      doc.msExitFullscreen();
      return true;
    }
  } catch (err) {
    console.warn('Exit fullscreen failed:', err);
  }

  return false;
}

/**
 * Safely toggles fullscreen on the given element or document
 */
export async function safeToggleFullscreen(element: HTMLElement | null = null): Promise<boolean> {
  if (isFullscreen()) {
    await safeExitFullscreen();
    return false;
  } else {
    await safeRequestFullscreen(element);
    return true;
  }
}
