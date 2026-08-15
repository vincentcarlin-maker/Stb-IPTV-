import React, { useState } from 'react';
import { 
  Smartphone, 
  Tablet, 
  Tv, 
  Cpu, 
  ChevronDown, 
  Check, 
  Radio, 
  Sparkles,
  Info
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { DeviceMode, DeviceType } from '../types/iptv';

interface DeviceModeSelectorProps {
  compact?: boolean;
}

export const DeviceModeSelector: React.FC<DeviceModeSelectorProps> = ({ compact = false }) => {
  const {
    deviceType,
    detectedType,
    deviceMode,
    setDeviceMode,
    isTV,
    isPhone,
    isTablet,
  } = useIPTV();

  const [isOpen, setIsOpen] = useState<boolean>(false);

  const modes: {
    id: DeviceMode;
    label: string;
    description: string;
    icon: React.ReactNode;
    badge?: string;
  }[] = [
    {
      id: 'auto',
      label: 'Détection Auto',
      description: `Adaptation dynamique (${detectedType === 'tv' ? 'Smart TV' : detectedType === 'tablet' ? 'Tablette' : 'Téléphone'} détecté)`,
      icon: <Cpu className="w-4 h-4 text-sky-400" />,
      badge: 'RECOMMANDÉ',
    },
    {
      id: 'phone',
      label: 'Téléphone (Mobile)',
      description: 'Navigation tactile basse, OSD compact & gestes swipe',
      icon: <Smartphone className="w-4 h-4 text-emerald-400" />,
    },
    {
      id: 'tablet',
      label: 'Tablette (iPad / Android)',
      description: 'Format hybride split-view avec volets tactiles',
      icon: <Tablet className="w-4 h-4 text-amber-400" />,
    },
    {
      id: 'tv',
      label: 'Smart TV & Grand Écran',
      description: 'Interface 10-Foot, bannières géantes & navigation D-Pad / Télécommande',
      icon: <Tv className="w-4 h-4 text-indigo-400" />,
    },
  ];

  const currentModeInfo = modes.find((m) => m.id === deviceMode) || modes[0];

  return (
    <div className="relative inline-block text-left">
      <button
        id="device-mode-selector-btn"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 rounded-full border transition-all cursor-pointer ${
          compact
            ? 'px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border-white/10 text-xs text-slate-200'
            : 'px-3.5 py-2 bg-white/5 hover:bg-white/10 border-white/10 text-xs text-slate-200 shadow-sm'
        }`}
        title={`Format d'affichage : ${currentModeInfo.label} (Rendu : ${deviceType.toUpperCase()})`}
      >
        <span className="shrink-0">
          {deviceType === 'tv' ? (
            <Tv className="w-3.5 h-3.5 text-indigo-400" />
          ) : deviceType === 'tablet' ? (
            <Tablet className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
          )}
        </span>

        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-white">
            {deviceType === 'tv' ? 'Smart TV' : deviceType === 'tablet' ? 'Tablette' : 'Mobile'}
          </span>
          {deviceMode === 'auto' && (
            <span className="text-[9px] font-mono font-bold bg-sky-500/20 text-sky-300 px-1.5 py-0.2 rounded-md border border-sky-500/30">
              AUTO
            </span>
          )}
        </div>

        <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-72 bg-slate-950/90 backdrop-blur-3xl border border-white/15 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150"
          onMouseLeave={() => setIsOpen(false)}
        >
          <div className="px-3 py-2 text-[11px] uppercase tracking-wider font-bold text-slate-400 border-b border-white/10 flex items-center justify-between">
            <span>Format & Appareil</span>
            <span className="text-[10px] font-mono text-indigo-400">iSTB Engine</span>
          </div>

          <div className="py-1 space-y-1">
            {modes.map((mode) => {
              const isSelected = deviceMode === mode.id;
              return (
                <button
                  key={mode.id}
                  id={`select-device-mode-${mode.id}`}
                  onClick={() => {
                    setDeviceMode(mode.id);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl flex items-start gap-3 transition cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-300'
                      : 'text-slate-300 hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">{mode.icon}</div>
                  <div className="flex-1 truncate">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-white">{mode.label}</span>
                      {mode.badge && (
                        <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                          {mode.badge}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate mt-0.5">
                      {mode.description}
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />}
                </button>
              );
            })}
          </div>

          {/* Quick Info Box */}
          <div className="p-2.5 border-t border-white/10 mt-1 bg-white/[0.02] rounded-xl flex items-start gap-2 text-[10px] text-slate-400">
            <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
            <span>
              L'interface s'adapte automatiquement à l'écran, aux télécommandes TV, tablettes et smartphones.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
