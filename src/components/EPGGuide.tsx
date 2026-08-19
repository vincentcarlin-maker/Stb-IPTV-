import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  CalendarDays, 
  Clock, 
  Search, 
  Play, 
  Bell, 
  BellRing, 
  Filter, 
  Heart, 
  Lock, 
  Tv,
  ChevronRight,
  X
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { EPGProgram, Channel } from '../types/iptv';
import { EPGService } from '../services/epgService';
import { generateDynamicEPG } from '../data/demoChannels';

export const EPGGuide: React.FC = () => {
  const { 
    channels, 
    epgData, 
    activeChannel, 
    setActiveChannel, 
    setActiveView,
    favorites, 
    toggleFavorite,
    reminders,
    addReminder,
    removeReminder,
    isChannelLocked,
    isSessionUnlocked,
    requestPinForAction
  } = useIPTV();

  const [selectedCategory, setSelectedCategory] = useState<string>('Tous');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProgram, setSelectedProgram] = useState<{ program: EPGProgram; channel: Channel } | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(Date.now());
  const [visibleLimit, setVisibleLimit] = useState<number>(60);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const verticalScrollRef = useRef<HTMLDivElement | null>(null);

  // Update current time tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Extract dynamic categories
  const categories = useMemo(() => {
    const catSet = new Set<string>();
    (channels || []).forEach((ch) => {
      if (ch?.category) catSet.add(ch.category);
    });
    const sorted = Array.from(catSet).sort((a, b) => a.localeCompare(b, 'fr'));
    return ['Tous', 'Favoris', ...sorted];
  }, [channels]);

  // Filter channels memoized
  const filteredChannels = useMemo(() => {
    const q = searchQuery ? searchQuery.trim().toLowerCase() : '';
    const cat = selectedCategory || 'Tous';

    return (channels || []).filter((ch) => {
      if (!ch) return false;
      const chName = ch.name || '';
      const chCat = ch.category || 'Généraliste';
      const chNumStr = ch.number !== undefined && ch.number !== null ? ch.number.toString() : '';

      const matchesCat = 
        cat === 'Tous' ? true :
        cat === 'Favoris' ? (favorites || []).includes(ch.id) :
        chCat.toLowerCase() === cat.toLowerCase();

      if (!matchesCat) return false;

      if (!q) return true;

      const matchesSearch = 
        chName.toLowerCase().includes(q) ||
        chNumStr === q ||
        ((epgData[ch.id] || []).some(p => p?.title?.toLowerCase().includes(q)));

      return matchesSearch;
    });
  }, [channels, selectedCategory, searchQuery, favorites, epgData]);

  const visibleChannels = useMemo(() => {
    return filteredChannels.slice(0, visibleLimit);
  }, [filteredChannels, visibleLimit]);

  // Auto-scroll to active channel row upon entering guide
  useEffect(() => {
    if (!activeChannel) return;

    if (selectedCategory !== 'Tous' && activeChannel.category && activeChannel.category.toLowerCase() !== selectedCategory.toLowerCase()) {
      setSelectedCategory('Tous');
    }

    const timer = setTimeout(() => {
      const activeElement = document.getElementById(`epg-channel-row-${activeChannel.id}`);
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [activeChannel?.id]);

  // Calculate timeline start and end boundaries for desktop grid
  const baseTimelineStart = Math.floor(currentTime / (30 * 60 * 1000)) * (30 * 60 * 1000) - 2 * 60 * 60 * 1000;
  const totalHours = 10;
  const totalMinutes = totalHours * 60;
  const minuteWidth = 4; // 4px per minute -> 240px per hour

  // Generate 30-min time marks
  const timeMarks: number[] = [];
  for (let i = 0; i < totalHours * 2; i++) {
    timeMarks.push(baseTimelineStart + i * 30 * 60 * 1000);
  }

  // Auto scroll timeline to current time on mount
  useEffect(() => {
    if (timelineScrollRef.current) {
      const currentOffset = ((currentTime - baseTimelineStart) / (60 * 1000)) * minuteWidth;
      timelineScrollRef.current.scrollLeft = Math.max(0, currentOffset - 250);
    }
  }, [baseTimelineStart, currentTime, minuteWidth]);

  // Single Tap Channel Tune (zaps directly and closes guide to view live player)
  const handleSelectAndTuneChannel = (channel: Channel) => {
    if (isChannelLocked(channel) && !isSessionUnlocked) {
      requestPinForAction(() => {
        setActiveChannel(channel);
        setActiveView('live');
      }, `Canal verrouillé : ${channel.name}`);
      return;
    }
    setActiveChannel(channel);
    setActiveView('live');
  };

  const handleProgramClick = (program: EPGProgram, channel: Channel) => {
    // If it's currently live, tune directly to channel
    const isLive = currentTime >= program.start && currentTime < program.end;
    if (isLive) {
      handleSelectAndTuneChannel(channel);
      return;
    }

    if (isChannelLocked(channel) && !isSessionUnlocked) {
      requestPinForAction(() => {
        setSelectedProgram({ program, channel });
      }, `Programme verrouillé : ${program.title}`);
      return;
    }
    setSelectedProgram({ program, channel });
  };

  const isReminderSet = (programId: string) => {
    return reminders.some((r) => r.programId === programId);
  };

  const toggleProgramReminder = (program: EPGProgram, channel: Channel) => {
    if (isReminderSet(program.id)) {
      const found = reminders.find((r) => r.programId === program.id);
      if (found) removeReminder(found.id);
    } else {
      addReminder({
        programId: program.id,
        channelId: channel.id,
        channelName: channel.name,
        programTitle: program.title,
        startTime: program.start,
        endTime: program.end,
      });
    }
  };

  const currentMarkerOffset = Math.max(0, ((currentTime - baseTimelineStart) / (60 * 1000)) * minuteWidth);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950/70 sm:bg-slate-950/55 backdrop-blur-md text-slate-100 overflow-hidden select-none relative">
      {/* Top Header Controls (Frosted Glass) */}
      <div className="p-3 sm:p-4 bg-slate-950/80 backdrop-blur-2xl border-b border-white/10 flex flex-col gap-2.5 z-20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30 shrink-0">
              <CalendarDays className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-lg font-bold tracking-tight text-white flex items-center gap-2 truncate">
                Guide TV (xmltvfr.fr)
              </h1>
              <p className="text-[10px] sm:text-xs text-slate-400 truncate">
                Toucher une chaîne pour la regarder en direct
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Search Input */}
            <div className="relative w-36 sm:w-64 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-xs text-white placeholder-slate-400"
              />
            </div>

            {/* Close / Return to Live Video Button */}
            <button
              onClick={() => setActiveView('live')}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition active:scale-95 cursor-pointer flex items-center gap-1 text-xs font-bold px-3"
              title="Fermer le guide"
            >
              <X className="w-4 h-4" />
              <span className="hidden sm:inline">Direct</span>
            </button>
          </div>
        </div>

        {/* Categories Horizontal Scroll */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full scrollbar-none">
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                    : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10 hover:text-white'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* --- MOBILE VIEW: SWIPEABLE PROGRAM SLIDER PER CHANNEL --- */}
      <div className="block md:hidden flex-1 overflow-y-auto p-3 space-y-3">
        {activeChannel && (
          <button
            onClick={() => {
              const el = document.getElementById(`epg-channel-row-${activeChannel.id}`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
            className="w-full py-2 px-3 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-bold flex items-center justify-between shadow-sm"
          >
            <span className="flex items-center gap-2 truncate">
              <Tv className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="truncate">Aller à la chaîne active : <strong>{activeChannel.name}</strong></span>
            </span>
            <ChevronRight className="w-4 h-4 shrink-0" />
          </button>
        )}

        {visibleChannels.map((ch) => {
          const programs = epgData[ch.id] || generateDynamicEPG(ch.id);
          const isActive = activeChannel?.id === ch.id;
          const isFav = favorites.includes(ch.id);

          return (
            <div
              key={ch.id}
              id={`epg-channel-row-${ch.id}`}
              className={`rounded-2xl p-3 backdrop-blur-xl transition border ${
                isActive 
                  ? 'bg-gradient-to-r from-indigo-950/80 to-slate-900/90 border-indigo-500/70 shadow-xl shadow-indigo-500/15' 
                  : 'bg-slate-950/80 border-white/10 hover:border-white/20'
              }`}
            >
              {/* Channel Header Row (Tap to Tune) */}
              <div 
                onClick={() => handleSelectAndTuneChannel(ch)}
                className="flex items-center justify-between gap-2 border-b border-white/5 pb-2 mb-2 cursor-pointer group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {ch.logo ? (
                    <div className="w-9 h-9 rounded-xl bg-black/50 p-1 border border-white/10 flex items-center justify-center shrink-0">
                      <img src={ch.logo} alt={ch.name} className="max-w-full max-h-full object-contain" referrerPolicy="no-referrer" />
                    </div>
                  ) : (
                    <div className="w-9 h-9 rounded-xl bg-indigo-600 font-extrabold text-white text-xs flex items-center justify-center shrink-0">
                      {ch.number}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono font-bold text-indigo-400">CH {ch.number}</span>
                      <h3 className="text-xs font-bold text-white truncate group-hover:text-indigo-300 transition">{ch.name}</h3>
                      {isActive && (
                        <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-indigo-500 text-white shrink-0">
                          EN LECTURE
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400">{ch.category}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(ch.id);
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 transition cursor-pointer"
                  >
                    <Heart className={`w-4 h-4 ${isFav ? 'fill-red-500 text-red-500' : ''}`} />
                  </button>

                  <div className="px-2.5 py-1 rounded-xl bg-indigo-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-xs">
                    <Play className="w-3 h-3 fill-white" />
                    Regarder
                  </div>
                </div>
              </div>

              {/* Horizontal Swipeable Programs List ("faire glisser les programmes pour voir la suite") */}
              <div className="text-[10px] text-slate-400 font-medium mb-1.5 flex items-center justify-between">
                <span>Programmes (glisser horizontalement) :</span>
                <span className="text-[9px] text-indigo-400">↔ Swipe</span>
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none snap-x touch-pan-x">
                {programs.map((p) => {
                  const isLive = currentTime >= p.start && currentTime < p.end;

                  return (
                    <div
                      key={p.id}
                      onClick={() => handleProgramClick(p, ch)}
                      className={`shrink-0 w-52 rounded-xl p-2.5 border cursor-pointer transition snap-start relative overflow-hidden ${
                        isLive
                          ? 'bg-indigo-600/30 border-indigo-500/80 text-white shadow-md'
                          : 'bg-white/5 border-white/10 hover:bg-white/10 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className="font-mono font-bold text-indigo-300 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-indigo-400" />
                          {EPGService.formatTime(p.start)} - {EPGService.formatTime(p.end)}
                        </span>
                        {isLive ? (
                          <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-red-500 text-white">
                            DIRECT
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-400 font-mono">
                            {EPGService.formatDuration(p.start, p.end)}
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs font-bold truncate">{p.title}</h4>
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">{p.category || 'Généraliste'}</p>

                      {isLive && (
                        <div className="mt-2 w-full bg-white/10 h-1 rounded-full overflow-hidden">
                          <div 
                            className="bg-indigo-500 h-full"
                            style={{ width: `${EPGService.getProgressPercentage(p)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* --- DESKTOP VIEW: TIMELINE MATRIX GRID WITH TRANSPARENT BACKDROP --- */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        {/* Left Column: Fixed Channel List */}
        <div className="w-60 shrink-0 bg-slate-950/80 backdrop-blur-2xl border-r border-white/10 z-10 flex flex-col">
          <div className="h-12 border-b border-white/10 px-4 flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider bg-white/[0.04]">
            <span>Chaînes ({filteredChannels.length})</span>
            <Filter className="w-3.5 h-3.5" />
          </div>

          <div ref={verticalScrollRef} className="flex-1 overflow-y-auto divide-y divide-white/5">
            {visibleChannels.map((ch) => {
              const isLocked = isChannelLocked(ch) && !isSessionUnlocked;
              const isFav = favorites.includes(ch.id);
              const isActive = activeChannel?.id === ch.id;

              return (
                <div
                  key={ch.id}
                  id={`epg-channel-row-${ch.id}`}
                  onClick={() => handleSelectAndTuneChannel(ch)}
                  className={`h-20 px-3.5 flex items-center justify-between hover:bg-white/10 transition cursor-pointer ${
                    isActive ? 'bg-indigo-600/30 border-l-4 border-indigo-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 truncate">
                    {ch.logo ? (
                      <div className="w-10 h-10 rounded-xl bg-black/50 p-1 border border-white/10 flex items-center justify-center shrink-0">
                        <img
                          src={ch.logo}
                          alt={ch.name}
                          className="max-w-full max-h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-indigo-600 font-extrabold text-white text-xs flex items-center justify-center shrink-0 shadow-sm">
                        {ch.number}
                      </div>
                    )}
                    <div className="truncate">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-bold text-indigo-400">
                          {ch.number}.
                        </span>
                        <span className="text-xs font-bold text-white truncate">{ch.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400">{ch.category}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-1">
                    {isLocked ? (
                      <Lock className="w-3.5 h-3.5 text-red-400" />
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(ch.id);
                        }}
                        className="p-1 text-slate-500 hover:text-red-400 transition cursor-pointer"
                      >
                        <Heart className={`w-3.5 h-3.5 ${isFav ? 'fill-red-500 text-red-500' : ''}`} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Scrollable Timeline Section */}
        <div ref={timelineScrollRef} className="flex-1 overflow-x-auto overflow-y-auto relative bg-transparent">
          <div style={{ width: `${totalMinutes * minuteWidth}px` }} className="relative min-h-full">
            {/* Top Time Ruler */}
            <div className="h-12 bg-slate-950/80 border-b border-white/10 flex items-center sticky top-0 z-10 backdrop-blur-2xl">
              {timeMarks.map((mark) => (
                <div
                  key={mark}
                  style={{ width: `${30 * minuteWidth}px` }}
                  className="shrink-0 border-r border-white/10 px-3 flex items-center text-xs font-mono font-semibold text-slate-300"
                >
                  <Clock className="w-3 h-3 mr-1.5 text-indigo-400" />
                  {EPGService.formatTime(mark)}
                </div>
              ))}
            </div>

            {/* Red Current Time Line Marker */}
            <div
              style={{ left: `${currentMarkerOffset}px` }}
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none shadow-[0_0_12px_rgba(239,68,68,0.9)]"
            >
              <div className="w-3 h-3 rounded-full bg-red-500 -ml-1.25 shadow-md flex items-center justify-center">
                <div className="w-1 h-1 rounded-full bg-white animate-ping" />
              </div>
            </div>

            {/* Channel Program Rows */}
            <div className="divide-y divide-white/5">
              {visibleChannels.map((ch) => {
                const programs = epgData[ch.id] || generateDynamicEPG(ch.id);
                const isLocked = isChannelLocked(ch) && !isSessionUnlocked;

                return (
                  <div key={ch.id} className="h-20 relative flex items-center hover:bg-white/[0.04] transition">
                    {programs.map((p) => {
                      const startOffsetMins = Math.max(0, (p.start - baseTimelineStart) / (60 * 1000));
                      const durationMins = (p.end - p.start) / (60 * 1000);
                      const isLiveNow = currentTime >= p.start && currentTime < p.end;
                      const hasReminder = isReminderSet(p.id);

                      return (
                        <div
                          key={p.id}
                          onClick={() => handleProgramClick(p, ch)}
                          style={{
                            left: `${startOffsetMins * minuteWidth}px`,
                            width: `${Math.max(60, durationMins * minuteWidth - 4)}px`,
                          }}
                          className={`absolute h-16 rounded-2xl p-2.5 flex flex-col justify-between border transition-all cursor-pointer overflow-hidden backdrop-blur-xl ${
                            isLiveNow
                              ? 'bg-indigo-600/30 border-indigo-500/60 shadow-lg shadow-indigo-500/20 hover:bg-indigo-600/40'
                              : 'bg-slate-950/60 border-white/10 hover:bg-white/15 hover:border-white/30'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] font-mono text-slate-300 font-semibold">
                                {EPGService.formatTime(p.start)} - {EPGService.formatTime(p.end)}
                              </span>
                              <div className="flex items-center gap-1">
                                {isLiveNow && (
                                  <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-red-500 text-white shadow-xs">
                                    EN DIRECT
                                  </span>
                                )}
                                {hasReminder && (
                                  <BellRing className="w-3 h-3 text-amber-400 shrink-0" />
                                )}
                              </div>
                            </div>
                            <h4 className="text-xs font-bold text-white truncate mt-0.5">
                              {isLocked ? '•••••••• (Verrouillé)' : p.title}
                            </h4>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="truncate">{p.category || 'Généraliste'}</span>
                            <span>{EPGService.formatDuration(p.start, p.end)}</span>
                          </div>

                          {/* Mini Progress Bar for Live Program */}
                          {isLiveNow && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                              <div
                                className="h-full bg-indigo-500"
                                style={{ width: `${EPGService.getProgressPercentage(p)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Program Details Modal */}
      {selectedProgram && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-950/95 border border-white/15 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            {/* Header Banner */}
            <div className="relative h-44 bg-gradient-to-t from-slate-950 via-indigo-950/50 to-transparent p-6 flex flex-col justify-end">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-bold font-mono">
                    {selectedProgram.channel.name}
                  </span>
                  {selectedProgram.program.rating && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold">
                      {selectedProgram.program.rating}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setSelectedProgram(null)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <h2 className="text-xl sm:text-2xl font-extrabold text-white mt-2 tracking-tight">
                {selectedProgram.program.title}
              </h2>
              <div className="text-xs text-slate-300 flex items-center gap-2 mt-1 flex-wrap">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>
                  {EPGService.formatTime(selectedProgram.program.start)} - {EPGService.formatTime(selectedProgram.program.end)}
                </span>
                <span>•</span>
                <span>{EPGService.formatDuration(selectedProgram.program.start, selectedProgram.program.end)}</span>
                <span>•</span>
                <span className="text-indigo-400 font-semibold">{selectedProgram.program.category}</span>
              </div>
            </div>

            {/* Body Description */}
            <div className="p-6 space-y-4">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Synopsis & Informations
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedProgram.program.description || 'Aucun résumé détaillé disponible pour ce programme.'}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-3 border-t border-white/10">
                <button
                  onClick={() => {
                    handleSelectAndTuneChannel(selectedProgram.channel);
                    setSelectedProgram(null);
                  }}
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/30 transition cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-white" />
                  Zapper sur cette chaîne
                </button>

                <button
                  onClick={() => toggleProgramReminder(selectedProgram.program, selectedProgram.channel)}
                  className={`py-3 px-4 rounded-2xl text-xs font-semibold border flex items-center gap-2 transition cursor-pointer ${
                    isReminderSet(selectedProgram.program.id)
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-white/5 text-slate-200 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {isReminderSet(selectedProgram.program.id) ? (
                    <>
                      <BellRing className="w-4 h-4 text-amber-400" />
                      Rappel Actif
                    </>
                  ) : (
                    <>
                      <Bell className="w-4 h-4" />
                      M'avertir
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
