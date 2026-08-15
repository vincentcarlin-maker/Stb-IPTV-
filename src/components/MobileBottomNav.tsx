import React, { useState } from 'react';
import {
  Tv,
  CalendarDays,
  Film,
  Heart,
  Menu,
  Server,
  Settings,
  ShieldCheck,
  Radio,
  LayoutGrid,
  X,
  Lock,
  Unlock
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { AppView } from '../types/iptv';

interface MobileBottomNavProps {
  onOpenServerModal: () => void;
  onOpenSettingsModal: () => void;
  onOpenParentalModal: () => void;
  onOpenRemoteModal: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  onOpenServerModal,
  onOpenSettingsModal,
  onOpenParentalModal,
  onOpenRemoteModal,
}) => {
  const {
    activeView,
    setActiveView,
    favorites,
    isSessionUnlocked,
    channels,
  } = useIPTV();

  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState<boolean>(false);

  const mainTabs: { id: AppView; label: string; icon: React.ReactNode; badge?: string | number }[] = [
    {
      id: 'live',
      label: 'Direct TV',
      icon: <Tv className="w-5 h-5" />,
    },
    {
      id: 'epg',
      label: 'Guide',
      icon: <CalendarDays className="w-5 h-5" />,
    },
    {
      id: 'vod',
      label: 'Films / VOD',
      icon: <Film className="w-5 h-5" />,
    },
    {
      id: 'favorites',
      label: 'Favoris',
      icon: <Heart className="w-5 h-5" />,
      badge: favorites.length > 0 ? favorites.length : undefined,
    },
  ];

  return (
    <>
      {/* Slide-up "More / Plus" Sheet for Mobile */}
      {isMoreMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-in fade-in duration-150"
          onClick={() => setIsMoreMenuOpen(false)}
        >
          <div 
            className="w-full bg-slate-950/95 backdrop-blur-2xl border-t border-white/15 rounded-t-3xl p-5 pb-8 shadow-2xl space-y-4 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Handle */}
            <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />

            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="text-sm font-bold text-white">Menu & Outils Mobile</div>
              <button
                onClick={() => setIsMoreMenuOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {/* Virtual Remote */}
              <button
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  onOpenRemoteModal();
                }}
                className="p-3.5 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center gap-3 text-left hover:bg-indigo-500/25 transition active:scale-95"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center text-white shrink-0 shadow-md shadow-indigo-500/30">
                  <Radio className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Télécommande</div>
                  <div className="text-[10px] text-indigo-300">Zapping Virtuel</div>
                </div>
              </button>

              {/* Multi-view */}
              <button
                onClick={() => {
                  setActiveView('multiview');
                  setIsMoreMenuOpen(false);
                }}
                className="p-3.5 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 text-left hover:bg-white/10 transition active:scale-95"
              >
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-slate-300 shrink-0">
                  <LayoutGrid className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Multi-Écrans</div>
                  <div className="text-[10px] text-slate-400">Mode Quad-PIP</div>
                </div>
              </button>

              {/* Series */}
              <button
                onClick={() => {
                  setActiveView('series');
                  setIsMoreMenuOpen(false);
                }}
                className="p-3.5 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 text-left hover:bg-white/10 transition active:scale-95"
              >
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-slate-300 shrink-0">
                  <Film className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Séries TV</div>
                  <div className="text-[10px] text-slate-400">Saisons & Épisodes</div>
                </div>
              </button>

              {/* History */}
              <button
                onClick={() => {
                  setActiveView('history');
                  setIsMoreMenuOpen(false);
                }}
                className="p-3.5 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 text-left hover:bg-white/10 transition active:scale-95"
              >
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-slate-300 shrink-0">
                  <Tv className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Replay & Hist.</div>
                  <div className="text-[10px] text-slate-400">Derniers flux</div>
                </div>
              </button>

              {/* Servers & Portals */}
              <button
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  onOpenServerModal();
                }}
                className="p-3.5 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3 text-left hover:bg-white/10 transition active:scale-95"
              >
                <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-slate-300 shrink-0">
                  <Server className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Portails & MAC</div>
                  <div className="text-[10px] text-slate-400">Stalker / Xtream</div>
                </div>
              </button>

              {/* Parental Control */}
              <button
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  onOpenParentalModal();
                }}
                className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-left hover:bg-red-500/20 transition active:scale-95"
              >
                <div className="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center text-red-400 shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white">Parental (+18)</div>
                  <div className="text-[10px] text-red-300">
                    {isSessionUnlocked ? 'Déverrouillé' : 'Verrouillé'}
                  </div>
                </div>
              </button>
            </div>

            {/* Settings */}
            <button
              onClick={() => {
                setIsMoreMenuOpen(false);
                onOpenSettingsModal();
              }}
              className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-2 text-xs font-bold text-slate-200 transition active:scale-95"
            >
              <Settings className="w-4 h-4 text-slate-400" />
              Tous les Paramètres de l'Application
            </button>
          </div>
        </div>
      )}

      {/* Fixed Bottom Navigation Bar (iOS / Android style) */}
      <nav 
        id="mobile-bottom-nav"
        className="fixed bottom-0 left-0 right-0 z-30 bg-slate-950/90 backdrop-blur-2xl border-t border-white/10 px-2 py-2 flex items-center justify-around select-none shadow-2xl safe-area-pb"
      >
        {mainTabs.map((tab) => {
          const isActive = activeView === tab.id;
          return (
            <button
              key={tab.id}
              id={`mobile-tab-${tab.id}`}
              onClick={() => setActiveView(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center py-1.5 px-1 rounded-2xl relative transition-all active:scale-95 cursor-pointer ${
                isActive
                  ? 'text-indigo-400 font-bold'
                  : 'text-slate-400 hover:text-slate-200 font-medium'
              }`}
            >
              <div className="relative">
                <span className={isActive ? 'text-indigo-400' : 'text-slate-400'}>
                  {tab.icon}
                </span>
                {tab.badge && (
                  <span className="absolute -top-1.5 -right-2.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full shadow-xs">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-1 tracking-tight leading-none whitespace-nowrap">
                {tab.label}
              </span>
              {isActive && (
                <div className="w-3 h-0.5 bg-indigo-500 rounded-full mt-0.5 shadow-sm shadow-indigo-500" />
              )}
            </button>
          );
        })}

        {/* 5th Tab: Plus / More */}
        <button
          id="mobile-tab-more"
          onClick={() => setIsMoreMenuOpen(true)}
          className={`flex-1 flex flex-col items-center justify-center py-1.5 px-1 rounded-2xl relative transition-all active:scale-95 cursor-pointer ${
            isMoreMenuOpen ? 'text-indigo-400 font-bold' : 'text-slate-400 hover:text-slate-200 font-medium'
          }`}
        >
          <Menu className="w-5 h-5" />
          <span className="text-[10px] mt-1 tracking-tight leading-none">Menu</span>
        </button>
      </nav>
    </>
  );
};
