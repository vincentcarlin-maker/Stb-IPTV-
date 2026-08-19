import React, { useState, useEffect } from 'react';
import { 
  Tv, 
  Search, 
  Lock, 
  Unlock, 
  Server, 
  Maximize, 
  Minimize, 
  Clock, 
  SlidersHorizontal,
  ChevronDown,
  Sparkles,
  Radio,
  Smartphone,
  Tablet
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { DeviceModeSelector } from './DeviceModeSelector';
import { isFullscreen as checkIsFullscreen, safeToggleFullscreen } from '../utils/fullscreen';

interface HeaderProps {
  onOpenServerModal: () => void;
  onOpenSettingsModal: () => void;
  onOpenParentalModal: () => void;
  onOpenRemoteModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenServerModal,
  onOpenSettingsModal,
  onOpenParentalModal,
  onOpenRemoteModal,
}) => {
  const {
    activeServer,
    servers,
    setActiveServerId,
    searchQuery,
    setSearchQuery,
    activeChannel,
    isSessionUnlocked,
    lockSession,
    requestPinForAction,
    activeView,
    isTV,
    isPhone,
    isTablet,
    setIsVirtualRemoteOpen,
  } = useIPTV();

  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isServerDropdownOpen, setIsServerDropdownOpen] = useState<boolean>(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState<boolean>(false);

  // Live clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
      setCurrentDate(
        now.toLocaleDateString('fr-FR', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

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

  const toggleFullscreen = async () => {
    const newState = await safeToggleFullscreen();
    setIsFullscreen(newState);
  };

  const handleParentalClick = () => {
    if (isSessionUnlocked) {
      lockSession();
    } else {
      requestPinForAction(() => {}, 'Déverrouiller le Contrôle Parental');
    }
  };

  return (
    <header className="h-14 sm:h-16 md:h-18 bg-white/[0.03] backdrop-blur-2xl border-b border-white/10 px-3 sm:px-4 md:px-6 flex items-center justify-between z-30 sticky top-0 select-none">
      {/* Left: Active Server & Portal Status */}
      <div className="flex items-center gap-2 md:gap-4 truncate">
        <div className="relative">
          <button
            id="server-dropdown-btn"
            onClick={() => setIsServerDropdownOpen(!isServerDropdownOpen)}
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-slate-200 transition-all shadow-sm cursor-pointer"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-xs shadow-emerald-400/50 shrink-0" />
            <Server className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="font-semibold text-white max-w-[90px] sm:max-w-[150px] md:max-w-[200px] truncate text-[11px] sm:text-xs">
              {activeServer ? activeServer.name : 'Serveur'}
            </span>
            {activeServer?.macAddress && (
              <span className="hidden 2xl:inline text-[10px] font-mono text-slate-300 bg-white/10 px-2 py-0.5 rounded-full border border-white/10">
                {activeServer.macAddress}
              </span>
            )}
            <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
          </button>

          {/* Frosted Glass Server Dropdown */}
          {isServerDropdownOpen && (
            <div 
              className="absolute left-0 mt-2 w-72 sm:w-80 bg-slate-950/90 backdrop-blur-3xl border border-white/15 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150"
              onMouseLeave={() => setIsServerDropdownOpen(false)}
            >
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-white/10 flex items-center justify-between">
                <span>Portails & Serveurs IPTV</span>
                <span className="text-[10px] font-mono text-indigo-400">{servers.length} profil(s)</span>
              </div>
              <div className="max-h-60 overflow-y-auto py-1 space-y-1">
                {servers.map((srv) => (
                  <button
                    key={srv.id}
                    id={`select-server-${srv.id}`}
                    onClick={() => {
                      setActiveServerId(srv.id);
                      setIsServerDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between transition ${
                      activeServer?.id === srv.id
                        ? 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 font-semibold'
                        : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    <div className="truncate">
                      <div className="text-xs truncate font-medium text-white">{srv.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {srv.type.toUpperCase()} {srv.macAddress ? `• ${srv.macAddress}` : ''}
                      </div>
                    </div>
                    {activeServer?.id === srv.id && (
                      <span className="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded-full font-mono font-bold shadow-xs">
                        ACTIF
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="p-2 border-t border-white/10 mt-1">
                <button
                  id="add-manage-servers-btn"
                  onClick={() => {
                    setIsServerDropdownOpen(false);
                    onOpenServerModal();
                  }}
                  className="w-full py-2 px-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition"
                >
                  <Server className="w-3.5 h-3.5" />
                  Gérer les serveurs & MAC
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Live Channel Quick Pill (Hidden on tiny phone screen) */}
        {activeChannel && activeView === 'live' && (
          <div className="hidden xl:flex items-center gap-2.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-xs truncate">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-xs shadow-red-500/50 shrink-0" />
            <span className="text-slate-400 text-[11px]">En direct:</span>
            <span className="font-semibold text-white truncate max-w-[140px]">
              {activeChannel.number}. {activeChannel.name}
            </span>
            {activeChannel.resolution && (
              <span className="px-1.5 py-0.2 text-[9px] font-bold bg-indigo-500/20 text-indigo-300 rounded-md border border-indigo-500/30 shrink-0">
                {activeChannel.resolution}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Center: Frosted Glass Search Bar */}
      <div className="flex-1 max-w-md mx-3 md:mx-6 hidden md:block">
        <div className="relative bg-white/5 border border-white/10 rounded-full px-4 py-2 flex items-center gap-2.5 transition-all focus-within:border-indigo-400/60 focus-within:bg-white/10 focus-within:shadow-lg focus-within:shadow-indigo-500/10">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            id="global-search-input"
            type="text"
            placeholder="Rechercher une chaîne, un film, une catégorie..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent border-none outline-none text-xs text-white placeholder-slate-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-slate-400 hover:text-white text-xs font-bold px-1 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Right Controls (Frosted Glass Buttons) */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Device Format Adaptive Selector (Phone / Tablet / TV) */}
        <DeviceModeSelector compact={isPhone} />

        {/* Virtual Remote Control Trigger (Hidden on phones as it is in bottom nav) */}
        {!isPhone && (
          <button
            id="open-virtual-remote-btn"
            onClick={() => {
              if (onOpenRemoteModal) onOpenRemoteModal();
              else setIsVirtualRemoteOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-xs font-semibold transition active:scale-95 cursor-pointer shadow-sm"
            title="Ouvrir la Télécommande Virtuelle (Contrôle MAG & TV)"
          >
            <Radio className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden lg:inline">Télécommande</span>
          </button>
        )}

        {/* Parental Control Lock Button (Hidden on phones as it is in bottom menu) */}
        {!isPhone && (
          <button
            id="parental-control-toggle-btn"
            onClick={handleParentalClick}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-full border text-xs font-semibold transition-all cursor-pointer ${
              isSessionUnlocked
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20'
            }`}
            title={isSessionUnlocked ? 'Session déverrouillée (Cliquer pour verrouiller)' : 'Contrôle parental actif (+18 protégé)'}
          >
            {isSessionUnlocked ? (
              <>
                <Unlock className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden xl:inline">Déverrouillé</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 text-red-400" />
                <span className="hidden xl:inline">+18</span>
              </>
            )}
          </button>
        )}

        {/* Live Clock */}
        <div className="hidden lg:flex flex-col items-end px-3 py-1.5 bg-white/5 border border-white/10 rounded-2xl text-right">
          <div className="flex items-center gap-1.5 text-xs font-bold font-mono text-indigo-300">
            <Clock className="w-3 h-3 text-slate-400" />
            {currentTime}
          </div>
          <div className="text-[10px] text-slate-400 capitalize">{currentDate}</div>
        </div>

        {/* Fullscreen Button */}
        <button
          id="fullscreen-toggle-btn"
          onClick={toggleFullscreen}
          className="w-8 h-8 sm:w-9 sm:h-9 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center border border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
          title="Plein écran (F)"
        >
          {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
        </button>

        {/* Settings button */}
        <button
          id="header-settings-btn"
          onClick={onOpenSettingsModal}
          className="w-8 h-8 sm:w-9 sm:h-9 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center border border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
          title="Paramètres iSTB & Format"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};

