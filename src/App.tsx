import React, { useState } from 'react';
import { IPTVProvider, useIPTV } from './context/IPTVContext';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LivePlayer } from './components/LivePlayer';
import { EPGGuide } from './components/EPGGuide';
import { ChannelList } from './components/ChannelList';
import { VODSection } from './components/VODSection';
import { MultiView } from './components/MultiView';
import { HistorySection } from './components/HistorySection';
import { ParentalModal } from './components/ParentalModal';
import { ServerManagerModal } from './components/ServerManagerModal';
import { ServerProgressModal } from './components/ServerProgressModal';
import { SettingsModal } from './components/SettingsModal';
import { VirtualRemoteModal } from './components/VirtualRemoteModal';
import { AndroidInstallModal } from './components/AndroidInstallModal';
import { MobileBottomNav } from './components/MobileBottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Tv, Radio, ListFilter, X } from 'lucide-react';

function MainApp() {
  const { 
    activeView, 
    setActiveView,
    isPinModalOpen, 
    closePinModal, 
    activeChannel,
    setActiveChannel,
    deviceType,
    isPhone,
    isTablet,
    isTV,
    isVirtualRemoteOpen,
    setIsVirtualRemoteOpen,
    tuningNumber,
  } = useIPTV();

  const [isServerModalOpen, setIsServerModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isParentalManageOpen, setIsParentalManageOpen] = useState<boolean>(false);
  const [isAndroidInstallModalOpen, setIsAndroidInstallModalOpen] = useState<boolean>(false);
  const [isChannelSidebarOpen, setIsChannelSidebarOpen] = useState<boolean>(true);
  const [isMobileChannelDrawerOpen, setIsMobileChannelDrawerOpen] = useState<boolean>(false);

  return (
    <div 
      className={`flex h-screen w-screen overflow-hidden bg-[#020617] text-slate-100 font-sans antialiased relative selection:bg-indigo-500/30 ${
        isTV ? 'tv-device-layout scale-100 text-base' : ''
      }`}
    >
      {/* Ambient Frosted Glass Background Orbs */}
      <div className="fixed top-[-12%] left-[-10%] w-[55%] h-[55%] bg-indigo-600/20 rounded-full blur-[140px] pointer-events-none z-0" />
      <div className="fixed bottom-[-12%] right-[-10%] w-[55%] h-[55%] bg-purple-600/20 rounded-full blur-[140px] pointer-events-none z-0" />
      <div className="fixed top-[35%] right-[25%] w-[35%] h-[35%] bg-sky-500/10 rounded-full blur-[120px] pointer-events-none z-0" />

      {/* Left Sidebar Navigation (Frosted Glass - Hidden on Mobile Phones) */}
      {!isPhone && (
        <Sidebar
          onOpenServerModal={() => setIsServerModalOpen(true)}
          onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
          onOpenParentalModal={() => setIsParentalManageOpen(true)}
          onOpenRemoteModal={() => setIsVirtualRemoteOpen(true)}
          onOpenInstallModal={() => setIsAndroidInstallModalOpen(true)}
        />
      )}

      {/* Main App Container */}
      <div className={`flex-1 flex flex-col h-full overflow-hidden relative z-10 ${isPhone ? 'pb-16' : ''}`}>
        {/* Top Header */}
        <Header
          onOpenServerModal={() => setIsServerModalOpen(true)}
          onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
          onOpenParentalModal={() => setIsParentalManageOpen(true)}
          onOpenRemoteModal={() => setIsVirtualRemoteOpen(true)}
          onOpenInstallModal={() => setIsAndroidInstallModalOpen(true)}
        />

        {/* Dynamic View Canvas */}
        <main className="flex-1 flex overflow-hidden relative">
          {/* VIEW: LIVE TV & EPG OVERLAY */}
          {(activeView === 'live' || activeView === 'epg') && (
            <div className="flex-1 flex h-full w-full overflow-hidden relative">
              {/* Collapsible Channels Sidebar (Hidden on Mobile or when in EPG view) */}
              {activeView === 'live' && isChannelSidebarOpen && !isPhone && (
                <div className="w-72 lg:w-80 shrink-0 h-full border-r border-white/10 bg-slate-950/90 backdrop-blur-2xl z-20">
                  <ChannelList />
                </div>
              )}

              {/* Main Live Video Player (Kept active in background when guide is open) */}
              <div className="flex-1 h-full flex flex-col bg-black/60 relative overflow-hidden">
                <LivePlayer
                  showChannelListToggle={() => {
                    if (isPhone) {
                      setIsMobileChannelDrawerOpen(true);
                    } else {
                      setIsChannelSidebarOpen((prev) => !prev);
                    }
                  }}
                  onOpenEPGModal={() => {}}
                />
              </div>

              {/* EPG Guide Transparent Overlay over Live Video */}
              {activeView === 'epg' && (
                <div className="absolute inset-0 z-30 bg-slate-950/70 sm:bg-slate-950/55 backdrop-blur-md flex flex-col overflow-hidden animate-in fade-in duration-200">
                  <EPGGuide />
                </div>
              )}

              {/* Sliding Channel Drawer for Mobile / Narrow windows */}
              {activeView === 'live' && isMobileChannelDrawerOpen && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex flex-col justify-end">
                  <div className="w-full h-[85vh] bg-slate-950/95 border-t border-white/15 rounded-t-3xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200">
                    <div className="p-4 border-b border-white/10 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-indigo-500 flex items-center justify-center text-white font-bold">
                          <Tv className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white">Sélection des Chaînes</div>
                          <div className="text-[10px] text-slate-400">Toucher pour zapper instantanément</div>
                        </div>
                      </div>
                      <button
                        onClick={() => setIsMobileChannelDrawerOpen(false)}
                        className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-slate-300 active:scale-95"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <ChannelList 
                        onSelectChannel={(ch) => {
                          if (ch) setActiveChannel(ch);
                          setIsMobileChannelDrawerOpen(false);
                        }} 
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW: VOD MOVIES */}
          {activeView === 'vod' && <VODSection type="vod" />}

          {/* VIEW: TV SERIES */}
          {activeView === 'series' && <VODSection type="series" />}

          {/* VIEW: MULTI-VIEW */}
          {activeView === 'multiview' && <MultiView />}

          {/* VIEW: FAVORITES */}
          {activeView === 'favorites' && (
            <div className="flex-1 flex h-full w-full">
              <div className="w-72 lg:w-80 shrink-0 h-full hidden md:block border-r border-white/10 bg-white/[0.02] backdrop-blur-2xl">
                <ChannelList />
              </div>
              <div className="flex-1 h-full flex flex-col bg-black/60">
                <LivePlayer />
              </div>
            </div>
          )}

          {/* VIEW: HISTORY / REPLAY */}
          {activeView === 'history' && <HistorySection />}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Phone Mode) */}
      {isPhone && (
        <MobileBottomNav
          onOpenServerModal={() => setIsServerModalOpen(true)}
          onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
          onOpenParentalModal={() => setIsParentalManageOpen(true)}
          onOpenRemoteModal={() => setIsVirtualRemoteOpen(true)}
          onOpenInstallModal={() => setIsAndroidInstallModalOpen(true)}
        />
      )}

      {/* TV Direct Channel Tuning Banner (when user types digits on remote / keyboard) */}
      {tuningNumber && (
        <div className="fixed top-10 right-10 z-50 bg-slate-950/90 border-2 border-indigo-500 text-indigo-300 px-6 py-4 rounded-3xl shadow-2xl backdrop-blur-3xl flex items-center gap-4 animate-in zoom-in-95 duration-100">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Tv className="w-7 h-7" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Zapping Direct</div>
            <div className="text-4xl font-extrabold font-mono text-white tracking-widest">
              CANAL {tuningNumber}
            </div>
          </div>
        </div>
      )}

      {/* Floating Virtual Remote Toggle for TV Mode */}
      {isTV && !isVirtualRemoteOpen && (
        <button
          id="tv-floating-remote-pill"
          onClick={() => setIsVirtualRemoteOpen(true)}
          className="fixed bottom-6 right-6 z-40 bg-indigo-600/90 hover:bg-indigo-500 text-white px-5 py-3 rounded-full shadow-2xl backdrop-blur-2xl border border-white/20 flex items-center gap-3 text-xs font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer"
        >
          <Radio className="w-4 h-4 animate-pulse" />
          <span>Télécommande iSTB</span>
          <span className="text-[10px] bg-black/30 px-2 py-0.5 rounded-full font-mono">D-Pad</span>
        </button>
      )}

      {/* Global Modals */}
      {/* 1. Virtual Remote Control Modal (TV & STB MAG style) */}
      <VirtualRemoteModal
        isOpen={isVirtualRemoteOpen}
        onClose={() => setIsVirtualRemoteOpen(false)}
        onOpenServerModal={() => setIsServerModalOpen(true)}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
      />

      {/* 2. Parental PIN Verification & Management */}
      <ParentalModal
        isOpen={isPinModalOpen || isParentalManageOpen}
        onClose={() => {
          closePinModal();
          setIsParentalManageOpen(false);
        }}
        mode={isParentalManageOpen ? 'manage' : 'verify'}
      />

      {/* 3. Server & MAC Address Portal Manager */}
      <ServerManagerModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
      />

      {/* 3b. Server Loading & Synchronization Progress Modal */}
      <ServerProgressModal
        isOpen={false}
        onClose={() => {}}
        onOpenServerManager={() => setIsServerModalOpen(true)}
      />

      {/* 4. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onOpenParentalModal={() => setIsParentalManageOpen(true)}
        onOpenInstallModal={() => setIsAndroidInstallModalOpen(true)}
      />

      {/* 5. Android & PWA Installation Modal */}
      <AndroidInstallModal
        isOpen={isAndroidInstallModalOpen}
        onClose={() => setIsAndroidInstallModalOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <IPTVProvider>
        <MainApp />
      </IPTVProvider>
    </ErrorBoundary>
  );
}

