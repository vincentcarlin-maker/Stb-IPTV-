import React, { useState, useMemo, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { 
  Film, 
  Clapperboard, 
  Search, 
  Play, 
  Lock,
  Cpu,
  RefreshCw,
  FileText,
  Loader2
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { VODItem, TVSeries, TVSeriesEpisode } from '../types/iptv';
import { detectStreamEngine } from './LivePlayer';

interface VODPlayerModalProps {
  title: string;
  url: string;
  onClose: () => void;
}

const VODPlayerModal: React.FC<VODPlayerModalProps> = ({ title, url, onClose }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const [engineName, setEngineName] = useState<string>('Auto');
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    const destroyPlayers = () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.destroy();
        } catch {}
        hlsRef.current = null;
      }
      if (mpegtsRef.current) {
        try {
          mpegtsRef.current.destroy();
        } catch {}
        mpegtsRef.current = null;
      }
      if (videoRef.current) {
        try {
          videoRef.current.removeAttribute('src');
          videoRef.current.load();
        } catch {}
      }
    };

    destroyPlayers();

    if (!videoRef.current || !url) return;

    const video = videoRef.current;
    const engine = detectStreamEngine(url);

    if (engine === 'mpegts' && mpegts.isSupported()) {
      setEngineName('mpegts.js (MPEG-TS)');
      try {
        const player = mpegts.createPlayer(
          { type: 'mpegts', isLive: false, url },
          { enableWorker: true, lazyLoad: false }
        );
        player.attachMediaElement(video);
        player.load();
        const playRes = player.play();
        if (playRes && typeof (playRes as any).catch === 'function') {
          (playRes as Promise<void>).catch(() => {});
        }
        mpegtsRef.current = player;
      } catch (err: any) {
        setPlaybackError('Erreur de chargement mpegts.js');
      }
    } else if (engine === 'hls' && Hls.isSupported()) {
      setEngineName('HLS.js');
      const hls = new Hls({ enableWorker: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          setPlaybackError(`Erreur HLS: ${data.details}`);
        }
      });
      hlsRef.current = hls;
    } else {
      setEngineName('HTML5 Natif (MP4)');
      video.src = url;
      video.play().catch(() => {});
    }

    return () => {
      destroyPlayers();
    };
  }, [url]);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex flex-col justify-between select-none">
      <div className="p-4 bg-gradient-to-b from-black/90 to-transparent flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <h3 className="text-sm md:text-base font-bold text-white tracking-tight">{title}</h3>
          <span className="px-2.5 py-1 bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold rounded-full flex items-center gap-1">
            <Cpu className="w-3 h-3 text-indigo-400" />
            {engineName}
          </span>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition active:scale-95"
        >
          Fermer (✕)
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        {playbackError ? (
          <div className="text-center p-6 bg-red-950/40 border border-red-500/30 rounded-2xl max-w-md">
            <p className="text-red-300 text-sm font-semibold mb-3">{playbackError}</p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-full"
            >
              Fermer
            </button>
          </div>
        ) : (
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl bg-black"
          />
        )}
      </div>
    </div>
  );
};

const PosterImage: React.FC<{
  poster: string;
  posterCandidates?: string[];
  title: string;
  className?: string;
}> = ({ poster, posterCandidates, title, className = '' }) => {
  const candidates = useMemo(() => {
    const set = new Set<string>();
    if (poster && typeof poster === 'string' && poster.length > 5) set.add(poster);
    if (Array.isArray(posterCandidates)) {
      posterCandidates.forEach((c) => {
        if (c && typeof c === 'string' && c.length > 5) set.add(c);
      });
    }
    return Array.from(set);
  }, [poster, posterCandidates]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [hasFailedAll, setHasFailedAll] = useState(false);

  const handleError = () => {
    if (currentIndex + 1 < candidates.length) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setHasFailedAll(true);
    }
  };

  if (hasFailedAll || candidates.length === 0) {
    return (
      <div className={`w-full h-full bg-gradient-to-br from-slate-900 via-indigo-950/60 to-slate-900 flex flex-col items-center justify-center p-3 text-center border border-white/10 ${className}`}>
        <Film className="w-8 h-8 text-indigo-400/60 mb-2" />
        <span className="text-[11px] font-bold text-slate-300 line-clamp-2 leading-tight">{title}</span>
      </div>
    );
  }

  return (
    <img
      src={candidates[currentIndex]}
      alt={title}
      onError={handleError}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
    />
  );
};

