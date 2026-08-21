import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  Heart, 
  Lock, 
  Grid, 
  List, 
  Tv,
  Folder,
  ChevronRight,
  ArrowLeft,
  Layers
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { Channel } from '../types/iptv';
import { EPGService } from '../services/epgService';
import { generateDynamicEPG } from '../data/demoChannels';

interface ChannelListProps {
  onSelectChannel?: (channel: Channel) => void;
  compact?: boolean;
}

export const ChannelList: React.FC<ChannelListProps> = ({ onSelectChannel, compact = false }) => {
  const { 
    channels,
    filteredChannels, 
    activeChannel, 
    setActiveChannel, 
    selectedCategory, 
    setSelectedCategory, 
    searchQuery, 
    setSearchQuery, 
    favorites, 
    toggleFavorite,
    epgData,
    isChannelLocked,
    isSessionUnlocked,
    requestPinForAction,
    setActiveView
  } = useIPTV();

  const [viewMode, setViewMode] = useState<'list' | 'grid'>(compact ? 'list' : 'list');
  const [displayMode, setDisplayMode] = useState<'folders' | 'channels'>('folders');
  const [categorySortOrder, setCategorySortOrder] = useState<'server' | 'az'>('server');
  const [visibleLimit, setVisibleLimit] = useState<number>(60);

  // Extract dynamic categories with channel counts, preserving server insertion order by default
  const categoryFolders = useMemo(() => {
    const map = new Map<string, number>();
    (channels || []).forEach((ch) => {
      if (!ch) return;
      const cat = ch.category || 'Généraliste';
      map.set(cat, (map.get(cat) || 0) + 1);
    });

    const list: { name: string; count: number }[] = [];
    map.forEach((count, name) => {
      list.push({ name, count });
    });

    if (categorySortOrder === 'az') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }
    return list;
  }, [channels, categorySortOrder]);

  // Filtered categories for search
  const filteredCategoryFolders = useMemo(() => {
    if (!searchQuery) return categoryFolders;
    const q = searchQuery.trim().toLowerCase();
    return categoryFolders.filter((cat) => cat.name.toLowerCase().includes(q));
  }, [categoryFolders, searchQuery]);

  // Dynamic list of categories for top pill filter
  const categories = useMemo(() => {
    return ['Tous', 'Favoris', ...categoryFolders.map((c) => c.name)];
  }, [categoryFolders]);

  // Reset display limit when filter changes
  useEffect(() => {
    setVisibleLimit(60);
  }, [selectedCategory, searchQuery]);

  // Auto switch to channels view when search query is entered or category selected
  const handleCategorySelect = (categoryName: string) => {
    setSelectedCategory(categoryName);
    setDisplayMode('channels');
  };

  // Scroll handler for infinite chunk loading
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 300) {
      setVisibleLimit((prev) => Math.min(prev + 60, filteredChannels.length));
    }
  };

  const visibleChannels = useMemo(() => {
    return filteredChannels.slice(0, visibleLimit);
  }, [filteredChannels, visibleLimit]);

  const handleChannelClick = (channel: Channel) => {
    if (isChannelLocked(channel) && !isSessionUnlocked) {
      requestPinForAction(() => {
        setActiveChannel(channel);
        setActiveView('live');
        if (onSelectChannel) onSelectChannel(channel);
      }, `Canal verrouillé : ${channel.name}`);
      return;
    }

    setActiveChannel(channel);
    setActiveView('live');
    if (onSelectChannel) {
      onSelectChannel(channel);
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent text-slate-100 overflow-hidden select-none">
      {/* Search and Filter Header (Frosted Glass) */}
      <div className="p-4 bg-white/[0.02] backdrop-blur-2xl border-b border-white/10 space-y-3">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="channel-search-input"
            type="text"
            placeholder="Rechercher une chaîne ou catégorie..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value.trim().length > 0 && displayMode === 'folders') {
                setDisplayMode('channels');
              }
            }}
            className="w-full bg-white/5 border border-white/10 rounded-full pl-9 pr-4 py-2 text-xs text-white placeholder-slate-400 outline-none focus:border-indigo-400/60 focus:bg-white/10 transition-all"
          />
        </div>

        {/* View mode toggle tabs: Dossiers vs Chaînes */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10 w-full">
            <button
              onClick={() => {
                setDisplayMode('folders');
                setSelectedCategory('Tous');
              }}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                displayMode === 'folders'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Folder className="w-3.5 h-3.5 text-amber-400" />
              <span>Dossiers ({categoryFolders.length})</span>
            </button>
            <button
              onClick={() => setDisplayMode('channels')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                displayMode === 'channels'
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Chaînes ({channels.length})</span>
            </button>
          </div>
        </div>

        {/* Categories Pills (if in channels mode) */}
        {displayMode === 'channels' && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {categories.map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => handleCategorySelect(cat)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-white/15 text-white border border-white/20 shadow-sm'
                      : 'bg-white/5 text-slate-400 border border-transparent hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}

        {/* Header bar showing counts and mode options */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
          {displayMode === 'folders' ? (
            <>
              <span className="font-semibold text-amber-400/90 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-amber-400" />
                {filteredCategoryFolders.length} dossiers IPTV
              </span>
              <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg border border-white/10 shrink-0 text-[10px]">
                <button
                  onClick={() => setCategorySortOrder('server')}
                  className={`px-2 py-0.5 rounded transition ${categorySortOrder === 'server' ? 'bg-amber-500/30 text-amber-300 font-bold border border-amber-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  title="Ordre original du serveur IPTV"
                >
                  Ordre Serveur
                </button>
                <button
                  onClick={() => setCategorySortOrder('az')}
                  className={`px-2 py-0.5 rounded transition ${categorySortOrder === 'az' ? 'bg-amber-500/30 text-amber-300 font-bold border border-amber-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  title="Trier de A à Z"
                >
                  A-Z
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 truncate">
              {selectedCategory !== 'Tous' && (
                <button
                  onClick={() => setDisplayMode('folders')}
                  className="text-amber-400 hover:underline flex items-center gap-1 text-[11px] font-semibold"
                >
                  <ArrowLeft className="w-3 h-3" /> Dossiers
                </button>
              )}
              <span className="font-medium text-slate-300 truncate">
                {selectedCategory} ({filteredChannels.length})
              </span>
            </div>
          )}

          {displayMode === 'channels' && !compact && (
            <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg border border-white/10 shrink-0">
              <button
                onClick={() => setViewMode('list')}
                className={`p-1 rounded-md transition ${viewMode === 'list' ? 'bg-white/15 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                title="Vue Liste"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1 rounded-md transition ${viewMode === 'grid' ? 'bg-white/15 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                title="Vue Grille"
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Body */}
      <div onScroll={handleScroll} className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {displayMode === 'folders' ? (
          /* DOSSIERS / CATEGORIES VIEW (Matching User Screenshot IMG_2659) */
          filteredCategoryFolders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center p-4">
              <Folder className="w-8 h-8 text-amber-500/40 mb-2" />
              <p className="text-xs text-slate-400 font-semibold">Aucun dossier trouvé</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredCategoryFolders.map((catObj, index) => {
                const isSelected = selectedCategory === catObj.name;
                return (
                  <button
                    key={catObj.name}
                    onClick={() => handleCategorySelect(catObj.name)}
                    className={`w-full p-3.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer group ${
                      isSelected
                        ? 'bg-amber-950/40 border-amber-500/70 text-amber-300 shadow-lg shadow-amber-500/10'
                        : index === 0
                        ? 'bg-slate-900/95 border-amber-500/40 hover:border-amber-400 text-amber-400 shadow-md'
                        : 'bg-slate-900/80 border-white/10 hover:border-amber-500/40 hover:bg-slate-800/90 text-slate-100'
                    }`}
                  >
                    {/* Left: TV Badge icon + Vertical Bar + Category Name */}
                    <div className="flex items-center gap-3 overflow-hidden pr-2">
                      {/* Double Circle Icon Badge (t)(v) matching screenshot */}
                      <div className="w-8 h-8 rounded-lg bg-black/70 border border-amber-500/30 flex items-center justify-center shrink-0 group-hover:border-amber-400 transition">
                        <span className="text-[10px] font-extrabold font-mono text-amber-400 tracking-tighter">
                          ⓣⓥ
                        </span>
                      </div>

                      {/* Vertical Separator | */}
                      <span className="text-slate-600 font-light select-none">|</span>

                      {/* Category Name (Yellow/Gold typography matching screenshot) */}
                      <span className="font-bold text-xs sm:text-sm text-amber-400/95 tracking-wide uppercase truncate group-hover:text-amber-300">
                        {catObj.name}
                      </span>
                    </div>

                    {/* Right: Channel Count */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-semibold text-slate-200 font-mono px-2.5 py-1 rounded-md bg-white/5 border border-white/10 group-hover:bg-white/10 transition">
                        {catObj.count}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-amber-400 transition" />
                    </div>
                  </button>
                );
              })}
            </div>
          )
        ) : (
          /* CHANNELS LIST VIEW */
          filteredChannels.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center p-4">
              <Tv className="w-8 h-8 text-slate-600 mb-2" />
              <p className="text-xs text-slate-400 font-semibold">Aucune chaîne trouvée</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Essayez un autre mot-clé ou dossier.</p>
              <button
                onClick={() => {
                  setSelectedCategory('Tous');
                  setSearchQuery('');
                }}
                className="mt-3 px-3 py-1.5 bg-indigo-500/20 text-indigo-300 rounded-full text-xs font-semibold border border-indigo-500/30"
              >
                Reinitialiser le filtre
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 gap-2.5">
              {visibleChannels.map((ch) => {
                const isActive = activeChannel?.id === ch.id;
                const isLocked = isChannelLocked(ch) && !isSessionUnlocked;
                const isFav = favorites.includes(ch.id);

                return (
                  <div
                    key={ch.id}
                    onClick={() => handleChannelClick(ch)}
                    className={`p-3 rounded-2xl border flex flex-col items-center text-center justify-between transition-all cursor-pointer backdrop-blur-xl ${
                      isActive
                        ? 'bg-indigo-500/20 border-indigo-500/40 text-white shadow-lg shadow-indigo-500/10'
                        : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    {/* Top Favorite / Lock tag */}
                    <div className="w-full flex items-center justify-between text-[10px] mb-1">
                      <span className="font-mono font-bold text-indigo-400">#{ch.number}</span>
                      {isLocked ? (
                        <Lock className="w-3 h-3 text-red-400" />
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(ch.id);
                          }}
                          className="text-slate-500 hover:text-red-400"
                        >
                          <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-red-500 text-red-500' : ''}`} />
                        </button>
                      )}
                    </div>

                    {/* Logo */}
                    {ch.logo ? (
                      <div className="w-12 h-12 rounded-xl bg-black/40 border border-white/10 p-1.5 flex items-center justify-center my-1.5">
                        <img
                          src={ch.logo}
                          alt={ch.name}
                          className="max-w-full max-h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-indigo-500 text-white font-extrabold text-xs flex items-center justify-center my-1.5 shadow-md shadow-indigo-500/25">
                        {ch.number}
                      </div>
                    )}

                    <div className="w-full truncate text-xs font-semibold text-white mt-1">{ch.name}</div>
                    <div className="text-[10px] text-slate-400">{ch.category}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleChannels.map((ch) => {
                const isActive = activeChannel?.id === ch.id;
                const isLocked = isChannelLocked(ch) && !isSessionUnlocked;
                const isFav = favorites.includes(ch.id);
                const programs = epgData[ch.id] || generateDynamicEPG(ch.id);
                const currentProg = EPGService.getCurrentProgram(programs);
                const progress = currentProg ? EPGService.getProgressPercentage(currentProg) : 0;

                return (
                  <div
                    key={ch.id}
                    id={`channel-item-${ch.id}`}
                    onClick={() => handleChannelClick(ch)}
                    className={`w-full p-3 rounded-2xl border flex items-center justify-between gap-3 transition-all cursor-pointer backdrop-blur-xl ${
                      isActive
                        ? 'bg-indigo-500/20 border-indigo-500/40 text-white shadow-lg shadow-indigo-500/10'
                        : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    {/* Left: Logo & Info */}
                    <div className="flex items-center gap-3 truncate">
                      {/* Number */}
                      <span className="w-5 text-center text-xs font-mono font-bold text-indigo-400 shrink-0">
                        {ch.number}
                      </span>

                      {/* Logo */}
                      {ch.logo ? (
                        <div className="w-11 h-11 rounded-xl bg-black/40 border border-white/10 p-1 flex items-center justify-center shrink-0">
                          <img
                            src={ch.logo}
                            alt={ch.name}
                            className="max-w-full max-h-full object-contain"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-indigo-500 text-white font-extrabold text-xs flex items-center justify-center shrink-0 shadow-md shadow-indigo-500/20">
                          {ch.number}
                        </div>
                      )}

                      {/* Titles & EPG Progress */}
                      <div className="truncate flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white truncate">{ch.name}</span>
                          {ch.resolution && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              {ch.resolution}
                            </span>
                          )}
                        </div>

                        {/* Current Program Snippet with Progress Bar */}
                        {isLocked ? (
                          <span className="text-[10px] text-red-400 font-medium">Contenu verrouillé</span>
                        ) : currentProg ? (
                          <div className="mt-1 space-y-1">
                            <div className="text-[11px] text-slate-300 truncate">
                              {currentProg.title}
                            </div>
                            <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                              <div
                                className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400">{ch.category}</span>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isLocked ? (
                        <span className="p-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20">
                          <Lock className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(ch.id);
                          }}
                          className="p-2 rounded-xl text-slate-500 hover:text-red-400 hover:bg-white/5 transition"
                          title="Ajouter aux favoris"
                        >
                          <Heart className={`w-4 h-4 ${isFav ? 'fill-red-500 text-red-500' : ''}`} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
};


