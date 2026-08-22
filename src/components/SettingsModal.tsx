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
  Monitor,
  Gamepad2,
  Compass,
  Radio,
  MousePointer,
  CalendarDays,
  RefreshCw,
  X
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { DeviceMode, TVNavMode } from '../types/iptv';
import { StalkerCapabilityService } from '../services/stalkerCapabilityService';
import { EPGService, EPG_PRESET_SOURCES } from '../services/epgService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenParentalModal: () => void;
  onOpenInstallModal?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onOpenParentalModal,
  onOpenInstallModal,
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
  const [epgStatus, setEpgStatus] = useState<any>(null);
  const [isRefreshingEpg, setIsRefreshingEpg] = useState<boolean>(false);
  const [epgSuccessMsg, setEpgSuccessMsg] = useState<string | null>(null);

  const [selectedEpgUrl, setSelectedEpgUrl] = useState<string>(() => {
    try {
      return localStorage.getItem('istb_custom_epg_url') || EPG_PRESET_SOURCES[0].url;
    } catch {
      return EPG_PRESET_SOURCES[0].url;
    }
  });

  React.useEffect(() => {
    if (isOpen) {
      EPGService.fetchEpgStatus().then((status) => {
        if (status) setEpgStatus(status);
      });
    }
  }, [isOpen]);

  const handleRefreshEpg = async () => {
    setIsRefreshingEpg(true);
    setEpgSuccessMsg(null);
    try {
      localStorage.setItem('istb_custom_epg_url', selectedEpgUrl);
      const updated = await EPGService.refreshEpgServer(selectedEpgUrl);
      if (updated) setEpgStatus(updated);
      setEpgSuccessMsg(`EPG actualisé : ${updated?.channelCount || 0} chaînes et ${updated?.programCount || 0} programmes !`);
      setTimeout(() => setEpgSuccessMsg(null), 4000);
    } catch (err: any) {
      console.warn('EPG refresh error:', err);
    } finally {
      setIsRefreshingEpg(false);
    }
  };

  if (!isOpen) return null;

  const currentNavMode: TVNavMode = playerSettings.tvNavMode || 'auto';

  const handleSave = () => {
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  const navModesList: { id: TVNavMode; label: string; desc: string; icon: React.ReactNode }[] = [
    {
      id: 'auto',
      label: 'Automatique',
      desc: 'Active le mode TV dès qu’une flèche est pressée',
      icon: <Compass className="w-4 h-4 text-sky-400" />,
    },
    {
      id: 'tv',
      label: 'Télécommande TV',
      desc: 'Navigation spatiale D-Pad (Philips, Box TV)',
      icon: <Radio className="w-4 h-4 text-indigo-400" />,
    },
    {
      id: 'pointer',
      label: 'Tactile / Souris',
      desc: 'Navigation classique au pointeur ou tactile',
      icon: <MousePointer className="w-4 h-4 text-amber-400" />,
    },
  ];

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
    <div 
      role="dialog"
      aria-modal="true"
      data-tv-modal="true"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none tv-modal-container"
    >
      <div className="bg-slate-950/85 backdrop-blur-3xl border border-white/15 rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-6 bg-white/[0.02] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white">Paramètres de l'application iSTB</h2>
              <p className="text-xs text-slate-400">Navigation TV, Format d'appareil, Lecteur et Sécurité</p>
            </div>
          </div>
          <button
            data-tv-focusable="true"
            data-tv-close="true"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
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

          {/* Section 0: TV Navigation Mode */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Gamepad2 className="w-4 h-4 text-indigo-400" />
                Mode de Navigation (Télécommande & TV)
              </h3>
              <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                Navigation Spatiale
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {navModesList.map((m) => (
                <button
                  key={m.id}
                  data-tv-focusable="true"
                  onClick={() => updatePlayerSettings({ tvNavMode: m.id })}
                  className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                    currentNavMode === m.id
                      ? 'bg-indigo-500/25 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                      : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    {m.icon}
                    {currentNavMode === m.id && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                  </div>
                  <div className="text-xs font-bold text-white">{m.label}</div>
                  <div className="text-[10px] opacity-75 mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

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

          {/* Section: EPG Source Configuration */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-indigo-400" />
              Guide Électronique des Programmes (EPG)
            </h3>
            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10 space-y-3.5">
              {epgSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{epgSuccessMsg}</span>
                </div>
              )}

              {/* Preset selection */}
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                  Sélectionner une source EPG prédéfinie :
                </label>
                <div className="space-y-1.5">
                  {EPG_PRESET_SOURCES.map((preset) => {
                    const isSelected = selectedEpgUrl === preset.url;
                    return (
                      <button
                        key={preset.url}
                        type="button"
                        onClick={() => setSelectedEpgUrl(preset.url)}
                        className={`w-full p-2.5 rounded-xl border text-left transition text-xs flex items-start justify-between gap-2 cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-500/20 border-indigo-500/50 text-white shadow-sm'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-100">{preset.name}</span>
                            {preset.recommended && (
                              <span className="text-[9px] px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 rounded font-semibold border border-emerald-500/30">
                                Recommandé
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{preset.description}</div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom URL Input */}
              <div className="pt-2 border-t border-white/5">
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Ou saisir une URL EPG personnalisée (XML ou XML.GZ) :
                </label>
                <input
                  type="url"
                  placeholder="https://exemple.com/mon-guide-epg.xml"
                  value={selectedEpgUrl}
                  onChange={(e) => setSelectedEpgUrl(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-mono outline-none focus:border-indigo-400 transition"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="text-[10px] text-slate-400">
                  Dernière mise à jour :{' '}
                  <strong className="text-slate-200">
                    {epgStatus?.lastUpdated
                      ? new Date(epgStatus.lastUpdated).toLocaleString('fr-FR', {
                          dateStyle: 'medium',
                          timeStyle: 'medium',
                        })
                      : 'En cours de synchronisation...'}
                  </strong>
                </div>

                <button
                  type="button"
                  onClick={handleRefreshEpg}
                  disabled={isRefreshingEpg || epgStatus?.status === 'updating' || !selectedEpgUrl}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 shrink-0 cursor-pointer active:scale-95"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingEpg || epgStatus?.status === 'updating' ? 'animate-spin' : ''}`} />
                  <span>{isRefreshingEpg || epgStatus?.status === 'updating' ? 'Actualisation...' : 'Actualiser l’EPG'}</span>
                </button>
              </div>

              {epgStatus && (
                <div className="pt-2.5 border-t border-white/5 flex items-center gap-4 text-[10px] font-mono text-slate-400">
                  <span>Chaînes EPG : <strong className="text-indigo-300">{epgStatus.channelCount || 0}</strong></span>
                  <span>Programmes : <strong className="text-indigo-300">{epgStatus.programCount || 0}</strong></span>
                </div>
              )}
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

            {/* Native Device VOD Player Toggle */}
            <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/30 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span>Lecteur VOD Natif de l'Appareil</span>
                  <span className="text-[9px] bg-indigo-500/30 text-indigo-200 px-1.5 py-0.5 rounded font-mono font-bold">VLC / MX / Appareil</span>
                </div>
                <div className="text-[10px] text-slate-300 mt-0.5">
                  Lancer par défaut les films et séries VOD dans le lecteur natif de votre appareil (Android Intent, VLC, MX Player ou fenêtré)
                </div>
              </div>
              <input
                type="checkbox"
                checked={!!playerSettings.useDevicePlayerForVod}
                onChange={(e) => updatePlayerSettings({ useDevicePlayerForVod: e.target.checked })}
                className="w-4 h-4 accent-indigo-500 cursor-pointer shrink-0"
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

          {/* Section 4: Android App & PWA */}
          {onOpenInstallModal && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                Application Android & Smart TV
              </h3>
              <div className="p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <span>Installer l'application sur Android</span>
                    <span className="text-[9px] bg-emerald-400/20 text-emerald-300 px-1.5 py-0.5 rounded font-mono font-bold">APK / PWA</span>
                  </div>
                  <div className="text-[10px] text-emerald-200/80 mt-0.5">
                    Lancement autonome, fluidité maximale et navigation sans barre d'adresse.
                  </div>
                </div>
                <button
                  onClick={() => {
                    onClose();
                    onOpenInstallModal();
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition active:scale-95 cursor-pointer shadow-lg shadow-emerald-500/20 shrink-0"
                >
                  Installer / Configurer
                </button>
              </div>
            </div>
          )}

          {/* Section 5: Storage & Reset */}
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

