import React, { useRef, useEffect } from 'react';
import { 
  Captions, 
  Scan, 
  Crop, 
  Music, 
  SlidersHorizontal, 
  LayoutGrid, 
  Smartphone, 
  ExternalLink, 
  CalendarDays, 
  Smile, 
  Circle, 
  Film, 
  Info 
} from 'lucide-react';

interface PlayerQuickMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenMediaDetails: () => void;
  onToggleSubtitles: () => void;
  subtitlesActive: boolean;
  onCycleAspectRatio: () => void;
  aspectRatio: string;
  onToggleCrop: () => void;
  cropActive: boolean;
  onCycleAudio: () => void;
  onCycleFilter: () => void;
  activeFilterName: string;
  onOpenMultiView: () => void;
  onToggleFullscreen: () => void;
  onTogglePiP: () => void;
  onOpenEPG: () => void;
  onOpenParentalControl: () => void;
  onCycleSleepTimer: () => void;
  sleepTimerLabel: string;
  onOpenVOD: () => void;
}

export const PlayerQuickMenu: React.FC<PlayerQuickMenuProps> = ({
  isOpen,
  onClose,
  onOpenMediaDetails,
  onToggleSubtitles,
  subtitlesActive,
  onCycleAspectRatio,
  aspectRatio,
  onToggleCrop,
  cropActive,
  onCycleAudio,
  onCycleFilter,
  activeFilterName,
  onOpenMultiView,
  onToggleFullscreen,
  onTogglePiP,
  onOpenEPG,
  onOpenParentalControl,
  onCycleSleepTimer,
  sleepTimerLabel,
  onOpenVOD,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="absolute bottom-20 right-3 sm:right-6 z-40 bg-[#1c1c1e]/95 backdrop-blur-2xl border border-white/15 rounded-3xl p-4 shadow-2xl animate-in zoom-in-95 fade-in duration-150 select-none w-72 sm:w-80 pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Downward triangle pointer pointing to ... button */}
      <div className="absolute -bottom-2 right-8 w-4 h-4 bg-[#1c1c1e]/95 rotate-45 border-r border-b border-white/15" />

      {/* 4x3 Icon Buttons Grid */}
      <div className="grid grid-cols-4 gap-2.5 pb-3">
        {/* 1. Subtitles [CC] */}
        <button
          type="button"
          onClick={() => {
            onToggleSubtitles();
          }}
          title="Sous-titres (CC)"
          className={`h-13 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer ${
            subtitlesActive
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 border border-indigo-400'
              : 'bg-white/5 hover:bg-white/15 text-white border border-white/10'
          }`}
        >
          <Captions className="w-5 h-5" />
          <span className="text-[9px] font-bold">CC</span>
        </button>

        {/* 2. Aspect ratio fit [Scan] */}
        <button
          type="button"
          onClick={onCycleAspectRatio}
          title="Format d'écran"
          className="h-13 rounded-2xl flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/15 text-white border border-white/10 transition-all active:scale-95 cursor-pointer"
        >
          <Scan className="w-5 h-5" />
          <span className="text-[9px] font-bold uppercase">{aspectRatio}</span>
        </button>

        {/* 3. Crop / Zoom [Crop] */}
        <button
          type="button"
          onClick={onToggleCrop}
          title="Recadrage / Zoom"
          className={`h-13 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer ${
            cropActive
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 border border-indigo-400'
              : 'bg-white/5 hover:bg-white/15 text-white border border-white/10'
          }`}
        >
          <Crop className="w-5 h-5" />
          <span className="text-[9px] font-bold">Crop</span>
        </button>

        {/* 4. Audio tracks [Music] */}
        <button
          type="button"
          onClick={onCycleAudio}
          title="Pistes Audio"
          className="h-13 rounded-2xl flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/15 text-white border border-white/10 transition-all active:scale-95 cursor-pointer"
        >
          <Music className="w-5 h-5" />
          <span className="text-[9px] font-bold">Audio</span>
        </button>

        {/* 5. Video filters [Filter / Sliders] */}
        <button
          type="button"
          onClick={onCycleFilter}
          title={`Filtre vidéo: ${activeFilterName}`}
          className="h-13 rounded-2xl flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/15 text-white border border-white/10 transition-all active:scale-95 cursor-pointer"
        >
          <SlidersHorizontal className="w-5 h-5" />
          <span className="text-[9px] font-bold truncate max-w-[50px]">{activeFilterName}</span>
        </button>

        {/* 6. MultiView [LayoutGrid] */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenMultiView();
          }}
          title="Multi-Écran (4 Chaînes)"
          className="h-13 rounded-2xl flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/15 text-white border border-white/10 transition-all active:scale-95 cursor-pointer"
        >
          <LayoutGrid className="w-5 h-5" />
          <span className="text-[9px] font-bold">Multi</span>
        </button>

        {/* 7. Orientation / Rotate [Smartphone] */}
        <button
          type="button"
          onClick={onToggleFullscreen}
          title="Orientation / Plein Écran"
          className="h-13 rounded-2xl flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/15 text-white border border-white/10 transition-all active:scale-95 cursor-pointer"
        >
          <Smartphone className="w-5 h-5" />
          <span className="text-[9px] font-bold">Rotate</span>
        </button>

        {/* 8. Picture in Picture [ExternalLink] */}
        <button
          type="button"
          onClick={onTogglePiP}
          title="Picture-in-Picture"
          className="h-13 rounded-2xl flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/15 text-white border border-white/10 transition-all active:scale-95 cursor-pointer"
        >
          <ExternalLink className="w-5 h-5" />
          <span className="text-[9px] font-bold">PiP</span>
        </button>

        {/* 9. Guide TV EPG [CalendarDays] */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenEPG();
          }}
          title="Guide TV (EPG)"
          className="h-13 rounded-2xl flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/15 text-amber-300 border border-white/10 transition-all active:scale-95 cursor-pointer"
        >
          <CalendarDays className="w-5 h-5 text-amber-400" />
          <span className="text-[9px] font-bold text-white">EPG</span>
        </button>

        {/* 10. Parental Control [Smile] */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenParentalControl();
          }}
          title="Contrôle Parental"
          className="h-13 rounded-2xl flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/15 text-green-300 border border-white/10 transition-all active:scale-95 cursor-pointer"
        >
          <Smile className="w-5 h-5 text-green-400" />
          <span className="text-[9px] font-bold text-white">Parent</span>
        </button>

        {/* 11. Sleep timer [Circle] */}
        <button
          type="button"
          onClick={onCycleSleepTimer}
          title="Minuteur de veille"
          className="h-13 rounded-2xl flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/15 text-red-300 border border-white/10 transition-all active:scale-95 cursor-pointer"
        >
          <Circle className="w-5 h-5 text-red-400" />
          <span className="text-[9px] font-bold text-white truncate max-w-[50px]">{sleepTimerLabel}</span>
        </button>

        {/* 12. VOD & Replay [Film] */}
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenVOD();
          }}
          title="VOD & Films"
          className="h-13 rounded-2xl flex flex-col items-center justify-center gap-1 bg-white/5 hover:bg-white/15 text-indigo-300 border border-white/10 transition-all active:scale-95 cursor-pointer"
        >
          <Film className="w-5 h-5 text-indigo-400" />
          <span className="text-[9px] font-bold text-white">VOD</span>
        </button>
      </div>

      {/* Row 4: Centered "Détails du média" (Info button) */}
      <div className="pt-2.5 border-t border-white/10 flex justify-center">
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenMediaDetails();
          }}
          title="Afficher les détails du média"
          className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-sm border border-white/10"
        >
          <Info className="w-4 h-4 text-indigo-400" />
          <span>Détails du média</span>
        </button>
      </div>
    </div>
  );
};