export const VODSection: React.FC<{ type?: 'vod' | 'series' }> = ({ type = 'vod' }) => {
  const { 
    vodMovies, 
    seriesList, 
    movieCategories,
    seriesCategories,
    isSessionUnlocked, 
    requestPinForAction,
    vodProgress,
    isBackgroundRefreshing,
    vodCacheLastUpdate,
    categoryAuditReport,
    performanceAuditReport,
    fetchSeriesDetails,
    fetchSeasonEpisodes,
    getVODStreamUrl,
    refreshVODCatalog,
    clearVODCache
  } = useIPTV();

  const [activeTab, setActiveTab] = useState<'vod' | 'series'>(type);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMovie, setSelectedMovie] = useState<VODItem | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<TVSeries | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [seriesSeasonsState, setSeriesSeasonsState] = useState<any[]>([]);
  const [loadingSeriesDetails, setLoadingSeriesDetails] = useState<boolean>(false);
  const [activePlaybackVideo, setActivePlaybackVideo] = useState<{ title: string; url: string } | null>(null);
  const [visibleLimit, setVisibleLimit] = useState<number>(48);
  const [showAuditModal, setShowAuditModal] = useState<boolean>(false);
  const [isResolvingLink, setIsResolvingLink] = useState<boolean>(false);

  useEffect(() => {
    setVisibleLimit(48);
  }, [searchQuery, activeTab, selectedCategoryId]);

  const currentCategories = useMemo(() => {
    return activeTab === 'vod' ? movieCategories : seriesCategories;
  }, [activeTab, movieCategories, seriesCategories]);

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
    let list = vodMovies || [];
    if (selectedCategoryId !== 'ALL') {
      list = list.filter((m) => m.categoryId === selectedCategoryId);
    }
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((m) => {
      if (!m) return false;
      const title = m.title || '';
      const genres = getGenreArray(m.genre);
      return title.toLowerCase().includes(q) || genres.some(g => g.toLowerCase().includes(q));
    });
  }, [vodMovies, selectedCategoryId, searchQuery]);

  const filteredSeries = useMemo(() => {
    let list = seriesList || [];
    if (selectedCategoryId !== 'ALL') {
      list = list.filter((s) => s.categoryId === selectedCategoryId);
    }
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((s) => {
      if (!s) return false;
      const title = s.title || '';
      const genres = getGenreArray(s.genre);
      return title.toLowerCase().includes(q) || genres.some(g => g.toLowerCase().includes(q));
    });
  }, [seriesList, selectedCategoryId, searchQuery]);

  const visibleMovies = useMemo(() => filteredMovies.slice(0, visibleLimit), [filteredMovies, visibleLimit]);
  const visibleSeries = useMemo(() => filteredSeries.slice(0, visibleLimit), [filteredSeries, visibleLimit]);

  const handlePlayMovie = async (movie: VODItem) => {
    const play = async () => {
      setIsResolvingLink(true);
      try {
        let finalUrl = movie.streamUrl;
        if (movie.cmd) {
          finalUrl = await getVODStreamUrl(movie.cmd);
        }
        setActivePlaybackVideo({ title: movie.title, url: finalUrl });
      } catch (err) {
        console.error('Error resolving VOD stream URL:', err);
        setActivePlaybackVideo({ title: movie.title, url: movie.streamUrl });
      } finally {
        setIsResolvingLink(false);
      }
    };

    if (movie.isLocked && !isSessionUnlocked) {
      requestPinForAction(play, `Film verrouillé : ${movie.title}`);
      return;
    }
    await play();
  };

  const handlePlayEpisode = async (series: TVSeries, ep: TVSeriesEpisode) => {
    const play = async () => {
      setIsResolvingLink(true);
      try {
        let finalUrl = ep.streamUrl;
        if (ep.cmd) {
          finalUrl = await getVODStreamUrl(ep.cmd, series.id);
        }
        setActivePlaybackVideo({ title: `${series.title} - ${ep.title}`, url: finalUrl });
      } catch (err) {
        console.error('Error resolving episode link:', err);
        setActivePlaybackVideo({ title: `${series.title} - ${ep.title}`, url: ep.streamUrl });
      } finally {
        setIsResolvingLink(false);
      }
    };

    if (series.isLocked && !isSessionUnlocked) {
      requestPinForAction(play, `Épisode verrouillé`);
      return;
    }
    await play();
  };

  const handleSelectSeries = async (series: TVSeries) => {
    setSelectedSeries(series);
    setSelectedSeason(1);
    setLoadingSeriesDetails(true);
    try {
      const seasons = await fetchSeriesDetails(series.id, series.title, series.totalSeasons);
      if (seasons && seasons.length > 0) {
        setSeriesSeasonsState(seasons);
      } else if (series.seasons && series.seasons.length > 0) {
        setSeriesSeasonsState(series.seasons);
      } else {
        setSeriesSeasonsState([{ seasonNumber: 1, title: 'Saison 1', episodes: [] }]);
      }
    } catch (err) {
      console.warn('Error fetching series seasons:', err);
      setSeriesSeasonsState(series.seasons || []);
    } finally {
      setLoadingSeriesDetails(false);
    }
  };

  const handleSelectSeason = async (seasonNum: number) => {
    setSelectedSeason(seasonNum);
    if (!selectedSeries) return;
    const currentSeason = seriesSeasonsState.find(s => s.seasonNumber === seasonNum);
    if (!currentSeason || !currentSeason.episodes || currentSeason.episodes.length === 0) {
      setLoadingSeriesDetails(true);
      try {
        const fetchedEps = await fetchSeasonEpisodes(selectedSeries.id, seasonNum);
        if (fetchedEps && fetchedEps.length > 0) {
          setSeriesSeasonsState(prev => prev.map(s => s.seasonNumber === seasonNum ? { ...s, episodes: fetchedEps } : s));
        }
      } catch (e) {
        console.warn('Error fetching season episodes:', e);
      } finally {
        setLoadingSeriesDetails(false);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent text-slate-100 overflow-hidden select-none">
      {/* Dynamic Progress Banner */}
      {vodProgress.isLoading && (
        <div className="px-6 py-2.5 bg-indigo-500/15 border-b border-indigo-500/30 flex flex-wrap items-center justify-between gap-3 text-xs text-indigo-200">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
            <span>
              Balayage du catalogue Stalker VOD ({vodProgress.type === 'films' ? 'Films' : 'Séries'}) :{' '}
              <strong className="text-white">{vodProgress.current.toLocaleString('fr-FR')}</strong> {vodProgress.total > 0 ? `/ ${vodProgress.total.toLocaleString('fr-FR')}` : ''} répertoriés (Page {vodProgress.page} / {vodProgress.totalPages})
            </span>
          </div>
          <div className="w-40 bg-white/10 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-indigo-400 h-full transition-all duration-300"
              style={{ width: `${Math.min(100, (vodProgress.current / Math.max(1, vodProgress.total)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Top Header & Tab Switcher (Frosted Glass) */}
      <div className="p-4 md:p-6 bg-white/[0.03] backdrop-blur-2xl border-b border-white/10 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex bg-white/5 p-1 rounded-full border border-white/10">
              <button
                onClick={() => { setActiveTab('vod'); setSelectedSeries(null); setSelectedCategoryId('ALL'); }}
                className={`px-5 py-2 rounded-full text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  activeTab === 'vod'
                    ? 'bg-white/15 text-white border border-white/20 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Film className="w-4 h-4 text-indigo-400" />
                Films VOD ({vodMovies.length.toLocaleString('fr-FR')})
              </button>
              <button
                onClick={() => { setActiveTab('series'); setSelectedMovie(null); setSelectedCategoryId('ALL'); }}
                className={`px-5 py-2 rounded-full text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  activeTab === 'series'
                    ? 'bg-white/15 text-white border border-white/20 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Clapperboard className="w-4 h-4 text-indigo-400" />
                Séries TV ({seriesList.length.toLocaleString('fr-FR')})
              </button>
            </div>

            <button
              onClick={() => refreshVODCatalog()}
              disabled={vodProgress.isLoading || isBackgroundRefreshing}
              className="px-3.5 py-2 rounded-full bg-white/5 hover:bg-white/10 disabled:opacity-50 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 border border-white/10 transition cursor-pointer"
              title="Actualiser le catalogue en arrière-plan depuis le serveur Stalker"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${(vodProgress.isLoading || isBackgroundRefreshing) ? 'animate-spin text-indigo-400' : ''}`} />
              Actualiser
            </button>

            <button
              onClick={() => clearVODCache()}
              disabled={vodProgress.isLoading || isBackgroundRefreshing}
              className="px-3 py-2 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-300 hover:text-red-200 text-xs font-semibold border border-red-500/20 transition cursor-pointer"
              title="Vider le cache IndexedDB et réinitialiser la synchronisation"
            >
              Vider Cache
            </button>

            {(vodProgress.auditReport || categoryAuditReport || performanceAuditReport) && (
              <button
                onClick={() => setShowAuditModal(true)}
                className="px-3.5 py-2 rounded-full bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-xs font-semibold border border-indigo-500/30 flex items-center gap-1.5 transition cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                Rapports d'Audit
              </button>
            )}
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

        {/* Server Category Horizontal Selector & Cache Info */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5 text-xs text-slate-300">
          <div className="flex items-center gap-2 overflow-x-auto py-1 max-w-full scrollbar-thin">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0">
              Catégorie Serveur ({currentCategories.length}) :
            </span>
            <button
              onClick={() => setSelectedCategoryId('ALL')}
              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 ${
                selectedCategoryId === 'ALL'
                  ? 'bg-indigo-500 text-white shadow-md'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300'
              }`}
            >
              Toutes ({activeTab === 'vod' ? vodMovies.length : seriesList.length})
            </button>
            {currentCategories.map((cat) => {
              const count = activeTab === 'vod' 
                ? vodMovies.filter(m => m.categoryId === cat.id).length
                : seriesList.filter(s => s.categoryId === cat.id).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer shrink-0 ${
                    selectedCategoryId === cat.id
                      ? 'bg-indigo-500 text-white shadow-md'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300'
                  }`}
                >
                  {cat.title} ({count})
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 text-[11px] text-slate-400 shrink-0 ml-auto">
            {vodCacheLastUpdate && (
              <span className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-300 px-2.5 py-1 rounded-full border border-emerald-500/20">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Cache IndexedDB : {vodCacheLastUpdate}
              </span>
            )}
            {isBackgroundRefreshing && (
              <span className="flex items-center gap-1.5 bg-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-full border border-indigo-500/30">
                <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                Actualisation en arrière-plan...
              </span>
            )}
          </div>
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
                  <PosterImage
                    poster={movie.poster}
                    posterCandidates={movie.posterCandidates}
                    title={movie.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
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
                onClick={() => handleSelectSeries(series)}
                className="group bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-3xl overflow-hidden hover:border-indigo-400/50 hover:bg-white/[0.08] hover:shadow-2xl transition-all cursor-pointer flex flex-col"
              >
                {/* Poster */}
                <div className="relative aspect-[2/3] bg-black/40 overflow-hidden">
                  <PosterImage
                    poster={series.poster}
                    posterCandidates={series.posterCandidates}
                    title={series.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
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
              <PosterImage
                poster={selectedMovie.backdrop || selectedMovie.poster}
                posterCandidates={selectedMovie.posterCandidates}
                title={selectedMovie.title}
                className="w-full h-full object-cover opacity-60"
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
                  disabled={isResolvingLink}
                  onClick={() => {
                    handlePlayMovie(selectedMovie);
                    setSelectedMovie(null);
                  }}
                  className="flex-1 py-3 px-4 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition cursor-pointer"
                >
                  {isResolvingLink ? (
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <Play className="w-4 h-4 fill-white" />
                  )}
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
              {(seriesSeasonsState.length > 0 ? seriesSeasonsState : selectedSeries.seasons || []).map((s) => (
                <button
                  key={s.seasonNumber}
                  onClick={() => handleSelectSeason(s.seasonNumber)}
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
              {loadingSeriesDetails ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400 text-xs">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                  <span>Chargement des épisodes depuis le serveur Stalker...</span>
                </div>
              ) : (
                ((seriesSeasonsState.find((s) => s.seasonNumber === selectedSeason)?.episodes) || []).map((ep: any) => (
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
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Audit Report Modal */}
      {showAuditModal && (vodProgress.auditReport || categoryAuditReport || performanceAuditReport) && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-950/90 backdrop-blur-3xl border border-white/15 rounded-3xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">Rapports d'Audit VOD Catalogue Stalker, Performance & Catégories</h3>
              </div>
              <button
                onClick={() => setShowAuditModal(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
              >
                ✕
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              {performanceAuditReport && (
                <div>
                  <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-2">VOD Performance Audit (Vitesse & Parallélisme)</h4>
                  <pre className="p-4 bg-black/60 rounded-2xl border border-white/10 text-xs font-mono text-amber-300 whitespace-pre-wrap leading-relaxed">
                    {performanceAuditReport}
                  </pre>
                </div>
              )}
              {categoryAuditReport && (
                <div>
                  <h4 className="text-xs font-bold text-indigo-300 uppercase tracking-wider mb-2">Audit Catégories Serveur</h4>
                  <pre className="p-4 bg-black/60 rounded-2xl border border-white/10 text-xs font-mono text-cyan-300 whitespace-pre-wrap leading-relaxed">
                    {categoryAuditReport}
                  </pre>
                </div>
              )}
              {vodProgress.auditReport && (
                <div>
                  <h4 className="text-xs font-bold text-indigo-300 uppercase tracking-wider mb-2">Audit Contenus & Pagination VOD</h4>
                  <pre className="p-4 bg-black/60 rounded-2xl border border-white/10 text-xs font-mono text-emerald-300 whitespace-pre-wrap leading-relaxed">
                    {vodProgress.auditReport}
                  </pre>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-white/10 flex justify-end">
              <button
                onClick={() => setShowAuditModal(false)}
                className="px-5 py-2 rounded-full bg-indigo-500 text-white text-xs font-bold"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Standalone Video Modal */}
      {activePlaybackVideo && (
        <VODPlayerModal
          title={activePlaybackVideo.title}
          url={activePlaybackVideo.url}
          onClose={() => setActivePlaybackVideo(null)}
        />
      )}
    </div>
  );
};
