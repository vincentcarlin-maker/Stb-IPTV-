import React, { useState, useMemo, useEffect } from 'react';
import { 
  Film, 
  Clapperboard, 
  Search, 
  Play, 
  Lock,
  Zap,
  Folder,
  ChevronRight,
  Sparkles,
  ExternalLink,
  Smartphone,
  Tv
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { VODItem, TVSeries, TVSeriesEpisode } from '../types/iptv';
import { openInDevicePlayer, buildAbsoluteStreamUrl } from '../utils/devicePlayer';

export const VODSection: React.FC<{ type?: 'vod' | 'series' }> = ({ type = 'vod' }) => {
  const { 
    vodMovies, 
    seriesList, 
    isSessionUnlocked, 
    requestPinForAction,
    playerSettings
  } = useIPTV();

  const [activeTab, setActiveTab] = useState<'vod' | 'series'>(type);
  const [selectedCategory, setSelectedCategory] = useState<string>('Tous');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMovie, setSelectedMovie] = useState<VODItem | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<TVSeries | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [activePlaybackVideo, setActivePlaybackVideo] = useState<{ title: string; rawUrl: string; useRemux: boolean } | null>(null);
  const [visibleLimit, setVisibleLimit] = useState<number>(48);

  // Reset category & limit when tab changes
  useEffect(() => {
    setSelectedCategory('Tous');
    setVisibleLimit(48);
  }, [activeTab]);

  useEffect(() => {
    setVisibleLimit(48);
  }, [searchQuery, selectedCategory]);

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

  // Categories extracted in exact original server order
  const movieCategories = useMemo(() => {
    const map = new Map<string, number>();
    (vodMovies || []).forEach((m) => {
      const cat = m.category || 'Films VOD';
      map.set(cat, (map.get(cat) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [vodMovies]);

  const seriesCategories = useMemo(() => {
    const map = new Map<string, number>();
    (seriesList || []).forEach((s) => {
      const cat = s.category || 'Séries TV';
      map.set(cat, (map.get(cat) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [seriesList]);

  const currentCategories = activeTab === 'vod' ? movieCategories : seriesCategories;

  // Filtered movies & series
  const filteredMovies = useMemo(() => {
    let list = vodMovies || [];
    if (selectedCategory !== 'Tous') {
      list = list.filter((m) => (m.category || 'Films VOD') === selectedCategory);
    }
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((m) => {
      if (!m) return false;
      const title = m.title || '';
      const cat = m.category || '';
      const genres = getGenreArray(m.genre);
      return title.toLowerCase().includes(q) || cat.toLowerCase().includes(q) || genres.some(g => g.toLowerCase().includes(q));
    });
  }, [vodMovies, selectedCategory, searchQuery]);

  const filteredSeries = useMemo(() => {
    let list = seriesList || [];
    if (selectedCategory !== 'Tous') {
      list = list.filter((s) => (s.category || 'Séries TV') === selectedCategory);
    }
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((s) => {
      if (!s) return false;
      const title = s.title || '';
      const cat = s.category || '';
      const genres = getGenreArray(s.genre);
      return title.toLowerCase().includes(q) || cat.toLowerCase().includes(q) || genres.some(g => g.toLowerCase().includes(q));
    });
  }, [seriesList, selectedCategory, searchQuery]);

  const visibleMovies = useMemo(() => filteredMovies.slice(0, visibleLimit), [filteredMovies, visibleLimit]);
  const visibleSeries = useMemo(() => filteredSeries.slice(0, visibleLimit), [filteredSeries, visibleLimit]);

  // Grouped items by Server Category (when 'Tous' is selected and no active search)
  const movieGroups = useMemo(() => {
    if (selectedCategory !== 'Tous' || searchQuery) return null;
    const map = new Map<string, VODItem[]>();
    (vodMovies || []).forEach((m) => {
      const cat = m.category || 'Films VOD';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(m);
    });
    return Array.from(map.entries()).map(([category, items]) => ({
      category,
      items,
    }));
  }, [vodMovies, selectedCategory, searchQuery]);

  const seriesGroups = useMemo(() => {
    if (selectedCategory !== 'Tous' || searchQuery) return null;
    const map = new Map<string, TVSeries[]>();
    (seriesList || []).forEach((s) => {
      const cat = s.category || 'Séries TV';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(s);
    });
    return Array.from(map.entries()).map(([category, items]) => ({
      category,
      items,
    }));
  }, [seriesList, selectedCategory, searchQuery]);

  const handleOpenInDevicePlayer = (rawUrl: string, title: string, playerType: 'generic' | 'vlc' | 'mx' | 'just' | 'tab' = 'generic') => {
    openInDevicePlayer(rawUrl, title, playerType);
  };

  const handlePlayMovie = (movie: VODItem, useRemux: boolean = false, forceDevicePlayer: boolean = false) => {
    if (movie.isLocked && !isSessionUnlocked) {
      requestPinForAction(() => {
        if (forceDevicePlayer || playerSettings?.useDevicePlayerForVod) {
          handleOpenInDevicePlayer(movie.streamUrl, movie.title);
        } else {
          setActivePlaybackVideo({ title: movie.title, rawUrl: movie.streamUrl, useRemux });
        }
      }, `Film verrouillé : ${movie.title}`);
      return;
    }
    if (forceDevicePlayer || playerSettings?.useDevicePlayerForVod) {
      handleOpenInDevicePlayer(movie.streamUrl, movie.title);
    } else {
      setActivePlaybackVideo({ title: movie.title, rawUrl: movie.streamUrl, useRemux });
    }
  };

  const handlePlayEpisode = (series: TVSeries, ep: TVSeriesEpisode, useRemux: boolean = false, forceDevicePlayer: boolean = false) => {
    if (series.isLocked && !isSessionUnlocked) {
      requestPinForAction(() => {
        if (forceDevicePlayer || playerSettings?.useDevicePlayerForVod) {
          handleOpenInDevicePlayer(ep.streamUrl, `${series.title} - ${ep.title}`);
        } else {
          setActivePlaybackVideo({ title: `${series.title} - ${ep.title}`, rawUrl: ep.streamUrl, useRemux });
        }
      }, `Épisode verrouillé`);
      return;
    }
    if (forceDevicePlayer || playerSettings?.useDevicePlayerForVod) {
      handleOpenInDevicePlayer(ep.streamUrl, `${series.title} - ${ep.title}`);
    } else {
      setActivePlaybackVideo({ title: `${series.title} - ${ep.title}`, rawUrl: ep.streamUrl, useRemux });
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent text-slate-100 overflow-hidden select-none">
      {/* Top Header & Tab Switcher */}
      <div className="p-4 md:p-6 bg-white/[0.03] backdrop-blur-2xl border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
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
        <div className="relative w-full sm:w-72 bg-white/5 border border-white/10 rounded-full px-4 py-2 flex items-center gap-2">
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

      {/* Server Category Selector Bar */}
      {currentCategories.length > 0 && (
        <div className="px-4 py-2.5 bg-black/30 border-b border-white/5 flex items-center gap-2 overflow-x-auto scrollbar-none">
          <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1 shrink-0 mr-1 pl-2">
            <Folder className="w-3.5 h-3.5 text-indigo-400" />
            Catégories Serveur :
          </span>

          <button
            onClick={() => setSelectedCategory('Tous')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
              selectedCategory === 'Tous'
                ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
            }`}
          >
            Toutes les catégories
            <span className="px-1.5 py-0.2 rounded-full bg-black/40 text-[10px] opacity-80">
              {activeTab === 'vod' ? vodMovies.length : seriesList.length}
            </span>
          </button>

          {currentCategories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setSelectedCategory(cat.name)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 border ${
                selectedCategory === cat.name
                  ? 'bg-indigo-500 text-white border-indigo-400 shadow-lg shadow-indigo-500/30'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {cat.name}
              <span className="px-1.5 py-0.2 rounded-full bg-black/40 text-[10px] opacity-80">
                {cat.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Main Content Area */}
      <div onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8">
        {activeTab === 'vod' ? (
          /* MOVIES CONTENT */
          movieGroups ? (
            /* GROUPED BY SERVER CATEGORY */
            <div className="space-y-10">
              {movieGroups.map((group) => (
                <div key={group.category} className="space-y-4">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-5 rounded-full bg-indigo-500" />
                      <h2 className="text-base font-extrabold text-white tracking-wide flex items-center gap-2">
                        {group.category}
                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-500/30">
                          {group.items.length} films
                        </span>
                      </h2>
                    </div>
                    {group.items.length > 8 && (
                      <button
                        onClick={() => setSelectedCategory(group.category)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 cursor-pointer transition"
                      >
                        Voir la catégorie ({group.items.length})
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {group.items.slice(0, 12).map((movie) => (
                      <div
                        key={movie.id}
                        onClick={() => setSelectedMovie(movie)}
                        className="group bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden hover:border-indigo-400/50 hover:bg-white/[0.08] hover:shadow-2xl transition-all cursor-pointer flex flex-col"
                      >
                        <div className="relative aspect-[2/3] bg-black/40 overflow-hidden">
                          <img
                            src={movie.poster}
                            alt={movie.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            referrerPolicy="no-referrer"
                          />
                          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold text-amber-400 border border-white/10">
                            ★ {movie.rating}
                          </span>

                          {movie.isLocked && !isSessionUnlocked && (
                            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-3 text-center">
                              <Lock className="w-8 h-8 text-red-400 mb-1" />
                              <span className="text-[11px] font-bold text-red-300">Contenu +18</span>
                            </div>
                          )}

                          <div className="absolute inset-0 bg-indigo-950/40 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <div className="w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow-xl shadow-indigo-500/50">
                              <Play className="w-4 h-4 fill-white ml-0.5" />
                            </div>
                          </div>
                        </div>

                        <div className="p-3 flex-1 flex flex-col justify-between">
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
                          <div className="mt-2 flex items-center justify-between text-[10px]">
                            <span className="text-slate-400 truncate">{movie.category}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlayMovie(movie);
                              }}
                              className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500 hover:text-white font-bold transition"
                            >
                              Lire
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* FLAT GRID FOR FILTERED / CATEGORY VIEW */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {visibleMovies.map((movie) => (
                <div
                  key={movie.id}
                  onClick={() => setSelectedMovie(movie)}
                  className="group bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden hover:border-indigo-400/50 hover:bg-white/[0.08] hover:shadow-2xl transition-all cursor-pointer flex flex-col"
                >
                  <div className="relative aspect-[2/3] bg-black/40 overflow-hidden">
                    <img
                      src={movie.poster}
                      alt={movie.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      referrerPolicy="no-referrer"
                    />
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold text-amber-400 border border-white/10">
                      ★ {movie.rating}
                    </span>

                    {movie.isLocked && !isSessionUnlocked && (
                      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-3 text-center">
                        <Lock className="w-8 h-8 text-red-400 mb-1" />
                        <span className="text-[11px] font-bold text-red-300">Contenu +18</span>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-indigo-950/40 backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow-xl shadow-indigo-500/50">
                        <Play className="w-4 h-4 fill-white ml-0.5" />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 flex-1 flex flex-col justify-between">
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
                    <div className="mt-2 flex items-center justify-between text-[10px]">
                      <span className="text-slate-400 truncate">{movie.category}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayMovie(movie);
                        }}
                        className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500 hover:text-white font-bold transition"
                      >
                        Lire
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          /* SERIES CONTENT */
          seriesGroups ? (
            /* GROUPED BY SERVER CATEGORY */
            <div className="space-y-10">
              {seriesGroups.map((group) => (
                <div key={group.category} className="space-y-4">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-5 rounded-full bg-indigo-500" />
                      <h2 className="text-base font-extrabold text-white tracking-wide flex items-center gap-2">
                        {group.category}
                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-500/30">
                          {group.items.length} séries
                        </span>
                      </h2>
                    </div>
                    {group.items.length > 8 && (
                      <button
                        onClick={() => setSelectedCategory(group.category)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 cursor-pointer transition"
                      >
                        Voir la catégorie ({group.items.length})
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {group.items.slice(0, 12).map((series) => (
                      <div
                        key={series.id}
                        onClick={() => {
                          setSelectedSeries(series);
                          setSelectedSeason(1);
                        }}
                        className="group bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden hover:border-indigo-400/50 hover:bg-white/[0.08] hover:shadow-2xl transition-all cursor-pointer flex flex-col"
                      >
                        <div className="relative aspect-[2/3] bg-black/40 overflow-hidden">
                          <img
                            src={series.poster}
                            alt={series.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            referrerPolicy="no-referrer"
                          />
                          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold text-indigo-300 border border-white/10">
                            {series.totalSeasons} {series.totalSeasons > 1 ? 'Saisons' : 'Saison'}
                          </span>
                        </div>

                        <div className="p-3 flex-1 flex flex-col justify-between">
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
                          <div className="mt-2 text-[10px] text-slate-400 truncate">
                            {series.category}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* FLAT GRID FOR FILTERED / CATEGORY VIEW */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {visibleSeries.map((series) => (
                <div
                  key={series.id}
                  onClick={() => {
                    setSelectedSeries(series);
                    setSelectedSeason(1);
                  }}
                  className="group bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden hover:border-indigo-400/50 hover:bg-white/[0.08] hover:shadow-2xl transition-all cursor-pointer flex flex-col"
                >
                  <div className="relative aspect-[2/3] bg-black/40 overflow-hidden">
                    <img
                      src={series.poster}
                      alt={series.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      referrerPolicy="no-referrer"
                    />
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] font-bold text-indigo-300 border border-white/10">
                      {series.totalSeasons} {series.totalSeasons > 1 ? 'Saisons' : 'Saison'}
                    </span>
                  </div>

                  <div className="p-3 flex-1 flex flex-col justify-between">
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
                    <div className="mt-2 text-[10px] text-slate-400 truncate">
                      {series.category}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
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

              <div className="flex flex-col sm:flex-row items-center gap-3 pt-4 border-t border-white/10">
                <button
                  onClick={() => {
                    handlePlayMovie(selectedMovie, false, false);
                    setSelectedMovie(null);
                  }}
                  className="w-full sm:flex-1 py-3 px-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-white" />
                  Lecteur Web
                </button>

                <button
                  onClick={() => {
                    handlePlayMovie(selectedMovie, false, true);
                    setSelectedMovie(null);
                  }}
                  className="w-full sm:flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition cursor-pointer"
                  title="Ouvrir avec le lecteur natif de l'appareil (VLC, MX Player, Android Intent ou navigateur)"
                >
                  <Smartphone className="w-4 h-4" />
                  Lecteur de l'Appareil (VLC / Système)
                </button>
              </div>

              {/* Quick direct player options */}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-[10px]">
                <span className="text-slate-400">Raccourcis :</span>
                <button
                  onClick={() => handleOpenInDevicePlayer(selectedMovie.streamUrl, selectedMovie.title, 'vlc')}
                  className="px-2.5 py-1 rounded-lg bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 border border-orange-500/30 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  VLC
                </button>
                <button
                  onClick={() => handleOpenInDevicePlayer(selectedMovie.streamUrl, selectedMovie.title, 'mx')}
                  className="px-2.5 py-1 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  MX Player
                </button>
                <button
                  onClick={() => handleOpenInDevicePlayer(selectedMovie.streamUrl, selectedMovie.title, 'tab')}
                  className="px-2.5 py-1 rounded-lg bg-slate-500/20 text-slate-300 hover:bg-slate-500/30 border border-slate-500/30 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  Onglet Direct
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
                    className="p-3.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-2xl flex items-center justify-between transition backdrop-blur-md gap-3"
                  >
                    <div 
                      onClick={() => {
                        handlePlayEpisode(selectedSeries, ep, false, false);
                        setSelectedSeries(null);
                      }}
                      className="flex items-center gap-3.5 flex-1 min-w-0 cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-300 font-extrabold text-xs flex items-center justify-center border border-indigo-500/30 shrink-0">
                        {ep.episodeNumber}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-white truncate">{ep.title}</h4>
                        <span className="text-[10px] text-slate-400">{ep.duration}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          handlePlayEpisode(selectedSeries, ep, false, true);
                          setSelectedSeries(null);
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                        title="Ouvrir dans le lecteur de l'appareil (VLC / MX / Intent)"
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Lecteur Appareil</span>
                      </button>

                      <button 
                        onClick={() => {
                          handlePlayEpisode(selectedSeries, ep, false, false);
                          setSelectedSeries(null);
                        }}
                        className="p-2 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white transition shadow-md shadow-indigo-500/25 cursor-pointer"
                        title="Lecteur Web"
                      >
                        <Play className="w-3.5 h-3.5 fill-white ml-0.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Standalone Video Modal */}
      {activePlaybackVideo && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between">
          <div className="p-4 bg-gradient-to-b from-black/90 via-black/70 to-transparent flex flex-wrap items-center justify-between gap-3 z-10 border-b border-white/10">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-white">{activePlaybackVideo.title}</h3>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold border border-emerald-500/30">
                {activePlaybackVideo.useRemux ? 'FFmpeg Remux Rapide (-c:v copy + AAC 192k)' : 'Lecture Directe'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenInDevicePlayer(activePlaybackVideo.rawUrl, activePlaybackVideo.title)}
                className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 transition cursor-pointer"
                title="Ouvrir dans le lecteur natif de l'appareil (VLC, MX Player, Android Intent)"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Lecteur Appareil (VLC)</span>
              </button>

              <button
                onClick={() => setActivePlaybackVideo(prev => prev ? { ...prev, useRemux: !prev.useRemux } : null)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer border ${
                  activePlaybackVideo.useRemux 
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' 
                    : 'bg-white/10 text-slate-200 border-white/20 hover:bg-white/20'
                }`}
                title="Bascule le remuxage FFmpeg en temps réel"
              >
                <Zap className="w-3.5 h-3.5" />
                {activePlaybackVideo.useRemux ? 'Remux FFmpeg Actif' : 'Remux FFmpeg'}
              </button>

              <button
                onClick={() => setActivePlaybackVideo(null)}
                className="px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition cursor-pointer border border-white/20"
              >
                Fermer (✕)
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-4 bg-black/90">
            <video
              key={`${activePlaybackVideo.rawUrl}-${activePlaybackVideo.useRemux}`}
              src={
                activePlaybackVideo.useRemux
                  ? `/api/vod/remux?url=${encodeURIComponent(activePlaybackVideo.rawUrl)}`
                  : activePlaybackVideo.rawUrl
              }
              controls
              autoPlay
              className="max-w-full max-h-full rounded-2xl shadow-2xl border border-white/10"
            />
          </div>
        </div>
      )}
    </div>
  );
};
