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
  Tv,
  RotateCw
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { VODItem, TVSeries, TVSeriesEpisode } from '../types/iptv';
import { openInDevicePlayer, buildAbsoluteStreamUrl } from '../utils/devicePlayer';
import { VODPlayerModal } from './VODPlayerModal';

export const VODSection: React.FC<{ type?: 'vod' | 'series' }> = ({ type = 'vod' }) => {
  const { 
    vodMovies, 
    seriesList, 
    vodMovieCategories,
    vodSeriesCategories,
    isSessionUnlocked, 
    requestPinForAction,
    playerSettings,
    activeServer,
    resolveVodStreamUrl,
    getSeriesDetails,
    getSeasonEpisodes
  } = useIPTV();

  const [activeTab, setActiveTab] = useState<'vod' | 'series'>(type);
  const [selectedCategory, setSelectedCategory] = useState<string>('Tous');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMovie, setSelectedMovie] = useState<VODItem | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<TVSeries | null>(null);
  const [seriesSeasons, setSeriesSeasons] = useState<any[]>([]);
  const [seriesLoadingStatus, setSeriesLoadingStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  type NavigationState = 'SERIES_IDLE' | 'SEASONS_LOADING' | 'SEASONS_READY' | 'EPISODES_LOADING' | 'EPISODES_READY' | 'PLAYBACK_STARTING' | 'PLAYING';
  const [navState, setNavState] = useState<NavigationState>('SERIES_IDLE');
  const [seriesDiagnosticLog, setSeriesDiagnosticLog] = useState<string>('');
  const [seriesErrorMsg, setSeriesErrorMsg] = useState<string>('');
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
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
  const [visibleLimit, setVisibleLimit] = useState<number>(48);

  const loadSeriesDetails = async (series: TVSeries, forceRefresh = false) => {
    setSelectedSeries(series);
    setSeriesLoadingStatus('loading');
    setNavState('SEASONS_LOADING');
    setSeriesSeasons([]);
    setSeriesErrorMsg('');
    const cleanId = series.id.replace(/^stalker-series-/, '');
    const currentSeasonCount = series.totalSeasons > 0 ? series.totalSeasons : '--';

    setSeriesDiagnosticLog(
      `===== SERIES NAVIGATION =====\n\nSeries ID: ${cleanId}\nSeries title: ${series.title}\nSeason count: ${currentSeasonCount}\nSelected season: NONE\nEpisodes loaded: 0\nSeason click: NONE\ncreate_link calls after season click: 0\nSelected episode: NONE\n\nSTATUS: SEASONS_LOADING...`
    );

    try {
      const res = await getSeriesDetails(series, forceRefresh);
      if (res.success && res.seasons && res.seasons.length > 0) {
        setSeriesSeasons(res.seasons);
        setSelectedSeries((prev) => prev ? { ...prev, totalSeasons: res.seasons.length, seasons: res.seasons } : null);
        setSeriesLoadingStatus('loaded');
        const firstSeasonNum = res.seasons[0]?.seasonNumber ?? 1;
        
        // Lazy-load the first season episodes upon opening
        await handleSeasonSelect(firstSeasonNum, res.seasons, series);
      } else {
        setSeriesLoadingStatus('error');
        setNavState('SERIES_IDLE');
        setSeriesErrorMsg(res.error || 'Impossible de récupérer les épisodes.');
        setSeriesDiagnosticLog(`===== SERIES NAVIGATION =====\n\nSeries ID: ${cleanId}\nSeries title: ${series.title}\n\nSTATUS: ERROR (${res.error || 'Aucun épisode'})`);
      }
    } catch (err) {
      setSeriesLoadingStatus('error');
      setNavState('SERIES_IDLE');
      setSeriesErrorMsg('Impossible de récupérer les épisodes.');
      setSeriesDiagnosticLog(`===== SERIES NAVIGATION =====\n\nSeries ID: ${cleanId}\nSeries title: ${series.title}\n\nSTATUS: ERROR`);
    }
  };

  const handleSeasonSelect = async (
    seasonNum: number,
    currentSeasonsList = seriesSeasons,
    currentSeries = selectedSeries,
    forceRefresh = false
  ) => {
    setSelectedSeason(seasonNum);
    setNavState('EPISODES_READY');

    const cleanId = currentSeries?.id.replace(/^stalker-series-/, '') || '';
    let currentSeason = currentSeasonsList.find((s) => s.seasonNumber === seasonNum);
    let episodesCount = currentSeason?.episodes?.length || 0;
    let extraRawDebug = '';

    const needsLoad = forceRefresh || !currentSeason || !currentSeason.episodes || currentSeason.episodes.length <= 1;

    if (needsLoad && currentSeries && activeServer?.type === 'stalker') {
      setNavState('EPISODES_LOADING');
      try {
        const seasonItem = (currentSeason as any)?.rawSeasonItem;
        const result = await getSeasonEpisodes(currentSeries, seasonNum, seasonItem, forceRefresh);

        if (result.episodes && result.episodes.length > 0) {
          setSeriesSeasons((prev) =>
            prev.map((s) => (s.seasonNumber === seasonNum ? { ...s, episodes: result.episodes } : s))
          );
          episodesCount = result.episodes.length;
        }
        extraRawDebug = result.rawDebug ? `\n\n${result.rawDebug}` : '';
      } catch (err) {
        console.warn('[VODSection] Error fetching season episodes on demand:', err);
      }
      setNavState('EPISODES_READY');
    }

    setSeriesDiagnosticLog(
      `===== SERIES NAVIGATION =====\n\nSeries ID: ${cleanId}\nSeason count: ${currentSeasonsList.length}\nSelected season: ${seasonNum}\nEpisodes loaded: ${episodesCount}\nSeason click: DISPLAY_EPISODES\ncreate_link calls after season click: 0\nSelected episode: NONE\n\nSTATUS: EPISODES_READY${extraRawDebug}`
    );
  };

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

    const orderedNames: string[] = [];
    if (vodMovieCategories && vodMovieCategories.length > 0) {
      vodMovieCategories.forEach((cat) => {
        if (map.has(cat) && !orderedNames.includes(cat)) {
          orderedNames.push(cat);
        }
      });
    }

    for (const cat of map.keys()) {
      if (!orderedNames.includes(cat)) {
        orderedNames.push(cat);
      }
    }

    return orderedNames.map((name) => ({ name, count: map.get(name) || 0 }));
  }, [vodMovies, vodMovieCategories]);

  const seriesCategories = useMemo(() => {
    const map = new Map<string, number>();
    (seriesList || []).forEach((s) => {
      const cat = s.category || 'Séries TV';
      map.set(cat, (map.get(cat) || 0) + 1);
    });

    const orderedNames: string[] = [];
    if (vodSeriesCategories && vodSeriesCategories.length > 0) {
      vodSeriesCategories.forEach((cat) => {
        if (map.has(cat) && !orderedNames.includes(cat)) {
          orderedNames.push(cat);
        }
      });
    }

    for (const cat of map.keys()) {
      if (!orderedNames.includes(cat)) {
        orderedNames.push(cat);
      }
    }

    return orderedNames.map((name) => ({ name, count: map.get(name) || 0 }));
  }, [seriesList, vodSeriesCategories]);

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

    const orderedCategories: string[] = [];
    if (vodMovieCategories && vodMovieCategories.length > 0) {
      vodMovieCategories.forEach((cat) => {
        if (map.has(cat) && !orderedCategories.includes(cat)) {
          orderedCategories.push(cat);
        }
      });
    }
    for (const cat of map.keys()) {
      if (!orderedCategories.includes(cat)) {
        orderedCategories.push(cat);
      }
    }

    return orderedCategories.map((category) => ({
      category,
      items: map.get(category) || [],
    }));
  }, [vodMovies, vodMovieCategories, selectedCategory, searchQuery]);

  const seriesGroups = useMemo(() => {
    if (selectedCategory !== 'Tous' || searchQuery) return null;
    const map = new Map<string, TVSeries[]>();
    (seriesList || []).forEach((s) => {
      const cat = s.category || 'Séries TV';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(s);
    });

    const orderedCategories: string[] = [];
    if (vodSeriesCategories && vodSeriesCategories.length > 0) {
      vodSeriesCategories.forEach((cat) => {
        if (map.has(cat) && !orderedCategories.includes(cat)) {
          orderedCategories.push(cat);
        }
      });
    }
    for (const cat of map.keys()) {
      if (!orderedCategories.includes(cat)) {
        orderedCategories.push(cat);
      }
    }

    return orderedCategories.map((category) => ({
      category,
      items: map.get(category) || [],
    }));
  }, [seriesList, vodSeriesCategories, selectedCategory, searchQuery]);

  const handleOpenInDevicePlayer = async (rawUrl: string, title: string, playerType: 'generic' | 'vlc' | 'mx' | 'just' | 'tab' = 'generic', contentType: 'movie' | 'series' = 'movie') => {
    const resolvedUrl = await resolveVodStreamUrl(rawUrl, contentType);
    openInDevicePlayer(resolvedUrl, title, playerType);
  };

  const handlePlayMovie = async (movie: VODItem, useRemux: boolean = false, forceDevicePlayer: boolean = false) => {
    const rawTarget = movie.cmd || movie.streamUrl;
    const playAction = async () => {
      const targetUrl = await resolveVodStreamUrl(rawTarget, 'movie');
      if (forceDevicePlayer || playerSettings?.useDevicePlayerForVod) {
        handleOpenInDevicePlayer(targetUrl, movie.title, 'generic', 'movie');
      } else {
        setActivePlaybackVideo({
          title: movie.title,
          rawUrl: targetUrl,
          useRemux,
          originalCmd: rawTarget,
          itemId: movie.id,
          itemType: 'movie',
          poster: movie.poster,
          backdrop: movie.backdrop,
          category: movie.category
        });
      }
    };

    if (movie.isLocked && !isSessionUnlocked) {
      requestPinForAction(() => {
        playAction();
      }, `Film verrouillé : ${movie.title}`);
      return;
    }
    playAction();
  };

  const handlePlayEpisode = async (series: TVSeries, ep: TVSeriesEpisode, useRemux: boolean = false, forceDevicePlayer: boolean = false) => {
    setNavState('PLAYBACK_STARTING');
    const cleanId = series.id.replace(/^stalker-series-/, '');
    const currentSeason = seriesSeasons.find((s) => s.seasonNumber === (ep.seasonNumber || selectedSeason));
    const episodesCount = currentSeason?.episodes?.length || 0;
    const rawTarget = (ep as any).cmd || ep.streamUrl;
    const seriesExtra = (ep as any).series || '';

    setSeriesDiagnosticLog(
      `===== SERIES NAVIGATION =====\n\nSeries ID: ${cleanId}\nSeason count: ${seriesSeasons.length}\nSelected season: ${ep.seasonNumber || selectedSeason}\nEpisodes loaded: ${episodesCount}\nSeason click: DISPLAY_EPISODES\nSelected episode: ${ep.episodeNumber}\ncreate_link: PENDING...\nPlayback: STARTING`
    );

    const episodeInfo = {
      seriesTitle: series.title,
      seasonNumber: ep.seasonNumber || selectedSeason,
      episodeNumber: ep.episodeNumber,
    };

    const playAction = async () => {
      try {
        const targetUrl = await resolveVodStreamUrl(rawTarget, 'series', seriesExtra, episodeInfo);
        const isSuccess = Boolean(targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')));

        setSeriesDiagnosticLog(
          `===== SERIES NAVIGATION =====\n\nSeries ID: ${cleanId}\nSeason count: ${seriesSeasons.length}\nSelected season: ${ep.seasonNumber || selectedSeason}\nEpisodes loaded: ${episodesCount}\nSeason click: DISPLAY_EPISODES\nSelected episode: ${ep.episodeNumber}\ncreate_link: ${isSuccess ? 'SUCCESS' : 'FAILED'}\nPlayback: STARTED`
        );

        setNavState('PLAYING');

        if (series.isLocked && !isSessionUnlocked) {
          requestPinForAction(() => {
            if (forceDevicePlayer || playerSettings?.useDevicePlayerForVod) {
              handleOpenInDevicePlayer(targetUrl, `${series.title} - ${ep.title}`, 'generic', 'series');
            } else {
              setActivePlaybackVideo({
                title: `${series.title} - ${ep.title}`,
                rawUrl: targetUrl,
                useRemux,
                originalCmd: rawTarget,
                itemId: series.id,
                itemType: 'series',
                episodeId: ep.id,
                episodeTitle: ep.title,
                seasonNumber: ep.seasonNumber || selectedSeason,
                episodeNumber: ep.episodeNumber,
                poster: ep.thumbnail || series.poster,
                backdrop: series.backdrop,
                category: series.category
              });
            }
          }, `Épisode verrouillé`);
          return;
        }

        if (forceDevicePlayer || playerSettings?.useDevicePlayerForVod) {
          handleOpenInDevicePlayer(targetUrl, `${series.title} - ${ep.title}`, 'generic', 'series');
        } else {
          setActivePlaybackVideo({
            title: `${series.title} - ${ep.title}`,
            rawUrl: targetUrl,
            useRemux,
            originalCmd: rawTarget,
            itemId: series.id,
            itemType: 'series',
            episodeId: ep.id,
            episodeTitle: ep.title,
            seasonNumber: ep.seasonNumber || selectedSeason,
            episodeNumber: ep.episodeNumber,
            poster: ep.thumbnail || series.poster,
            backdrop: series.backdrop,
            category: series.category
          });
        }
      } catch (err) {
        setNavState('EPISODES_READY');
        setSeriesDiagnosticLog(
          `===== SERIES NAVIGATION =====\n\nSeries ID: ${cleanId}\nSeason count: ${seriesSeasons.length}\nSelected season: ${ep.seasonNumber || selectedSeason}\nEpisodes loaded: ${episodesCount}\nSeason click: DISPLAY_EPISODES\nSelected episode: ${ep.episodeNumber}\ncreate_link: FAILED\nPlayback: ERROR`
        );
      }
    };

    playAction();
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
                        onClick={() => loadSeriesDetails(series)}
                        className="group bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden hover:border-indigo-400/50 hover:bg-white/[0.08] hover:shadow-2xl transition-all cursor-pointer flex flex-col"
                      >
                        <div className="relative aspect-[2/3] bg-black/40 overflow-hidden">
                          <img
                            src={series.poster}
                            alt={series.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            referrerPolicy="no-referrer"
                          />
                          <span className="absolute top-2 left-2 px-2.5 py-0.5 rounded-full bg-black/70 backdrop-blur-md text-[10px] font-bold text-indigo-300 border border-white/10 shadow-md">
                            {series.totalSeasons && series.totalSeasons > 0 
                              ? `${series.totalSeasons} ${series.totalSeasons > 1 ? 'saisons' : 'saison'}` 
                              : 'Saisons : --'}
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
                  onClick={() => loadSeriesDetails(series)}
                  className="group bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden hover:border-indigo-400/50 hover:bg-white/[0.08] hover:shadow-2xl transition-all cursor-pointer flex flex-col"
                >
                  <div className="relative aspect-[2/3] bg-black/40 overflow-hidden">
                    <img
                      src={series.poster}
                      alt={series.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      referrerPolicy="no-referrer"
                    />
                    <span className="absolute top-2 left-2 px-2.5 py-0.5 rounded-full bg-black/70 backdrop-blur-md text-[10px] font-bold text-indigo-300 border border-white/10 shadow-md">
                      {series.totalSeasons && series.totalSeasons > 0 
                        ? `${series.totalSeasons} ${series.totalSeasons > 1 ? 'saisons' : 'saison'}` 
                        : 'Saisons : --'}
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
          <div className="bg-slate-950/90 backdrop-blur-3xl border border-white/15 rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-white/10 flex items-start justify-between gap-4">
              <div className="flex gap-4">
                <img
                  src={selectedSeries.poster}
                  alt={selectedSeries.title}
                  className="w-16 h-24 object-cover rounded-xl border border-white/10 shadow-lg shrink-0 hidden sm:block"
                  referrerPolicy="no-referrer"
                />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold">
                      {seriesSeasons.length > 0
                        ? `${seriesSeasons.length} ${seriesSeasons.length > 1 ? 'saisons' : 'saison'}`
                        : selectedSeries.totalSeasons && selectedSeries.totalSeasons > 0
                        ? `${selectedSeries.totalSeasons} ${selectedSeries.totalSeasons > 1 ? 'saisons' : 'saison'}`
                        : 'Saisons : --'}
                    </span>
                    <span className="text-xs text-slate-400">{selectedSeries.releaseYear}</span>
                    <span className="text-xs text-slate-400">•</span>
                    <span className="text-xs text-amber-400 font-semibold">★ {selectedSeries.rating}</span>
                  </div>
                  <h2 className="text-xl font-extrabold text-white">{selectedSeries.title}</h2>
                  <div className="text-xs text-slate-300 mt-1 max-line-clamp-2 leading-relaxed">
                    {selectedSeries.overview || 'Informations de la série'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedSeries(null);
                  setSeriesLoadingStatus('idle');
                  setNavState('SERIES_IDLE');
                }}
                className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>

            {/* Loading State */}
            {seriesLoadingStatus === 'loading' && (
              <div className="p-12 flex flex-col items-center justify-center space-y-4 text-center my-auto">
                <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <div className="text-sm font-bold text-indigo-300">Chargement des saisons et épisodes...</div>
                <div className="text-xs text-slate-400">Récupération des épisodes de la série</div>
              </div>
            )}

            {/* Error State */}
            {seriesLoadingStatus === 'error' && (
              <div className="p-10 flex flex-col items-center justify-center space-y-4 text-center my-auto">
                <div className="text-red-400 font-extrabold text-sm">{seriesErrorMsg || 'Impossible de récupérer les épisodes.'}</div>
                <div className="text-xs text-slate-400 max-w-md">Le serveur n'a pas pu renvoyer les épisodes. Les autres séries restent intactes.</div>
                <button
                  onClick={() => loadSeriesDetails(selectedSeries, true)}
                  className="px-5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-xs shadow-lg shadow-indigo-500/30 transition cursor-pointer"
                >
                  Réessayer
                </button>
              </div>
            )}

            {/* Loaded State */}
            {seriesLoadingStatus === 'loaded' && (
              <>
                {/* Season Selector Tabs */}
                <div className="px-6 py-3 bg-white/[0.02] flex items-center gap-2 border-b border-white/10 overflow-x-auto">
                  {seriesSeasons.map((s) => (
                    <button
                      key={s.seasonNumber}
                      onClick={() => handleSeasonSelect(s.seasonNumber)}
                      className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                        selectedSeason === s.seasonNumber
                          ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                          : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {s.name || `Saison ${s.seasonNumber}`}
                    </button>
                  ))}
                </div>

                {/* Episode List */}
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  {navState === 'EPISODES_LOADING' ? (
                    <div className="p-12 flex flex-col items-center justify-center space-y-3 text-center my-auto">
                      <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <div className="text-xs font-bold text-indigo-300">Chargement des épisodes...</div>
                      <div className="text-[10px] text-slate-400">Interrogation du serveur Stalker pour la Saison {selectedSeason}</div>
                    </div>
                  ) : (
                    <>
                      {/* Episode List Header (e.g., Saison 1 • 10 épisodes) */}
                      {(() => {
                        const currentSeasonObj = seriesSeasons.find((s) => s.seasonNumber === selectedSeason);
                        const epCount = currentSeasonObj?.episodes?.length || 0;
                        return (
                          <div className="pb-3 flex items-center justify-between text-xs text-slate-400 font-semibold border-b border-white/5 gap-2">
                            <span>{currentSeasonObj?.name || `Saison ${selectedSeason}`} • {epCount} {epCount > 1 ? 'épisodes' : 'épisode'}</span>
                            {activeServer?.type === 'stalker' && (
                              <button
                                onClick={() => handleSeasonSelect(selectedSeason, seriesSeasons, selectedSeries, true)}
                                className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-indigo-300 hover:text-white transition cursor-pointer shrink-0 border border-white/5"
                                title="Rafraîchir les épisodes de cette saison"
                              >
                                <RotateCw className="w-2.5 h-2.5 animate-duration-1000" />
                                <span>Rafraîchir</span>
                              </button>
                            )}
                          </div>
                        );
                      })()}

                      {(seriesSeasons.find((s) => s.seasonNumber === selectedSeason)?.episodes || []).map((ep: any) => (
                        <div
                          key={ep.id}
                          className="p-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between transition backdrop-blur-md gap-3 group"
                        >
                          <div 
                            onClick={() => {
                              handlePlayEpisode(selectedSeries, ep, false, false);
                              setSelectedSeries(null);
                            }}
                            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                          >
                            {ep.thumbnail ? (
                              <img
                                src={ep.thumbnail}
                                alt={ep.title}
                                className="w-16 h-12 object-cover rounded-xl border border-white/10 shrink-0 group-hover:scale-105 transition-transform"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-300 font-extrabold text-xs flex items-center justify-center border border-indigo-500/30 shrink-0">
                                E{ep.episodeNumber < 10 ? `0${ep.episodeNumber}` : ep.episodeNumber}
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-extrabold text-indigo-400">
                                  E{ep.episodeNumber < 10 ? `0${ep.episodeNumber}` : ep.episodeNumber}
                                </span>
                                <h4 className="text-xs font-bold text-white truncate group-hover:text-indigo-300 transition">{ep.title}</h4>
                                <span className="text-[10px] text-slate-400 ml-auto shrink-0">{ep.duration}</span>
                              </div>
                              {ep.overview && ep.overview !== 'Épisode disponible sur votre serveur Stalker.' && (
                                <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{ep.overview}</p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5">
                            <button
                              onClick={() => {
                                handlePlayEpisode(selectedSeries, ep, false, true);
                                setSelectedSeries(null);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer"
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
                              className="px-3.5 py-1.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-[11px] font-bold flex items-center gap-1.5 transition shadow-md shadow-indigo-500/25 cursor-pointer"
                              title="Lecteur Web"
                            >
                              <Play className="w-3.5 h-3.5 fill-white" />
                              <span>Regarder</span>
                            </button>
                          </div>
                        </div>
                      ))}

                      {(seriesSeasons.find((s) => s.seasonNumber === selectedSeason)?.episodes || []).length === 0 && (
                        <div className="text-center py-12 text-xs text-slate-400">
                          Aucun épisode disponible pour cette saison.
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}

            {/* Diagnostic Log Box */}
            {seriesDiagnosticLog && (
              <div className="px-6 py-3 bg-slate-950/90 border-t border-white/10 text-[11px] font-mono text-emerald-400/90 whitespace-pre-wrap overflow-x-auto max-h-36 scrollbar-thin">
                {seriesDiagnosticLog}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Native HTML5 Progressive HLS VOD Player Modal */}
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
