import React, { useState, useMemo, useEffect } from 'react';
import { 
  Film, 
  Clapperboard, 
  Search, 
  Play, 
  Lock
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { VODItem, TVSeries, TVSeriesEpisode } from '../types/iptv';

export const VODSection: React.FC<{ type?: 'vod' | 'series' }> = ({ type = 'vod' }) => {
  const { 
    vodMovies, 
    seriesList, 
    isSessionUnlocked, 
    requestPinForAction
  } = useIPTV();

  const [activeTab, setActiveTab] = useState<'vod' | 'series'>(type);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMovie, setSelectedMovie] = useState<VODItem | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<TVSeries | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [activePlaybackVideo, setActivePlaybackVideo] = useState<{ title: string; url: string } | null>(null);
  const [visibleLimit, setVisibleLimit] = useState<number>(48);

  useEffect(() => {
    setVisibleLimit(48);
  }, [searchQuery, activeTab]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 400) {
      setVisibleLimit((prev) => prev + 48);
    }
  };

  const getGenreArray = (genre: any): string[] => {
    if (Array.isArray(genre)) return genre.filter(Boolean);
    if (typeof genre === 'string' && genre.trim()) return genre.split(',').map(s => s.trim());
    return ['Général'];
  };

  const filteredMovies = useMemo(() => {
    const list = vodMovies || [];
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((m) => {
      if (!m) return false;
      const title = m.title || '';
      const genres = getGenreArray(m.genre);
      return title.toLowerCase().includes(q) || genres.some(g => g.toLowerCase().includes(q));
    });
  }, [vodMovies, searchQuery]);

  const filteredSeries = useMemo(() => {
    const list = seriesList || [];
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((s) => {
      if (!s) return false;
      const title = s.title || '';
      const genres = getGenreArray(s.genre);
      return title.toLowerCase().includes(q) || genres.some(g => g.toLowerCase().includes(q));
    });
  }, [seriesList, searchQuery]);

  const visibleMovies = useMemo(() => filteredMovies.slice(0, visibleLimit), [filteredMovies, visibleLimit]);
  const visibleSeries = useMemo(() => filteredSeries.slice(0, visibleLimit), [filteredSeries, visibleLimit]);

  const handlePlayMovie = (movie: VODItem) => {
    if (movie.isLocked && !isSessionUnlocked) {
      requestPinForAction(() => {
        setActivePlaybackVideo({ title: movie.title, url: movie.streamUrl });
      }, `Film verrouillé : ${movie.title}`);
      return;
    }
    setActivePlaybackVideo({ title: movie.title, url: movie.streamUrl });
  };

  const handlePlayEpisode = (series: TVSeries, ep: TVSeriesEpisode) => {
    if (series.isLocked && !isSessionUnlocked) {
      requestPinForAction(() => {
        setActivePlaybackVideo({ title: `${series.title} - ${ep.title}`, url: ep.streamUrl });
      }, `Épisode verrouillé`);
      return;
    }
    setActivePlaybackVideo({ title: `${series.title} - ${ep.title}`, url: ep.streamUrl });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent text-slate-100 overflow-hidden select-none">
      {/* Top Header & Tab Switcher (Frosted Glass) */}
      <div className="p-6 bg-white/[0.03] backdrop-blur-2xl border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex bg-white/5 p-1 rounded-full border border-white/10">
            <button
              onClick={() => { setActiveTab('vod'); setSelectedSeries(null); }}
              className={`px-5 py-2 rounded-full text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'vod'
                  ? 'bg-white/15 text-white border border-white/20 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Film className="w-4 h-4 text-indigo-400" />
              Films VOD ({vodMovies.length})
            </button>
            <button
              onClick={() => { setActiveTab('series'); setSelectedMovie(null); }}
              className={`px-5 py-2 rounded-full text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'series'
                  ? 'bg-white/15 text-white border border-white/20 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Clapperboard className="w-4 h-4 text-indigo-400" />
              Séries TV ({seriesList.length})
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative w-72 bg-white/5 border border-white/10 rounded-full px-4 py-2 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder={activeTab === 'vod' ? 'Rechercher un film...' : 'Rechercher une série...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent border-none outline-none text-xs text-white placeholder-slate-400"
          />
        </div>
      </div>

      {/* Main Content Area */}
      <div onScroll={handleScroll} className="flex-1 overflow-y-auto p-6 md:p-8">
        {activeTab === 'vod' ? (
          /* MOVIES GRID */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
            {visibleMovies.map((movie) => (
              <div
                key={movie.id}
                onClick={() => setSelectedMovie(movie)}
                className="group bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden hover:border-indigo-400/50 hover:bg-white/[0.08] hover:shadow-2xl transition-all cursor-pointer flex flex-col"
              >
                {/* Poster */}
                <div className="relative aspect-[2/3] bg-black/40 overflow-hidden">
                  <img
                    src={movie.poster}
                    alt={movie.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    referrerPolicy="no-referrer"
                  />
                  {/* Rating badge */}
                  <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold text-amber-400 border border-white/10">
                    ★ {movie.rating}
                  </span>

                  {movie.isLocked && !isSessionUnlocked && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-3 text-center">
                      <Lock className="w-8 h-8 text-red-400 mb-1" />
                      <span className="text-[11px] font-bold text-red-300">Contenu +18</span>
                    </div>
                  )}

                  {/* Play Hover Overlay */}
                  <div className="absolute inset-0 bg-indigo-950/40 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow-xl shadow-indigo-500/50">
                      <Play className="w-5 h-5 fill-white ml-0.5" />
                    </div>
                  </div>
                </div>

                {/* Info */}
                <div className="p-3.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-white group-hover:text-indigo-300 transition truncate">
                      {movie.title}
                    </h3>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-1">
                      <span>{movie.releaseYear}</span>
                      <span>•</span>
                      <span>{movie.duration}</span>
                    </div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[10px]">
                    <span className="text-slate-400 truncate">{getGenreArray(movie.genre)[0] || 'Général'}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayMovie(movie);
                      }}
                      className="px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500 hover:text-white font-bold transition"
                    >
                      Lire
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* SERIES GRID */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
            {visibleSeries.map((series) => (
              <div
                key={series.id}
                onClick={() => {
                  setSelectedSeries(series);
                  setSelectedSeason(1);
                }}
                className="group bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden hover:border-indigo-400/50 hover:bg-white/[0.08] hover:shadow-2xl transition-all cursor-pointer flex flex-col"
              >
                {/* Poster */}
                <div className="relative aspect-[2/3] bg-black/40 overflow-hidden">
                  <img
                    src={series.poster}
                    alt={series.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    referrerPolicy="no-referrer"
                  />
                  <span className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold text-indigo-300 border border-white/10">
                    {series.totalSeasons} {series.totalSeasons > 1 ? 'Saisons' : 'Saison'}
                  </span>
                </div>

                {/* Info */}
                <div className="p-3.5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-white group-hover:text-indigo-300 transition truncate">
                      {series.title}
                    </h3>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-1">
                      <span>{series.releaseYear}</span>
                      <span>•</span>
                      <span>★ {series.rating}</span>
                    </div>
                  </div>
                  <div className="mt-2.5 text-[10px] text-slate-400 truncate">
                    {getGenreArray(series.genre).join(', ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Movie Details Modal (Frosted Glass) */}
      {selectedMovie && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-950/80 backdrop-blur-3xl border border-white/15 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="relative h-64 bg-black/40 overflow-hidden">
              <img
                src={selectedMovie.backdrop || selectedMovie.poster}
                alt={selectedMovie.title}
                className="w-full h-full object-cover opacity-60"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent p-6 flex flex-col justify-between">
                <button
                  onClick={() => setSelectedMovie(null)}
                  className="self-end w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
                >
                  ✕
                </button>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold">
                      {selectedMovie.releaseYear}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold">
                      ★ {selectedMovie.rating}
                    </span>
                    <span className="text-xs text-slate-300">{selectedMovie.duration}</span>
                  </div>
                  <h2 className="text-2xl font-extrabold text-white tracking-tight">{selectedMovie.title}</h2>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">{selectedMovie.overview}</p>
              <div className="flex flex-wrap gap-2">
                {getGenreArray(selectedMovie.genre).map((g) => (
                  <span key={g} className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300 text-[11px]">
                    {g}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-4 border-t border-white/10">
                <button
                  onClick={() => {
                    handlePlayMovie(selectedMovie);
                    setSelectedMovie(null);
                  }}
                  className="flex-1 py-3 px-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-white" />
                  Lancer la lecture du Film
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Series Season/Episode Modal (Frosted Glass) */}
      {selectedSeries && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-950/80 backdrop-blur-3xl border border-white/15 rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-white">{selectedSeries.title}</h2>
                <div className="text-xs text-slate-400 mt-0.5">{selectedSeries.overview}</div>
              </div>
              <button
                onClick={() => setSelectedSeries(null)}
                className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition"
              >
                ✕
              </button>
            </div>

            {/* Season Selector Tabs */}
            <div className="px-6 py-3 bg-white/[0.02] flex items-center gap-2 border-b border-white/10 overflow-x-auto">
              {(selectedSeries.seasons || []).map((s) => (
                <button
                  key={s.seasonNumber}
                  onClick={() => setSelectedSeason(s.seasonNumber)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                    selectedSeason === s.seasonNumber
                      ? 'bg-indigo-500 text-white'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  Saison {s.seasonNumber}
                </button>
              ))}
            </div>

            {/* Episode List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-2.5">
              {((selectedSeries.seasons || []).find((s) => s.seasonNumber === selectedSeason)?.episodes || []).map((ep) => (
                  <div
                    key={ep.id}
                    onClick={() => {
                      handlePlayEpisode(selectedSeries, ep);
                      setSelectedSeries(null);
                    }}
                    className="p-3.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-2xl flex items-center justify-between transition cursor-pointer backdrop-blur-md"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-300 font-extrabold text-xs flex items-center justify-center border border-indigo-500/30">
                        {ep.episodeNumber}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">{ep.title}</h4>
                        <span className="text-[10px] text-slate-400">{ep.duration}</span>
                      </div>
                    </div>

                    <button className="p-2 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white transition shadow-md shadow-indigo-500/25">
                      <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Standalone Video Modal */}
      {activePlaybackVideo && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between">
          <div className="p-4 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-between z-10">
            <h3 className="text-sm font-bold text-white">{activePlaybackVideo.title}</h3>
            <button
              onClick={() => setActivePlaybackVideo(null)}
              className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold"
            >
              Fermer le lecteur (✕)
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <video
              src={activePlaybackVideo.url}
              controls
              autoPlay
              className="max-w-full max-h-full rounded-3xl shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};
