import { useState, useEffect, useCallback } from 'react';
import { DeviceType, DeviceMode } from '../types/iptv';

export interface DeviceDetectionState {
  deviceType: DeviceType; // The effective device mode being applied
  detectedType: DeviceType; // What was automatically detected
  deviceMode: DeviceMode; // 'auto' | 'phone' | 'tablet' | 'tv'
  setDeviceMode: (mode: DeviceMode) => void;
  isPhone: boolean;
  isTablet: boolean;
  isTV: boolean;
  isTouch: boolean;
  orientation: 'portrait' | 'landscape';
  screenWidth: number;
  screenHeight: number;
}

const STORAGE_KEY = 'istb_device_mode_pref';

function detectActualDevice(): DeviceType {
  if (typeof window === 'undefined') return 'tv';

  const ua = (navigator.userAgent || navigator.vendor || (window as any).opera || '').toLowerCase();
  const width = window.innerWidth;
  const height = window.innerHeight;

  // 1. Check for TV User Agents & TV Platforms
  const tvKeywords = [
    'smart-tv',
    'smarttv',
    'googletv',
    'androidtv',
    'appletv',
    'tizen',
    'webos',
    'web0s',
    'roku',
    'viera',
    'bravia',
    'crkey',
    'chromecast',
    'mibox',
    'firetv',
    'firestick',
    'shield',
    'hbbtv',
    'netcast',
    'opera tv',
    'vizio',
    'pov_tv',
    'xbox',
    'playstation',
    'tv_box',
    'hisense',
    'philipstv',
    'mag250',
    'mag322',
    'mag420',
    'stb',
  ];

  const isTvUA = tvKeywords.some((keyword) => ua.includes(keyword));
  if (isTvUA) {
    return 'tv';
  }

  // 2. Check for TV Large Screen / 10-foot heuristics without touch and large standard TV resolution
  const isCoarseTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const isLargeScreen = width >= 1440 && height >= 800;

  // 3. Tablet detection
  const tabletKeywords = ['ipad', 'tablet', 'playbook', 'silk', 'kindle', 'sm-t', 'tab'];
  const isTabletUA = tabletKeywords.some((kw) => ua.includes(kw));

  // iPad on iOS 13+ (reports as Macintosh with touch)
  const isIPadOS = ua.includes('macintosh') && navigator.maxTouchPoints && navigator.maxTouchPoints > 1;

  if (isTabletUA || isIPadOS || (isCoarseTouch && width >= 768 && width < 1200)) {
    return 'tablet';
  }

  // 4. Phone detection
  const mobileKeywords = ['iphone', 'ipod', 'android', 'mobile', 'blackberry', 'windows phone', 'iemobile'];
  const isMobileUA = mobileKeywords.some((kw) => ua.includes(kw)) && !isTabletUA;

  if (isMobileUA || (width < 768 && isCoarseTouch) || width < 640) {
    return 'phone';
  }

  // If width is medium/tablet range
  if (width >= 640 && width < 1024) {
    return 'tablet';
  }

  // Desktop or TV display
  if (isLargeScreen) {
    return 'tv';
  }

  return 'tv';
}

export function useDeviceDetection(): DeviceDetectionState {
  const [deviceMode, setDeviceModeState] = useState<DeviceMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'phone' || saved === 'tablet' || saved === 'tv' || saved === 'auto') {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'auto';
  });

  const [detectedType, setDetectedType] = useState<DeviceType>(() => detectActualDevice());
  const [dimensions, setDimensions] = useState<{ width: number; height: number; isTouch: boolean }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight : 1080,
    isTouch: typeof window !== 'undefined' ? ('ontouchstart' in window || navigator.maxTouchPoints > 0) : false,
  });

  const handleResize = useCallback(() => {
    if (typeof window === 'undefined') return;
    const actual = detectActualDevice();
    setDetectedType(actual);
    setDimensions({
      width: window.innerWidth,
      height: window.innerHeight,
      isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [handleResize]);

  const setDeviceMode = (mode: DeviceMode) => {
    setDeviceModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  // Resolved effective type
  const effectiveType: DeviceType = deviceMode === 'auto' ? detectedType : deviceMode;

  const orientation: 'portrait' | 'landscape' =
    dimensions.width < dimensions.height ? 'portrait' : 'landscape';

  return {
    deviceType: effectiveType,
    detectedType,
    deviceMode,
    setDeviceMode,
    isPhone: effectiveType === 'phone',
    isTablet: effectiveType === 'tablet',
    isTV: effectiveType === 'tv',
    isTouch: dimensions.isTouch,
    orientation,
    screenWidth: dimensions.width,
    screenHeight: dimensions.height,
  };
}
