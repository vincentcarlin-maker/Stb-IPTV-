import React, { useState } from 'react';
import { 
  Server, 
  Plus, 
  Trash2, 
  RefreshCw, 
  Check, 
  FileText, 
  Sparkles, 
  Globe, 
  Cpu, 
  CheckCircle2, 
  XCircle, 
  Copy,
  Edit2
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { ServerType, StalkerLiveStreamFormat, ServerProfile } from '../types/iptv';
import { StalkerService } from '../services/stalkerService';
import { StalkerCapabilityService } from '../services/stalkerCapabilityService';
import { XtreamService } from '../services/xtreamService';

const isStaticHost = typeof window !== 'undefined' && (
  window.location.hostname.includes('github.io') || 
  window.location.hostname.includes('github.pages') ||
  window.location.hostname.includes('pages.dev') ||
  window.location.hostname.includes('netlify.app') ||
  window.location.hostname.includes('vercel.app')
);

interface ServerManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ServerManagerModal: React.FC<ServerManagerModalProps> = ({ isOpen, onClose }) => {
  const { 
    servers, 
    activeServer, 
    addServer, 
    updateServer,
    deleteServer, 
    setActiveServerId, 
    refreshServerData,
    isLoadingServer,
  } = useIPTV();

  const [isAddingNew, setIsAddingNew] = useState<boolean>(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [serverType, setServerType] = useState<ServerType>('stalker');

  // Form states
  const [name, setName] = useState<string>('');
  const [portalUrl, setPortalUrl] = useState<string>('');
  const [macAddress, setMacAddress] = useState<string>(StalkerService.generateMacAddress());
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [m3uUrl, setM3uUrl] = useState<string>('');
  const [epgUrl, setEpgUrl] = useState<string>('');
  const [liveStreamFormat, setLiveStreamFormat] = useState<StalkerLiveStreamFormat>('auto');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [copiedMac, setCopiedMac] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleGenerateMac = () => {
    setMacAddress(StalkerService.generateMacAddress());
  };

  const handleCopyMac = (mac: string) => {
    navigator.clipboard.writeText(mac);
    setCopiedMac(true);
    setTimeout(() => setCopiedMac(false), 2000);
  };

  const handleStartEdit = (srv: ServerProfile) => {
    setEditingServerId(srv.id);
    setServerType(srv.type);
    setName(srv.name || '');
    setPortalUrl(srv.portalUrl || '');
    setMacAddress(srv.macAddress || StalkerService.generateMacAddress());
    setUsername(srv.username || '');
    setPassword(srv.password || '');
    setM3uUrl(srv.m3uUrl || '');
    setEpgUrl(srv.epgUrl || '');
    setLiveStreamFormat(srv.liveStreamFormat || 'auto');
    setTestStatus('idle');
    setTestMessage(null);
    setIsAddingNew(true);
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('Test de connexion au portail...');

    try {
      if (serverType === 'stalker') {
        if (!portalUrl || !macAddress) {
          setTestStatus('error');
          setTestMessage('Veuillez renseigner l’URL du portail et l’adresse MAC.');
          return;
        }
        const stalker = new StalkerService(portalUrl, macAddress);
        const res = await stalker.connect();
        if (res.success) {
          setTestStatus('success');
          setTestMessage('Connexion réussie au portail Stalker (Handshake OK).');
        } else {
          setTestStatus('error');
          setTestMessage(res.error || 'Échec de connexion au portail Stalker.');
        }
      } else if (serverType === 'xtream') {
        if (!portalUrl || !username || !password) {
          setTestStatus('error');
          setTestMessage('Veuillez renseigner l’URL, l’identifiant et le mot de passe.');
          return;
        }
        const xtream = new XtreamService(portalUrl, username, password);
        const res = await xtream.authenticate();
        if (res.success) {
          setTestStatus('success');
          setTestMessage('Authentification Xtream réussie ! Compte actif.');
        } else {
          setTestStatus('error');
          setTestMessage(res.error || 'Identifiants Xtream Codes invalides.');
        }
      } else if (serverType === 'm3u') {
        if (!m3uUrl) {
          setTestStatus('error');
          setTestMessage('Veuillez saisir une URL de playlist M3U valide.');
          return;
        }
        const testM3uUrl = isStaticHost 
          ? `https://corsproxy.io/?url=${encodeURIComponent(m3uUrl)}`
          : `/api/m3u/fetch?url=${encodeURIComponent(m3uUrl)}`;
        const response = await fetch(testM3uUrl);
        if (response.ok) {
          setTestStatus('success');
          setTestMessage('Playlist M3U valide et accessible.');
        } else {
          setTestStatus('error');
          setTestMessage('Impossible de récupérer le fichier M3U distant.');
        }
      }
    } catch (err: any) {
      setTestStatus('error');
      setTestMessage(`Erreur: ${err.message}`);
    }
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (editingServerId) {
      updateServer(editingServerId, {
        name: name.trim(),
        type: serverType,
        portalUrl: portalUrl.trim(),
        macAddress: serverType === 'stalker' ? macAddress.trim() : undefined,
        username: serverType === 'xtream' ? username.trim() : undefined,
        password: serverType === 'xtream' ? password.trim() : undefined,
        m3uUrl: serverType === 'm3u' ? m3uUrl.trim() : undefined,
        epgUrl: epgUrl.trim() || undefined,
        liveStreamFormat: serverType === 'stalker' ? liveStreamFormat : undefined,
      });
      setIsAddingNew(false);
      setEditingServerId(null);
      resetForm();
      return;
    }

    onClose(); // Close manager modal to show progress modal
    await addServer({
      name: name.trim(),
      type: serverType,
      portalUrl: portalUrl.trim(),
      macAddress: serverType === 'stalker' ? macAddress.trim() : undefined,
      username: serverType === 'xtream' ? username.trim() : undefined,
      password: serverType === 'xtream' ? password.trim() : undefined,
      m3uUrl: serverType === 'm3u' ? m3uUrl.trim() : undefined,
      epgUrl: epgUrl.trim() || undefined,
      liveStreamFormat: serverType === 'stalker' ? liveStreamFormat : 'auto',
    });

    setIsAddingNew(false);
    setEditingServerId(null);
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setPortalUrl('');
    setMacAddress(StalkerService.generateMacAddress());
    setUsername('');
    setPassword('');
    setM3uUrl('');
    setEpgUrl('');
    setLiveStreamFormat('auto');
    setEditingServerId(null);
    setTestStatus('idle');
    setTestMessage(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="bg-slate-950/85 backdrop-blur-3xl border border-white/15 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-6 bg-white/[0.02] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white">Gestion des Serveurs & Adresses MAC</h2>
              <p className="text-xs text-slate-400">Stalker MAG Portal, Xtream Codes et Playlists M3U</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Active Server Info Banner */}
          {activeServer && (
            <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 backdrop-blur-xl flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Serveur Actif</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold font-mono">
                    {activeServer.type.toUpperCase()}
                  </span>
                </div>
                <h3 className="text-base font-extrabold text-white mt-1">{activeServer.name}</h3>
                {activeServer.macAddress && (
                  <div className="text-xs text-slate-300 font-mono mt-0.5 flex items-center gap-2">
                    <span>MAC : {activeServer.macAddress}</span>
                    <button
                      onClick={() => handleCopyMac(activeServer.macAddress!)}
                      className="text-indigo-400 hover:text-indigo-300"
                      title="Copier l'adresse MAC"
                    >
                      {copiedMac ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={refreshServerData}
                disabled={isLoadingServer}
                className="px-4 py-2.5 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-500/25 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingServer ? 'animate-spin' : ''}`} />
                Actualiser
              </button>
            </div>
          )}

          {/* List of Saved Servers */}
          {!isAddingNew ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Profils Enregistrés ({servers.length})
                </h3>
                <button
                  id="add-new-server-profile-btn"
                  onClick={() => setIsAddingNew(true)}
                  className="px-4 py-2 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold flex items-center gap-1.5 transition shadow-lg shadow-indigo-500/25"
                >
                  <Plus className="w-4 h-4" />
                  Ajouter un Serveur
                </button>
              </div>

              <div className="space-y-2.5">
                {servers.map((srv) => {
                  const isActive = activeServer?.id === srv.id;
                  const stalkerCaps = srv.type === 'stalker' && srv.portalUrl ? StalkerCapabilityService.getCapabilities(srv.portalUrl) : null;
                  const currentFormat = srv.liveStreamFormat || 'auto';

                  return (
                    <div
                      key={srv.id}
                      className={`p-4 rounded-2xl border transition flex flex-col gap-3 backdrop-blur-xl ${
                        isActive
                          ? 'bg-indigo-500/20 border-indigo-500/50 shadow-lg shadow-indigo-500/10'
                          : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-white truncate">{srv.name}</h4>
                            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-white/10 text-slate-300">
                              {srv.type}
                            </span>
                            {srv.type === 'stalker' && (
                              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                                currentFormat === 'm3u8'
                                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                  : currentFormat === 'ts'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : stalkerCaps?.nativeHlsSupported
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                              }`}>
                                {currentFormat === 'm3u8'
                                  ? 'Mode: Forcé M3U8'
                                  : currentFormat === 'ts'
                                  ? 'Mode: Forcé TS'
                                  : stalkerCaps?.nativeHlsSupported
                                  ? 'Auto: HLS Supporté'
                                  : 'Auto: Détection'}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                            {srv.macAddress && `MAC: ${srv.macAddress} • `}
                            {srv.portalUrl || 'Accès direct'}
                          </div>
                          {srv.channelCount && (
                            <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                              {srv.channelCount} chaînes • Expiration: {srv.expiryDate || 'N/A'}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isActive ? (
                            <span className="px-3 py-1.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 text-xs font-bold">
                              Connecté
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                setActiveServerId(srv.id);
                                onClose();
                              }}
                              className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-indigo-500 text-white text-xs font-bold transition"
                            >
                              Se Connecter
                            </button>
                          )}

                          {srv.type !== 'demo' && (
                            <>
                              <button
                                onClick={() => handleStartEdit(srv)}
                                className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition"
                                title="Modifier ce profil"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => deleteServer(srv.id)}
                                className="p-2 rounded-full text-slate-500 hover:text-red-400 hover:bg-white/10 transition"
                                title="Supprimer ce profil"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Stalker Live Format Selector Quick Toggle */}
                      {srv.type === 'stalker' && (
                        <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px]">
                          <span className="text-slate-400 font-medium">Format du flux Live :</span>
                          <div className="inline-flex rounded-xl bg-black/40 p-1 border border-white/10 gap-1">
                            <button
                              type="button"
                              onClick={() => updateServer(srv.id, { liveStreamFormat: 'auto' })}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                                currentFormat === 'auto'
                                  ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/40'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              Automatique
                            </button>
                            <button
                              type="button"
                              onClick={() => updateServer(srv.id, { liveStreamFormat: 'm3u8' })}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                                currentFormat === 'm3u8'
                                  ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/40'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              M3U8 / HLS
                            </button>
                            <button
                              type="button"
                              onClick={() => updateServer(srv.id, { liveStreamFormat: 'ts' })}
                              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                                currentFormat === 'ts'
                                  ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/40'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              TS
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ADD / EDIT SERVER FORM */
            <form onSubmit={handleSaveServer} className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <h3 className="text-sm font-bold text-white">
                  {editingServerId ? 'Modifier le profil IPTV' : 'Ajouter un nouveau profil IPTV'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingNew(false);
                    setEditingServerId(null);
                    resetForm();
                  }}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Annuler
                </button>
              </div>

              {/* Type Switcher */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">Type de Connexion</label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setServerType('stalker')}
                    className={`py-3 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                      serverType === 'stalker'
                        ? 'bg-indigo-500 text-white border-indigo-400 shadow-md shadow-indigo-500/30'
                        : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <Cpu className="w-4 h-4" />
                    Stalker (MAG / MAC)
                  </button>
                  <button
                    type="button"
                    onClick={() => setServerType('xtream')}
                    className={`py-3 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                      serverType === 'xtream'
                        ? 'bg-indigo-500 text-white border-indigo-400 shadow-md shadow-indigo-500/30'
                        : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <Globe className="w-4 h-4" />
                    Xtream Codes API
                  </button>
                  <button
                    type="button"
                    onClick={() => setServerType('m3u')}
                    className={`py-3 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1 transition ${
                      serverType === 'm3u'
                        ? 'bg-indigo-500 text-white border-indigo-400 shadow-md shadow-indigo-500/30'
                        : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    Playlist M3U
                  </button>
                </div>
              </div>

              {/* Profile Name */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Nom du Profil</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Mon Abonnement IPTV Salon"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-400"
                />
              </div>

              {/* Stalker Portal Fields */}
              {serverType === 'stalker' && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">
                      URL du Portail Stalker (MAG)
                    </label>
                    <input
                      type="url"
                      required
                      placeholder="http://mag.iptvserver.com:8080/c/"
                      value={portalUrl}
                      onChange={(e) => setPortalUrl(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-mono outline-none focus:border-indigo-400"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-slate-300">Adresse MAC (MAG)</label>
                      <button
                        type="button"
                        onClick={handleGenerateMac}
                        className="text-[11px] font-bold text-indigo-400 hover:underline flex items-center gap-1"
                      >
                        <Sparkles className="w-3 h-3" />
                        Générer une MAC aléatoire
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="00:1A:79:XX:XX:XX"
                      value={macAddress}
                      onChange={(e) => setMacAddress(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-mono uppercase tracking-wider outline-none focus:border-indigo-400"
                    />
                  </div>

                  {/* Format du flux Live Settings */}
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                      Format du flux Live
                    </label>
                    <div className="space-y-2">
                      <div
                        onClick={() => setLiveStreamFormat('auto')}
                        className={`p-3 rounded-2xl border transition cursor-pointer flex items-start gap-3 ${
                          liveStreamFormat === 'auto'
                            ? 'bg-indigo-500/20 border-indigo-500/50 text-white'
                            : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        <input
                          type="radio"
                          id="format-auto"
                          name="liveStreamFormat"
                          value="auto"
                          checked={liveStreamFormat === 'auto'}
                          onChange={() => setLiveStreamFormat('auto')}
                          className="mt-0.5 accent-indigo-500 cursor-pointer"
                        />
                        <div>
                          <div className="text-xs font-bold">Automatique</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            L’application choisit automatiquement le format compatible.
                          </div>
                        </div>
                      </div>

                      <div
                        onClick={() => setLiveStreamFormat('m3u8')}
                        className={`p-3 rounded-2xl border transition cursor-pointer flex items-start gap-3 ${
                          liveStreamFormat === 'm3u8'
                            ? 'bg-indigo-500/20 border-indigo-500/50 text-white'
                            : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        <input
                          type="radio"
                          id="format-m3u8"
                          name="liveStreamFormat"
                          value="m3u8"
                          checked={liveStreamFormat === 'm3u8'}
                          onChange={() => setLiveStreamFormat('m3u8')}
                          className="mt-0.5 accent-indigo-500 cursor-pointer"
                        />
                        <div>
                          <div className="text-xs font-bold">M3U8 / HLS</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Force le flux HLS. Recommandé pour les navigateurs/PWA lorsque le serveur le supporte.
                          </div>
                        </div>
                      </div>

                      <div
                        onClick={() => setLiveStreamFormat('ts')}
                        className={`p-3 rounded-2xl border transition cursor-pointer flex items-start gap-3 ${
                          liveStreamFormat === 'ts'
                            ? 'bg-indigo-500/20 border-indigo-500/50 text-white'
                            : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        <input
                          type="radio"
                          id="format-ts"
                          name="liveStreamFormat"
                          value="ts"
                          checked={liveStreamFormat === 'ts'}
                          onChange={() => setLiveStreamFormat('ts')}
                          className="mt-0.5 accent-indigo-500 cursor-pointer"
                        />
                        <div>
                          <div className="text-xs font-bold">TS</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            Conserve le flux MPEG-TS original.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Xtream Fields */}
              {serverType === 'xtream' && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-slate-300 block mb-1">URL du Serveur Xtream</label>
                    <input
                      type="url"
                      required
                      placeholder="http://server.xtream.tv:8000"
                      value={portalUrl}
                      onChange={(e) => setPortalUrl(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-mono outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Nom d'utilisateur</label>
                      <input
                        type="text"
                        required
                        placeholder="Identifiant"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">Mot de passe</label>
                      <input
                        type="password"
                        required
                        placeholder="Mot de passe"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-400"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* M3U Playlist Fields */}
              {serverType === 'm3u' && (
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">URL de la Playlist M3U</label>
                  <input
                    type="url"
                    required
                    placeholder="https://example.com/playlist.m3u"
                    value={m3uUrl}
                    onChange={(e) => setM3uUrl(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white font-mono outline-none focus:border-indigo-400"
                  />
                </div>
              )}

              {/* Test Connection Status Banner */}
              {testMessage && (
                <div
                  className={`p-3.5 rounded-2xl border text-xs font-semibold flex items-center gap-2 ${
                    testStatus === 'success'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : testStatus === 'error'
                      ? 'bg-red-500/20 text-red-300 border-red-500/40'
                      : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                  }`}
                >
                  {testStatus === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                  {testStatus === 'error' && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                  {testStatus === 'testing' && <RefreshCw className="w-4 h-4 animate-spin text-indigo-400 shrink-0" />}
                  <span>{testMessage}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testStatus === 'testing'}
                  className="flex-1 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-200 text-xs font-bold border border-white/10 transition"
                >
                  Tester la Connexion
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-2xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold shadow-lg shadow-indigo-500/25 transition"
                >
                  {editingServerId ? 'Enregistrer les modifications' : 'Enregistrer & Connecter'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
