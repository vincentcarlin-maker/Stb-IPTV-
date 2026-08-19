import { useEffect, useRef } from 'react';
import { tvNavigation, TVNavMode } from '../services/tvNavigation';
import { useIPTV } from '../context/IPTVContext';

interface UseTVNavigationOptions {
  onBackCustom?: () => boolean;
  onPlayPauseCustom?: () => void;
}

export function useTVNavigation(options?: UseTVNavigationOptions) {
  const {
    activeView,
    setActiveView,
    selectedCategory,
    activeChannel,
    zapNext,
    zapPrev,
    zapToNumber,
    playerSettings,
    updatePlayerSettings,
    isPinModalOpen,
    closePinModal,
  } = useIPTV();

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const currentViewRef = useRef(activeView);
  currentViewRef.current = activeView;

  const currentCategoryRef = useRef(selectedCategory);
  currentCategoryRef.current = selectedCategory;

  // Initialize and bind TV Navigation engine
  useEffect(() => {
    tvNavigation.init({
      getNavMode: () => (playerSettings.tvNavMode || 'auto'),
      onBack: () => {
        // 1. Check custom handler first
        if (optionsRef.current?.onBackCustom) {
          const handled = optionsRef.current.onBackCustom();
          if (handled) return true;
        }

        // 2. If PIN modal is open, close it
        if (isPinModalOpen) {
          closePinModal();
          return true;
        }

        // 3. If in a secondary view, return to Live TV view
        if (currentViewRef.current !== 'live') {
          setActiveView('live');
          setTimeout(() => {
            tvNavigation.restoreViewFocus('live', currentCategoryRef.current);
          }, 100);
          return true;
        }

        return false;
      },
      onPlayPause: () => {
        if (optionsRef.current?.onPlayPauseCustom) {
          optionsRef.current.onPlayPauseCustom();
          return;
        }
        // Fallback: toggle video element directly
        const video = document.querySelector<HTMLVideoElement>('video');
        if (video) {
          if (video.paused) video.play().catch(() => {});
          else video.pause();
        }
      },
      onChannelNext: () => {
        zapNext();
      },
      onChannelPrev: () => {
        zapPrev();
      },
      onNumberInput: (num: number) => {
        zapToNumber(num);
      },
    });

    return () => {
      // tvNavigation.destroy() will be managed globally
    };
  }, [playerSettings.tvNavMode, isPinModalOpen, closePinModal, setActiveView, zapNext, zapPrev, zapToNumber]);

  // Sync navMode when playerSettings change
  useEffect(() => {
    if (playerSettings.tvNavMode) {
      tvNavigation.setNavMode(playerSettings.tvNavMode);
    }
  }, [playerSettings.tvNavMode]);

  // Restore focus automatically when view changes
  useEffect(() => {
    const timer = setTimeout(() => {
      tvNavigation.restoreViewFocus(activeView, selectedCategory);
    }, 150);
    return () => clearTimeout(timer);
  }, [activeView, selectedCategory]);

  return {
    tvNavigation,
    setNavMode: (mode: TVNavMode) => {
      tvNavigation.setNavMode(mode);
      updatePlayerSettings({ tvNavMode: mode });
    },
    focusChannel: (id: string) => tvNavigation.focusChannel(id),
    focusFirstAvailable: () => tvNavigation.focusFirstAvailable(),
  };
}
