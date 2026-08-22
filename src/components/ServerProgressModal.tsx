import React from 'react';
import { 
  Server, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  X, 
  Radio, 
  Tv, 
  Film,
  Clapperboard,
  Calendar,
  ArrowRight,
  Sparkles,
  Key
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';

interface ServerProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenServerManager?: () => void;
}

export const ServerProgressModal: React.FC<ServerProgressModalProps> = ({
  isOpen,
  onClose,
  onOpenServerManager
}) => {
  const { 
    serverProgress, 
    activeServer, 
    refreshServerData,
    dismissServerProgress,
    channels,
    vodMovies,
    seriesList,
    setActiveView
  } = useIPTV();

  if (serverProgress.isDismissed) {
    return null;
  }

  const rawPercent = Number(serverProgress.percent);
  const safePercent = typeof rawPercent === 'number' && !Number.isNaN(rawPercent) 
    ? Math.min(100, Math.max(0, Math.round(rawPercent)))
    : 0;

  const hasActiveProgress = safePercent > 0 || serverProgress.isLoading || !!serverProgress.error;
  if (!isOpen && !hasActiveProgress) {
    return null;
  }

  const steps = [
    { num: 1, label: 'Connexion', desc: 'Initialisation de l\'adresse' },
    { num: 2, label: 'Authentification', desc: 'Handshake & Licences' },
    { num: 3, label: 'Chargement', desc: 'Récupération des chaînes' },
    { num: 4, label: 'Mise en cache', desc: 'Organisation par catégories' },
  ];

  const currentStep = serverProgress.step || 1;
  const isError = !!serverProgress.error;
  const isDone = !serverProgress.isLoading && !isError && safePercent >= 100;

  const totalChannels = serverProgress.channelsCount ?? channels.length;
  const totalVod = serverProgress.vodCount ?? vodMovies.length;
  const totalSeries = serverProgress.seriesCount ?? seriesList.length;
  const expiryDate = serverProgress.expiryDate || activeServer?.expiryDate || 'Actif';
  const macAddress = serverProgress.macAddress || activeServer?.macAddress;

  const handleDismissAndNavigate = (view: 'live' | 'vod' | 'series') => {
    dismissServerProgress();
    onClose();
    setActiveView(view);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
      <div className="bg-slate-950/95 border border-white/15 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col backdrop-blur-2xl animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 sm:p-6 bg-white/[0.02] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border shadow-lg ${
              isError 
                ? 'bg-red-500/20 border-red-500/40 text-red-400'
                : isDone 
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : 'bg-indigo-500/20 border-indigo-500/40 text-indigo-400'
            }`}>
              {isError ? (
                <AlertTriangle className="w-5 h-5" />
              ) : isDone ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <Server className="w-5 h-5 animate-pulse" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-extrabold text-white">
                  {isError 
                    ? 'Échec de Connexion au Serveur' 
                    : isDone 
                    ? 'Serveur Connecté avec Succès' 
                    : 'Synchronisation du Serveur IPTV'}
                </h3>
                {activeServer && (
                  <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-white/10 text-slate-300 border border-white/10">
                    {activeServer.type}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[260px]">
                {serverProgress.serverName || activeServer?.name || 'Serveur IPTV'}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              dismissServerProgress();
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition active:scale-90"
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 sm:p-6 space-y-5">

          {/* Stepper Display */}
          <div className="grid grid-cols-4 gap-1.5 relative">
            {steps.map((s) => {
              const isCompleted = currentStep > s.num || isDone;
              const isCurrent = currentStep === s.num && !isDone && !isError;
              
              return (
                <div key={s.num} className="flex flex-col items-center text-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 mb-1.5 border ${
                    isError && isCurrent
                      ? 'bg-red-500/20 border-red-500/50 text-red-400'
                      : isCompleted
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-extrabold'
                      : isCurrent
                      ? 'bg-indigo-500 text-white border-indigo-400 shadow-lg shadow-indigo-500/30 ring-2 ring-indigo-500/20 animate-pulse'
                      : 'bg-white/5 text-slate-500 border-white/10'
                  }`}>
                    {isCompleted ? '✓' : s.num}
                  </div>
                  <span className={`text-[10px] font-semibold leading-tight ${
                    isCurrent ? 'text-indigo-300' : isCompleted ? 'text-slate-300' : 'text-slate-600'
                  }`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Animated Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className={isError ? 'text-red-400' : isDone ? 'text-emerald-400' : 'text-indigo-300'}>
                {serverProgress.message || 'Chargement en cours...'}
              </span>
              <span className="font-mono text-slate-400">
                {safePercent}%
              </span>
            </div>

            <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden p-0.5 border border-white/10 relative">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  isError 
                    ? 'bg-gradient-to-r from-red-600 to-rose-500' 
                    : isDone 
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400 shadow-lg shadow-emerald-500/50' 
                    : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-400 shadow-lg shadow-indigo-500/50'
                }`}
                style={{ width: `${Math.min(100, Math.max(5, safePercent))}%` }}
              />
            </div>
          </div>

          {/* Stalker Live Progress Box (Rule #14) */}
          {serverProgress.stalkerVodProgress && !isDone && (
            <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 text-xs space-y-2 font-mono">
              <div className="flex items-center justify-between font-extrabold text-indigo-300 border-b border-indigo-500/20 pb-1.5 text-[11px]">
                <span>AVANCEMENT CATALOGUE STALKER</span>
                <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-200 text-[10px]">
                  Concurrence: {serverProgress.stalkerVodProgress.currentConcurrency}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-black/30 p-2 rounded-xl border border-white/5 space-y-1">
                  <div className="font-bold text-slate-300">Films VOD</div>
                  <div className="text-slate-400">Pages : <span className="text-white font-bold">{serverProgress.stalkerVodProgress.movies.fetchedPages}</span> / {serverProgress.stalkerVodProgress.movies.expectedPages}</div>
                  <div className="text-slate-400">Films : <span className="text-emerald-400 font-bold">{serverProgress.stalkerVodProgress.movies.uniqueCount}</span> / {serverProgress.stalkerVodProgress.movies.serverTotal || '?'}</div>
                </div>

                <div className="bg-black/30 p-2 rounded-xl border border-white/5 space-y-1">
                  <div className="font-bold text-slate-300">Séries TV</div>
                  <div className="text-slate-400">Pages : <span className="text-white font-bold">{serverProgress.stalkerVodProgress.series.fetchedPages}</span> / {serverProgress.stalkerVodProgress.series.expectedPages}</div>
                  <div className="text-slate-400">Séries : <span className="text-purple-400 font-bold">{serverProgress.stalkerVodProgress.series.uniqueCount}</span> / {serverProgress.stalkerVodProgress.series.serverTotal || '?'}</div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-white/5">
                <span>Reqs actives: <strong className="text-indigo-300">{serverProgress.stalkerVodProgress.activeRequests}</strong></span>
                <span>Retry pages: <strong className="text-amber-400">{serverProgress.stalkerVodProgress.retryCount}</strong></span>
                <span>Erreurs: <strong className={serverProgress.stalkerVodProgress.definitiveErrors > 0 ? 'text-red-400' : 'text-emerald-400'}>{serverProgress.stalkerVodProgress.definitiveErrors}</strong></span>
              </div>
            </div>
          )}

          {/* Results Summary Grid when completed */}
          {isDone ? (
            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-0.5">
                <span className="flex items-center gap-1.5 text-emerald-400 font-bold uppercase tracking-wider text-[11px]">
                  <Sparkles className="w-4 h-4" />
                  Ressources Récupérées avec Succès
                </span>
                {macAddress && (
                  <span className="font-mono text-[10px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md flex items-center gap-1">
                    <Key className="w-3 h-3" />
                    MAC: {macAddress}
                  </span>
                )}
              </div>

              {/* Audit Status Badge (Rule #15 & #16) */}
              {serverProgress.stalkerAuditReport && (
                <div className={`p-3 rounded-2xl border font-mono text-xs space-y-1.5 ${
                  serverProgress.stalkerAuditReport.catalogComplete === 'YES'
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-200'
                    : 'bg-amber-950/40 border-amber-500/30 text-amber-200'
                }`}>
                  <div className="flex items-center justify-between font-bold text-[11px]">
                    <span className="uppercase">Rapport d'Audit Stalker VOD</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                      serverProgress.stalkerAuditReport.catalogComplete === 'YES'
                        ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                        : 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
                    }`}>
                      CATALOG COMPLETE: {serverProgress.stalkerAuditReport.catalogComplete}
                    </span>
                  </div>

                  <pre className="text-[10px] text-slate-300 leading-tight overflow-x-auto whitespace-pre bg-black/40 p-2 rounded-xl border border-white/5 max-h-36 font-mono">
                    {serverProgress.stalkerAuditReport.formattedText}
                  </pre>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                {/* Chaînes Live */}
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                    <Tv className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-base font-extrabold text-white font-mono leading-none">
                      {totalChannels.toLocaleString('fr-FR')}
                    </div>
                    <div className="text-[11px] text-emerald-300/80 font-medium mt-1">
                      Chaînes TV Live
                    </div>
                  </div>
                </div>

                {/* Films VOD */}
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                    <Film className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-base font-extrabold text-white font-mono leading-none">
                      {totalVod.toLocaleString('fr-FR')}
                    </div>
                    <div className="text-[11px] text-indigo-300/80 font-medium mt-1">
                      Films & VOD
                    </div>
                  </div>
                </div>

                {/* Séries TV */}
                <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-2xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
                    <Clapperboard className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-base font-extrabold text-white font-mono leading-none">
                      {totalSeries.toLocaleString('fr-FR')}
                    </div>
                    <div className="text-[11px] text-purple-300/80 font-medium mt-1">
                      Séries TV
                    </div>
                  </div>
                </div>

                {/* Date d'expiration Code / MAC */}
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div className="overflow-hidden">
                    <div className="text-xs font-extrabold text-amber-200 font-mono leading-tight truncate">
                      {expiryDate}
                    </div>
                    <div className="text-[10px] text-amber-300/80 font-medium mt-0.5">
                      Expiration Compte
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Detailed Info Log Box during loading/error */
            <div className={`p-3.5 rounded-2xl border text-xs space-y-1 font-mono ${
              isError
                ? 'bg-red-500/10 border-red-500/30 text-red-200'
                : 'bg-white/[0.04] border-white/10 text-slate-300'
            }`}>
              <div className="flex items-center gap-2 font-bold text-[10px] uppercase tracking-wider text-slate-400">
                <Radio className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                <span>Journal de synchronisation</span>
              </div>
              
              <p className="text-slate-200 break-all leading-relaxed text-[11px]">
                {serverProgress.detail || 'Connexion et négociation de protocoles en cours...'}
              </p>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-5 sm:p-6 bg-white/[0.02] border-t border-white/10 flex flex-wrap items-center justify-end gap-2.5">
          {isError ? (
            <>
              {onOpenServerManager && (
                <button
                  type="button"
                  onClick={() => {
                    dismissServerProgress();
                    onClose();
                    onOpenServerManager();
                  }}
                  className="px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold transition active:scale-95"
                >
                  Modifier le serveur
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  refreshServerData();
                }}
                className="px-5 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition active:scale-95"
              >
                <RefreshCw className="w-4 h-4" />
                Réessayer
              </button>
            </>
          ) : isDone ? (
            <div className="w-full flex flex-col sm:flex-row items-center gap-2">
              <button
                type="button"
                onClick={() => handleDismissAndNavigate('vod')}
                className="w-full sm:w-1/2 px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold flex items-center justify-center gap-2 transition active:scale-95"
              >
                <Film className="w-4 h-4 text-indigo-400" />
                <span>Films & VOD ({totalVod})</span>
              </button>

              <button
                type="button"
                onClick={() => handleDismissAndNavigate('live')}
                className="w-full sm:w-1/2 px-5 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30 transition active:scale-95"
              >
                <span>Chaînes Live ({totalChannels})</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                dismissServerProgress();
                onClose();
              }}
              className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 text-xs font-bold transition active:scale-95"
            >
              Continuer en arrière-plan
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
