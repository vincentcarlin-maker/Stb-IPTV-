import React, { useState } from 'react';
import { History, Play, Trash2, Clock, Film, Tv, Loader2 } from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { Channel, VODWatchHistoryItem } from '../types/iptv';
import { VODPlayerModal } from './VODPlayerModal';

function formatProgressTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m`;
  }
  return `${secs}s`;
}

export const HistorySection: React.FC = () => {
  const { 
    history, 
    clearHistory, 
    setActiveChannel, 
    setActiveView, 
    vodHistory, 
    clearVODHistory, 
    resolveVodStreamUrl 
  } = useIPTV();

  const [activeTab, setActiveTab] = useState<'live' | 'vod'>('live');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  
  const [activePlaybackVideo, setActivePlaybackVideo] = useState<{
    title: string;
    rawUrl: string;
    useRemux: boolean;
    originalCmd?: string;
    itemId?: string;
    itemType?: 'movie' | 'series';
    episodeId?: string;
    episodeTitle?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    poster?: string;
    backdrop?: string;
    category?: string;
  } | null>(null);

  const handlePlayChannel = (channel: Channel) => {
    setActiveChannel(channel);
    setActiveView('live');
  };

  const handlePlayVodHistory = async (item: VODWatchHistoryItem) => {
    setLoadingId(item.id);
    try {
      const isMovie = item.itemType === 'movie';
      const rawTarget = item.originalCmd || item.streamUrl;
      const targetUrl = await resolveVodStreamUrl(
        rawTarget,
        item.itemType,
        item.itemType === 'series' ? item.episodeId : undefined,
        item.itemType === 'series' ? {
          seriesTitle: item.title,
          seasonNumber: item.seasonNumber,
          episodeNumber: item.episodeNumber
        } : undefined
      );
      
      setActivePlaybackVideo({
        title: isMovie ? item.title : `${item.title} - ${item.episodeTitle || `S${item.seasonNumber}E${item.episodeNumber}`}`,
        rawUrl: targetUrl,
        useRemux: false,
        originalCmd: rawTarget,
        itemId: item.itemId,
        itemType: item.itemType,
        episodeId: item.episodeId,
        episodeTitle: item.episodeTitle,
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        poster: item.poster,
        backdrop: item.backdrop,
        category: item.category
      });
    } catch (err) {
      console.error('[HistorySection] Error resolving watch history URL:', err);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent text-slate-100 overflow-hidden select-none">
      {/* Header (Frosted Glass) */}
      <div className="p-6 bg-white/[0.03] backdrop-blur-2xl border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <History className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Historique de Lecture</h1>
            <p className="text-xs text-slate-400">Reprenez vos programmes là où vous en étiez</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Sub Tab Switcher */}
          <div className="flex bg-white/5 p-1 rounded-full border border-white/10">
            <button
              onClick={() => setActiveTab('live')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'live'
                  ? 'bg-white/15 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              Direct TV ({history.length})
            </button>
            <button
              onClick={() => setActiveTab('vod')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'vod'
                  ? 'bg-white/15 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              Films & Séries ({vodHistory.length})
            </button>
          </div>

          {activeTab === 'live' && history.length > 0 && (
            <button
              onClick={clearHistory}
              className="px-4 py-1.5 rounded-full bg-red-500/10 text-red-300 hover:bg-red-500 hover:text-white border border-red-500/20 text-xs font-bold flex items-center gap-2 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Vider</span>
            </button>
          )}

          {activeTab === 'vod' && vodHistory.length > 0 && (
            <button
              onClick={clearVODHistory}
              className="px-4 py-1.5 rounded-full bg-red-500/10 text-red-300 hover:bg-red-500 hover:text-white border border-red-500/20 text-xs font-bold flex items-center gap-2 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Vider</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        {activeTab === 'live' ? (
          history.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center">
              <Clock className="w-12 h-12 text-slate-600 mb-3" />
              <h3 className="text-sm font-bold text-slate-300">Aucun historique TV</h3>
              <p className="text-xs text-slate-500 mt-1">
                Les chaînes de télévision que vous regardez apparaîtront ici.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {history.map(({ channel, timestamp }, idx) => (
                <div
                  key={`${channel.id}-${timestamp}-${idx}`}
                  onClick={() => handlePlayChannel(channel)}
                  className="p-4 rounded-3xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-indigo-400/50 backdrop-blur-xl transition-all cursor-pointer flex items-center justify-between gap-3 shadow-lg group"
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
                      <div className="text-xs font-bold text-white truncate group-hover:text-indigo-300 transition">{channel.name}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{channel.category}</div>
                      <div className="text-[10px] text-indigo-300 font-mono mt-0.5">
                        {new Date(timestamp).toLocaleDateString('fr-FR')} • {new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>

                  <button className="p-3 rounded-full bg-indigo-500 group-hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 transition shrink-0">
                    <Play className="w-4 h-4 fill-white ml-0.5" />
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          vodHistory.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center">
              <Film className="w-12 h-12 text-slate-600 mb-3 animate-pulse" />
              <h3 className="text-sm font-bold text-slate-300">Aucun film ou série récent</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
                Les films et les séries que vous commencez apparaîtront ici. Vous pourrez reprendre exactement là où vous vous étiez arrêté.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {vodHistory.map((item) => {
                const percent = item.duration > 0 ? Math.min(100, Math.floor((item.progress / item.duration) * 100)) : 0;
                const isMovie = item.itemType === 'movie';
                const isItemLoading = loadingId === item.id;

                return (
                  <div
                    key={item.id}
                    onClick={() => !isItemLoading && handlePlayVodHistory(item)}
                    className="p-4 rounded-3xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-indigo-400/50 backdrop-blur-xl transition-all cursor-pointer flex flex-col justify-between gap-3 shadow-lg group relative overflow-hidden"
                  >
                    <div className="flex items-start gap-4">
                      {/* Image Thumbnail */}
                      <div className="w-16 h-24 rounded-2xl bg-black/40 overflow-hidden border border-white/10 flex items-center justify-center shrink-0 shadow-md relative">
                        {item.poster ? (
                          <img
                            src={item.poster}
                            alt={item.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <Film className="w-6 h-6 text-slate-600" />
                        )}
                        <div className="absolute top-1 left-1.5 bg-black/70 px-1.5 py-0.5 rounded text-[8px] font-bold text-slate-300 uppercase tracking-wider border border-white/10">
                          {isMovie ? 'Film' : 'Série'}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold text-white truncate group-hover:text-indigo-300 transition" title={item.title}>
                          {item.title}
                        </div>
                        
                        {!isMovie && (
                          <div className="text-[10px] text-indigo-300 font-semibold mt-1 truncate">
                            S{item.seasonNumber} Ep{item.episodeNumber} : {item.episodeTitle || 'Épisode'}
                          </div>
                        )}
                        
                        <div className="text-[10px] text-slate-400 mt-1 truncate">{item.category}</div>
                        
                        <div className="text-[9px] text-slate-500 font-mono mt-1">
                          Vu le {new Date(item.timestamp).toLocaleDateString('fr-FR')} à {new Date(item.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar Container */}
                    <div className="space-y-1 mt-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-400 font-medium">Progression : {percent}%</span>
                        <span className="text-indigo-300 font-mono font-medium">
                          {formatProgressTime(item.progress)} / {formatProgressTime(item.duration)}
                        </span>
                      </div>
                      
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-white/5 shadow-inner">
                        <div 
                          className={`h-full transition-all duration-500 rounded-full ${
                            item.completed ? 'bg-emerald-500' : 'bg-indigo-500 shadow-lg shadow-indigo-500/50'
                          }`}
                          style={{ width: `${percent}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Hover Play Button / Loading Indicator */}
                    <div className="absolute right-4 bottom-12 opacity-0 group-hover:opacity-100 transition duration-200">
                      {isItemLoading ? (
                        <div className="p-2.5 rounded-full bg-indigo-500 text-white shrink-0">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      ) : (
                        <div className="p-2.5 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 transition shrink-0 transform hover:scale-110">
                          <Play className="w-4 h-4 fill-white ml-0.5" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Embedded Player instance for watch history direct playback */}
      {activePlaybackVideo && (
        <VODPlayerModal
          title={activePlaybackVideo.title}
          rawStreamUrl={activePlaybackVideo.rawUrl}
          originalCmd={activePlaybackVideo.originalCmd}
          onClose={() => setActivePlaybackVideo(null)}
          itemId={activePlaybackVideo.itemId}
          itemType={activePlaybackVideo.itemType}
          episodeId={activePlaybackVideo.episodeId}
          episodeTitle={activePlaybackVideo.episodeTitle}
          seasonNumber={activePlaybackVideo.seasonNumber}
          episodeNumber={activePlaybackVideo.episodeNumber}
          poster={activePlaybackVideo.poster}
          backdrop={activePlaybackVideo.backdrop}
          category={activePlaybackVideo.category}
        />
      )}
    </div>
  );
};
