import React from 'react';
import {
  Power,
  Tv,
  CalendarDays,
  Film,
  Volume2,
  VolumeX,
  Volume1,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  RotateCcw,
  SlidersHorizontal,
  Server,
  Heart,
  X,
  Radio,
  Sparkles
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';

interface VirtualRemoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenServerModal: () => void;
  onOpenSettingsModal: () => void;
}

export const VirtualRemoteModal: React.FC<VirtualRemoteModalProps> = ({
  isOpen,
  onClose,
  onOpenServerModal,
  onOpenSettingsModal,
}) => {
  const {
    activeChannel,
    zapNext,
    zapPrev,
    zapToNumber,
    setActiveView,
    activeView,
    playerSettings,
    updatePlayerSettings,
    isSessionUnlocked,
    requestPinForAction,
    lockSession,
  } = useIPTV();

  if (!isOpen) return null;

  const handleNumClick = (digit: number) => {
    zapToNumber(digit);
  };

  const toggleMute = () => {
    updatePlayerSettings({ muted: !playerSettings.muted });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-xs bg-slate-950/90 backdrop-blur-2xl border border-white/15 rounded-3xl shadow-2xl p-5 text-white flex flex-col items-center select-none animate-in zoom-in-95 duration-150">
        {/* Remote Header */}
        <div className="w-full flex items-center justify-between border-b border-white/10 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-500 flex items-center justify-center shadow-md shadow-indigo-500/30">
              <Tv className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <div className="text-xs font-bold tracking-tight">Télécommande iSTB</div>
              <div className="text-[9px] text-slate-400 font-mono">MAG & Android TV</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top Control Bar: Power, Mute, Source */}
        <div className="w-full grid grid-cols-3 gap-2 mb-4">
          <button
            onClick={() => {
              if (activeChannel) {
                // toggle play / live
                setActiveView('live');
              }
            }}
            className="py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 flex flex-col items-center justify-center gap-1 transition active:scale-95"
            title="Alimentation / Direct"
          >
            <Power className="w-4 h-4" />
            <span className="text-[9px] font-bold">POWER</span>
          </button>

          <button
            onClick={toggleMute}
            className={`py-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition active:scale-95 ${
              playerSettings.muted
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 border-white/10'
            }`}
            title="Muet"
          >
            {playerSettings.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            <span className="text-[9px] font-bold">MUTE</span>
          </button>

          <button
            onClick={() => {
              onClose();
              onOpenServerModal();
            }}
            className="py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 flex flex-col items-center justify-center gap-1 transition active:scale-95"
            title="Serveurs & Portails"
          >
            <Server className="w-4 h-4 text-indigo-400" />
            <span className="text-[9px] font-bold">PORTAIL</span>
          </button>
        </div>

        {/* D-Pad Navigation Circle */}
        <div className="relative w-44 h-44 rounded-full bg-slate-900/90 border-2 border-white/15 p-2 shadow-inner flex items-center justify-center mb-4">
          {/* UP: Zap Next Channel */}
          <button
            onClick={zapPrev}
            className="absolute top-2 w-14 h-10 rounded-t-full bg-white/5 hover:bg-indigo-500/30 border-b border-transparent hover:border-indigo-400 text-slate-300 hover:text-white flex items-center justify-center transition active:scale-95"
            title="Chaîne Précédente (CH-)"
          >
            <ChevronUp className="w-5 h-5" />
          </button>

          {/* DOWN: Zap Next Channel */}
          <button
            onClick={zapNext}
            className="absolute bottom-2 w-14 h-10 rounded-b-full bg-white/5 hover:bg-indigo-500/30 border-t border-transparent hover:border-indigo-400 text-slate-300 hover:text-white flex items-center justify-center transition active:scale-95"
            title="Chaîne Suivante (CH+)"
          >
            <ChevronDown className="w-5 h-5" />
          </button>

          {/* LEFT */}
          <button
            onClick={() => {
              if (activeView !== 'live') setActiveView('live');
              else zapPrev();
            }}
            className="absolute left-2 w-10 h-14 rounded-l-full bg-white/5 hover:bg-indigo-500/30 border-r border-transparent hover:border-indigo-400 text-slate-300 hover:text-white flex items-center justify-center transition active:scale-95"
            title="Gauche / Précédent"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          {/* RIGHT */}
          <button
            onClick={() => {
              if (activeView !== 'live') setActiveView('live');
              else zapNext();
            }}
            className="absolute right-2 w-10 h-14 rounded-r-full bg-white/5 hover:bg-indigo-500/30 border-l border-transparent hover:border-indigo-400 text-slate-300 hover:text-white flex items-center justify-center transition active:scale-95"
            title="Droite / Suivant"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          {/* CENTER OK BUTTON */}
          <button
            onClick={() => {
              setActiveView('live');
            }}
            className="w-16 h-16 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-sm flex items-center justify-center shadow-lg shadow-indigo-600/40 border border-indigo-300/40 transition active:scale-90"
            title="OK / Sélectionner"
          >
            OK
          </button>
        </div>

        {/* Quick Media / Channel / Volume Rockers */}
        <div className="w-full grid grid-cols-2 gap-3 mb-4">
          {/* VOL +/- */}
          <div className="flex flex-col items-center bg-white/5 border border-white/10 rounded-2xl p-1.5">
            <span className="text-[9px] font-bold text-slate-400 mb-1">VOL</span>
            <div className="flex w-full gap-1">
              <button
                onClick={() => {
                  const newVol = Math.max(0, playerSettings.audioVolume - 10);
                  updatePlayerSettings({ audioVolume: newVol, muted: false });
                }}
                className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/15 text-slate-200 text-xs font-bold flex items-center justify-center active:scale-95 transition"
              >
                -
              </button>
              <button
                onClick={() => {
                  const newVol = Math.min(100, playerSettings.audioVolume + 10);
                  updatePlayerSettings({ audioVolume: newVol, muted: false });
                }}
                className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/15 text-slate-200 text-xs font-bold flex items-center justify-center active:scale-95 transition"
              >
                +
              </button>
            </div>
          </div>

          {/* CH +/- */}
          <div className="flex flex-col items-center bg-white/5 border border-white/10 rounded-2xl p-1.5">
            <span className="text-[9px] font-bold text-indigo-300 mb-1">CHAÎNE</span>
            <div className="flex w-full gap-1">
              <button
                onClick={zapPrev}
                className="flex-1 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 text-xs font-bold flex items-center justify-center active:scale-95 transition"
              >
                CH-
              </button>
              <button
                onClick={zapNext}
                className="flex-1 py-2 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 text-xs font-bold flex items-center justify-center active:scale-95 transition"
              >
                CH+
              </button>
            </div>
          </div>
        </div>

        {/* Color Buttons (Classic STB/MAG keys) */}
        <div className="w-full grid grid-cols-4 gap-2 mb-4">
          <button
            onClick={() => {
              onClose();
              onOpenServerModal();
            }}
            className="py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-[9px] shadow-sm transition active:scale-95"
            title="Rouge : Serveurs"
          >
            PORTAIL
          </button>
          <button
            onClick={() => {
              setActiveView('epg');
              onClose();
            }}
            className="py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[9px] shadow-sm transition active:scale-95"
            title="Vert : Guide EPG"
          >
            GUIDE
          </button>
          <button
            onClick={() => {
              setActiveView('vod');
              onClose();
            }}
            className="py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-[9px] shadow-sm transition active:scale-95"
            title="Jaune : Films VOD"
          >
            VOD
          </button>
          <button
            onClick={() => {
              onClose();
              onOpenSettingsModal();
            }}
            className="py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[9px] shadow-sm transition active:scale-95"
            title="Bleu : Paramètres"
          >
            RÉGLAGES
          </button>
        </div>

        {/* Numeric Keypad 0-9 */}
        <div className="w-full bg-white/[0.03] border border-white/10 rounded-2xl p-2">
          <div className="grid grid-cols-3 gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                onClick={() => handleNumClick(num)}
                className="py-2.5 rounded-xl bg-white/5 hover:bg-white/15 text-white font-mono font-bold text-xs flex items-center justify-center transition active:scale-90"
              >
                {num}
              </button>
            ))}
            <button
              onClick={() => {
                setActiveView('favorites');
                onClose();
              }}
              className="py-2.5 rounded-xl bg-white/5 hover:bg-white/15 text-red-400 font-bold text-xs flex items-center justify-center transition active:scale-90"
              title="Favoris"
            >
              <Heart className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleNumClick(0)}
              className="py-2.5 rounded-xl bg-white/5 hover:bg-white/15 text-white font-mono font-bold text-xs flex items-center justify-center transition active:scale-90"
            >
              0
            </button>
            <button
              onClick={() => {
                setActiveView('history');
                onClose();
              }}
              className="py-2.5 rounded-xl bg-white/5 hover:bg-white/15 text-indigo-300 font-bold text-xs flex items-center justify-center transition active:scale-90"
              title="Replay"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
