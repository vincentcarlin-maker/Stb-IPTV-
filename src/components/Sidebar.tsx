import React from 'react';
import { 
  Tv, 
  CalendarDays, 
  Film, 
  Clapperboard, 
  Heart, 
  History, 
  ShieldCheck, 
  Server, 
  Settings,
  LayoutGrid,
  Lock,
  Unlock,
  Radio,
  Smartphone,
  Download
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { AppView } from '../types/iptv';

interface SidebarProps {
  onOpenServerModal: () => void;
  onOpenSettingsModal: () => void;
  onOpenParentalModal: () => void;
  onOpenRemoteModal?: () => void;
  onOpenInstallModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  onOpenServerModal,
  onOpenSettingsModal,
  onOpenParentalModal,
  onOpenRemoteModal,
  onOpenInstallModal,
}) => {
  const { 
    activeView, 
    setActiveView, 
    favorites, 
    channels,
    activeServer,
    parentalSettings,
    isSessionUnlocked,
    isPhone,
    isTV,
    setIsVirtualRemoteOpen,
  } = useIPTV();

  const handleNavClick = (view: AppView | 'remote') => {
    if (view === 'remote') {
      if (onOpenRemoteModal) onOpenRemoteModal();
      else setIsVirtualRemoteOpen(true);
      return;
    }
    if (view === 'parental') {
      onOpenParentalModal();
      return;
    }
    if (view === 'servers') {
      onOpenServerModal();
      return;
    }
    if (view === 'settings') {
      onOpenSettingsModal();
      return;
    }
    setActiveView(view as AppView);
  };

  const navItems: { id: AppView; label: string; icon: React.ReactNode; badge?: string | number }[] = [
    {
      id: 'live',
      label: 'Live TV',
      icon: <Tv className="w-5 h-5" />,
      badge: channels.length > 0 ? `${channels.length}` : undefined,
    },
    {
      id: 'epg',
      label: 'Guide TV (EPG)',
      icon: <CalendarDays className="w-5 h-5" />,
    },
    {
      id: 'vod',
      label: 'Films / VOD',
      icon: <Film className="w-5 h-5" />,
    },
    {
      id: 'series',
      label: 'Séries TV',
      icon: <Clapperboard className="w-5 h-5" />,
    },
    {
      id: 'multiview',
      label: 'Multi-Écrans',
      icon: <LayoutGrid className="w-5 h-5" />,
      badge: 'PRO',
    },
    {
      id: 'favorites',
      label: 'Favoris',
      icon: <Heart className="w-5 h-5" />,
      badge: favorites.length > 0 ? `${favorites.length}` : undefined,
    },
    {
      id: 'history',
      label: 'Replay & Historique',
      icon: <History className="w-5 h-5" />,
    },
  ];

  const managementItems: { id: AppView | 'remote'; label: string; icon: React.ReactNode; badge?: string }[] = [
    {
      id: 'remote',
      label: 'Télécommande TV',
      icon: <Radio className="w-5 h-5 text-indigo-400" />,
    },
    {
      id: 'parental',
      label: 'Contrôle Parental',
      icon: <ShieldCheck className="w-5 h-5" />,
      badge: isSessionUnlocked ? 'DÉVERROUILLÉ' : 'VERROUILLÉ',
    },
    {
      id: 'servers',
      label: 'Serveurs & MAC',
      icon: <Server className="w-5 h-5" />,
    },
    {
      id: 'settings',
      label: 'Paramètres',
      icon: <Settings className="w-5 h-5" />,
    },
  ];

  return (
    <aside className="hidden md:flex w-60 lg:w-64 h-full bg-white/[0.04] backdrop-blur-2xl border-r border-white/10 flex-col justify-between shrink-0 select-none z-20">
      {/* Brand Header */}
      <div>
        <div className="p-6 flex items-center gap-3 border-b border-white/10">
          <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Tv className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-bold tracking-tight text-white">iSTB Player</span>
              <span className="text-[10px] font-black px-1.5 py-0.2 rounded-md bg-indigo-500 text-white shadow-xs">
                PRO
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-medium">Stalker & Xtream IPTV</div>
          </div>
        </div>

        {/* Main Navigation */}
        <div className="p-4 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 py-1 mb-1">
            Divertissement
          </div>
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-item-${item.id}`}
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-3 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white/10 rounded-2xl border border-white/10 text-white shadow-lg shadow-indigo-500/5'
                      : 'hover:bg-white/5 rounded-2xl text-slate-300 hover:text-white opacity-75 hover:opacity-100'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <span className={isActive ? 'text-indigo-400' : 'text-slate-400'}>
                      {item.icon}
                    </span>
                    <span className="font-medium">{item.label}</span>
                  </div>
                  {item.badge && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        isActive
                          ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
                          : item.badge === 'PRO'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-white/10 text-slate-300'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Bottom Management Navigation & Frosted Info Cards */}
      <div className="p-4 border-t border-white/10 bg-white/[0.02] space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2">
          Configuration STB
        </div>
        <nav className="space-y-1">
          {managementItems.map((item) => {
            const isParental = item.id === 'parental';
            return (
              <button
                key={item.id}
                id={`nav-item-${item.id}`}
                onClick={() => handleNavClick(item.id)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-white/5 hover:text-white transition cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <span className={isParental ? (isSessionUnlocked ? 'text-amber-400' : 'text-emerald-400') : 'text-slate-400'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono font-bold ${
                      isSessionUnlocked
                        ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Android PWA Install Card */}
        {onOpenInstallModal && (
          <button
            id="sidebar-android-install-btn"
            onClick={onOpenInstallModal}
            className="w-full bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 p-3 rounded-2xl flex items-center justify-between text-left transition cursor-pointer group"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center group-hover:scale-105 transition">
                <Smartphone className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-white">Installer sur Android</div>
                <div className="text-[9px] text-emerald-300/80">Smartphone, Tablette & TV</div>
              </div>
            </div>
            <Download className="w-3.5 h-3.5 text-emerald-400" />
          </button>
        )}

        {/* Frosted Parental Control Warning Box */}
        <div 
          onClick={onOpenParentalModal}
          className="bg-red-500/10 border border-red-500/20 p-3.5 rounded-2xl flex flex-col gap-1.5 cursor-pointer hover:bg-red-500/15 transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider">Contrôle Parental</span>
            {isSessionUnlocked ? <Unlock className="w-3.5 h-3.5 text-amber-400" /> : <Lock className="w-3.5 h-3.5 text-red-400" />}
          </div>
          <p className="text-[10px] text-red-300/80 leading-tight">
            {isSessionUnlocked ? 'Session déverrouillée (30 min)' : 'Contenus +18 protégés par code PIN'}
          </p>
        </div>

        {/* Frosted MAC Status Card */}
        <div className="flex items-center justify-between px-3 py-2.5 bg-white/5 border border-white/10 rounded-2xl">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-xs shadow-emerald-400/50" />
            <span className="text-[11px] font-mono text-slate-300 uppercase tracking-tight">
              MAC: {activeServer?.macAddress || '00:1A:79:42:0B:C4'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};
