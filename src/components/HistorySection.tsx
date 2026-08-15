import React from 'react';
import { History, Play, Trash2, Clock } from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { Channel } from '../types/iptv';

export const HistorySection: React.FC = () => {
  const { history, clearHistory, setActiveChannel, setActiveView } = useIPTV();

  const handlePlayChannel = (channel: Channel) => {
    setActiveChannel(channel);
    setActiveView('live');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent text-slate-100 overflow-hidden select-none">
      {/* Header (Frosted Glass) */}
      <div className="p-6 bg-white/[0.03] backdrop-blur-2xl border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <History className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Replay & Chaînes Récentes</h1>
            <p className="text-xs text-slate-400">Historique de visionnage et accès rapide</p>
          </div>
        </div>

        {history.length > 0 && (
          <button
            onClick={clearHistory}
            className="px-4 py-2 rounded-full bg-red-500/20 text-red-300 hover:bg-red-500 hover:text-white border border-red-500/30 text-xs font-bold flex items-center gap-2 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Vider l'historique
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        {history.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center">
            <Clock className="w-12 h-12 text-slate-600 mb-3" />
            <h3 className="text-sm font-bold text-slate-300">Aucun historique disponible</h3>
            <p className="text-xs text-slate-500 mt-1">
              Les chaînes que vous regardez apparaîtront ici automatiquement.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {history.map(({ channel, timestamp }, idx) => (
              <div
                key={`${channel.id}-${timestamp}-${idx}`}
                onClick={() => handlePlayChannel(channel)}
                className="p-4 rounded-3xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-indigo-400/50 backdrop-blur-xl transition-all cursor-pointer flex items-center justify-between gap-3 shadow-lg"
              >
                <div className="flex items-center gap-3.5 truncate">
                  {channel.logo ? (
                    <div className="w-12 h-12 rounded-2xl bg-black/40 p-1.5 border border-white/10 flex items-center justify-center shrink-0">
                      <img
                        src={channel.logo}
                        alt={channel.name}
                        className="max-w-full max-h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500 font-extrabold text-white text-xs flex items-center justify-center shrink-0 shadow-md">
                      {channel.number}
                    </div>
                  )}

                  <div className="truncate">
                    <div className="text-xs font-bold text-white truncate">{channel.name}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{channel.category}</div>
                    <div className="text-[10px] text-indigo-300 font-mono mt-0.5">
                      {new Date(timestamp).toLocaleDateString('fr-FR')} • {new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>

                <button className="p-3 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 transition shrink-0">
                  <Play className="w-4 h-4 fill-white ml-0.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
