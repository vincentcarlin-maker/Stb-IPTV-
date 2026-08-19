import React, { useState } from 'react';
import { 
  Settings, 
  Sliders, 
  ShieldCheck, 
  Tv, 
  Check, 
  Database,
  Smartphone,
  Tablet,
  Cpu,
  Monitor
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { DeviceMode } from '../types/iptv';
import { StalkerCapabilityService } from '../services/stalkerCapabilityService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenParentalModal: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenParentalModal,
}) => {
  const { 
    playerSettings, 
    updatePlayerSettings, 
    parentalSettings, 
    clearHistory,
    deviceType,
    detectedType,
    deviceMode,
    setDeviceMode,
    screenWidth,
    screenHeight,
    orientation,
  } = useIPTV();

  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSave = () => {
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  const deviceModesList: { id: DeviceMode; label: string; desc: string; icon: React.ReactNode }[] = [
    {
      id: 'auto',
      label: 'Détection Auto',
      desc: `Auto (${detectedType.toUpperCase()})`,
      icon: <Cpu className="w-4 h-4 text-sky-400" />,
    },
    {
      id: 'phone',
      label: 'Smartphone',
      desc: 'Tactile & barre basse',
      icon: <Smartphone className="w-4 h-4 text-emerald-400" />,
    },
    {
      id: 'tablet',
      label: 'Tablette',
      desc: 'Hybride Split-view',
      icon: <Tablet className="w-4 h-4 text-amber-400" />,
    },
    {
      id: 'tv',
      label: 'Smart TV',
      desc: '10-Foot & Télécommande',
      icon: <Tv className="w-4 h-4 text-indigo-400" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="bg-slate-950/85 backdrop-blur-3xl border border-white/15 rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-6 bg-white/[0.02] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white">Paramètres de l'application iSTB</h2>
              <p className="text-xs text-slate-400">Format d'appareil, Lecteur HLS, Tampon et Sécurité</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {savedSuccess && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2">
              <Check className="w-4 h-4" />
              Paramètres enregistrés avec succès !
            </div>
          )}

          {/* Section: Device Format & Responsive Adaptation */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Monitor className="w-4 h-4 text-sky-400" />
                Format d'Appareil & Rendu d'Écran
              </h3>
              <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
                {screenWidth}x{screenHeight} • {orientation}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {deviceModesList.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setDeviceMode(m.id)}
                  className={`p-3 rounded-2xl border text-left transition cursor-pointer ${
                    deviceMode === m.id
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-white shadow-lg shadow-indigo-500/10'
                      : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    {m.icon}
                    {deviceMode === m.id && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                  </div>
                  <div className="text-xs font-bold text-white">{m.label}</div>
                  <div className="text-[9px] opacity-70 truncate mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Section 1: Player & Buffer */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Tv className="w-4 h-4 text-indigo-400" />
              Lecteur Vidéo & Tampon Flux (Buffer)
            </h3>

            <div className="grid grid-cols-3 gap-2.5">
              {[
                { id: 'low', label: 'Faible Latence', desc: 'Direct instantané' },
                { id: 'standard', label: 'Standard (30s)', desc: 'Équilibré' },
                { id: 'high', label: 'Tampon Élevé (60s)', desc: 'Anti-coupures' },
              ].map((buf) => (
                <button
                  key={buf.id}
                  onClick={() => updatePlayerSettings({ bufferLength: buf.id as any })}
                  className={`p-3.5 rounded-2xl border text-left transition ${
                    playerSettings.bufferLength === buf.id
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-white shadow-lg shadow-indigo-500/10'
                      : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="text-xs font-bold">{buf.label}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{buf.desc}</div>
                </button>
              ))}
            </div>

            {/* Stream Proxy Toggle */}
            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white">Proxy Relais de Flux (Anti-CORS)</div>
                <div className="text-[10px] text-slate-400">
                  Transite les flux vidéo par le serveur backend pour contourner les restrictions CORS
                </div>
              </div>
              <input
                type="checkbox"
                checked={playerSettings.useStreamProxy}
                onChange={(e) => updatePlayerSettings({ useStreamProxy: e.target.checked })}
                className="w-4 h-4 accent-indigo-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Section 2: OSD & Display */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-indigo-400" />
              Affichage à l'Écran (OSD)
            </h3>

            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10 space-y-2.5">
              <div className="flex justify-between text-xs font-semibold text-white">
                <span>Durée d'affichage de la bannière OSD</span>
                <span className="text-indigo-400 font-mono font-bold">{playerSettings.osdTimeout || 4} secondes</span>
              </div>
              <input
                type="range"
                min={2}
                max={10}
                value={playerSettings.osdTimeout || 4}
                onChange={(e) => updatePlayerSettings({ osdTimeout: parseInt(e.target.value, 10) })}
                className="w-full accent-indigo-500 h-1.5 bg-white/10 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* Section 3: Parental Control Shortcut */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Sécurité & Contrôle Parental
            </h3>
            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white">État du Contrôle Parental</div>
                <div className="text-[10px] text-slate-400">
                  {parentalSettings.enabled ? 'Actif (Protège les flux +18)' : 'Désactivé'}
                </div>
              </div>
              <button
                onClick={() => {
                  onClose();
                  onOpenParentalModal();
                }}
                className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer"
              >
                Gérer le code PIN
              </button>
            </div>
          </div>

          {/* Section 4: Storage & Reset */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-amber-400" />
              Données & Historique
            </h3>
            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white">Effacer l'historique des chaînes</div>
                <div className="text-[10px] text-slate-400">Réinitialise la liste des chaînes récentes</div>
              </div>
              <button
                onClick={() => {
                  clearHistory();
                }}
                className="px-3.5 py-1.5 rounded-full bg-red-500/20 text-red-300 hover:bg-red-500 hover:text-white border border-red-500/30 text-xs font-bold transition cursor-pointer"
              >
                Effacer
              </button>
            </div>

            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white">Capacités Portails Stalker HLS</div>
                <div className="text-[10px] text-slate-400">Réinitialiser le profil de détection automatique des serveurs Stalker</div>
              </div>
              <button
                onClick={() => {
                  StalkerCapabilityService.clearCapabilities();
                  setSavedSuccess(true);
                  setTimeout(() => setSavedSuccess(false), 1200);
                }}
                className="px-3.5 py-1.5 rounded-full bg-sky-500/20 text-sky-300 hover:bg-sky-500 hover:text-white border border-sky-500/30 text-xs font-bold transition cursor-pointer"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-white/[0.02] border-t border-white/10 flex justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition cursor-pointer"
          >
            Fermer
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold shadow-lg shadow-indigo-500/25 transition cursor-pointer"
          >
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
};

