import React, { useState } from 'react';
import { 
  LayoutGrid, 
  Volume2, 
  VolumeX, 
  Plus, 
  Tv, 
  ChevronDown 
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';
import { Channel } from '../types/iptv';
import { LivePlayer } from './LivePlayer';

export const MultiView: React.FC = () => {
  const { channels, filteredChannels } = useIPTV();

  const [layout, setLayout] = useState<'2x2' | '1+3' | '2x1'>('2x2');
  const [activeAudioSlot, setActiveAudioSlot] = useState<number>(0);
  
  // Selected channel per slot (4 slots max)
  const [selectedChannels, setSelectedChannels] = useState<(Channel | null)[]>([
    channels[0] || null,
    channels[1] || null,
    channels[4] || null,
    channels[5] || null,
  ]);

  const [pickingSlotIndex, setPickingSlotIndex] = useState<number | null>(null);

  const handleSelectChannelForSlot = (channel: Channel, slotIdx: number) => {
    setSelectedChannels((prev) => {
      const next = [...prev];
      next[slotIdx] = channel;
      return next;
    });
    setPickingSlotIndex(null);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-transparent text-slate-100 overflow-hidden select-none">
      {/* Header (Frosted Glass) */}
      <div className="p-6 bg-white/[0.03] backdrop-blur-2xl border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <LayoutGrid className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">Multi-Écrans (Multi-View)</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30">
                PRO
              </span>
            </div>
            <p className="text-xs text-slate-400">Regardez jusqu'à 4 chaînes en direct simultanément</p>
          </div>
        </div>

        {/* Layout Switcher */}
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-full border border-white/10">
          <button
            onClick={() => setLayout('2x2')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
              layout === '2x2' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Grille 2x2
          </button>
          <button
            onClick={() => setLayout('1+3')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
              layout === '1+3' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            1 Grand + 3
          </button>
          <button
            onClick={() => setLayout('2x1')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
              layout === '2x1' ? 'bg-white/15 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            Double 2x1
          </button>
        </div>
      </div>

      {/* Grid Canvas */}
      <div className="flex-1 p-4 grid gap-4 overflow-hidden">
        {layout === '2x2' && (
          <div className="grid grid-cols-2 grid-rows-2 gap-4 h-full">
            {[0, 1, 2, 3].map((slotIdx) => (
              <SlotTile
                key={slotIdx}
                slotIdx={slotIdx}
                channel={selectedChannels[slotIdx]}
                hasAudio={activeAudioSlot === slotIdx}
                onSelectAudio={() => setActiveAudioSlot(slotIdx)}
                onChangeChannel={() => setPickingSlotIndex(slotIdx)}
              />
            ))}
          </div>
        )}

        {layout === '1+3' && (
          <div className="grid grid-cols-3 grid-rows-3 gap-4 h-full">
            {/* Big tile */}
            <div className="col-span-2 row-span-3">
              <SlotTile
                slotIdx={0}
                channel={selectedChannels[0]}
                hasAudio={activeAudioSlot === 0}
                onSelectAudio={() => setActiveAudioSlot(0)}
                onChangeChannel={() => setPickingSlotIndex(0)}
              />
            </div>
            {/* 3 small tiles on right */}
            {[1, 2, 3].map((slotIdx) => (
              <div key={slotIdx} className="col-span-1 row-span-1">
                <SlotTile
                  slotIdx={slotIdx}
                  channel={selectedChannels[slotIdx]}
                  hasAudio={activeAudioSlot === slotIdx}
                  onSelectAudio={() => setActiveAudioSlot(slotIdx)}
                  onChangeChannel={() => setPickingSlotIndex(slotIdx)}
                />
              </div>
            ))}
          </div>
        )}

        {layout === '2x1' && (
          <div className="grid grid-cols-2 gap-4 h-full">
            {[0, 1].map((slotIdx) => (
              <SlotTile
                key={slotIdx}
                slotIdx={slotIdx}
                channel={selectedChannels[slotIdx]}
                hasAudio={activeAudioSlot === slotIdx}
                onSelectAudio={() => setActiveAudioSlot(slotIdx)}
                onChangeChannel={() => setPickingSlotIndex(slotIdx)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Channel Picker Modal for Slot */}
      {pickingSlotIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-950/80 backdrop-blur-3xl border border-white/15 rounded-3xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                Choisir une chaîne pour l'écran {pickingSlotIndex + 1}
              </h3>
              <button
                onClick={() => setPickingSlotIndex(null)}
                className="w-8 h-8 rounded-full bg-white/10 text-slate-300 hover:text-white flex items-center justify-center transition"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {filteredChannels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => handleSelectChannelForSlot(ch, pickingSlotIndex)}
                  className="w-full p-3 rounded-2xl bg-white/[0.04] hover:bg-indigo-500/20 border border-white/10 hover:border-indigo-500/40 text-left flex items-center justify-between transition"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-bold text-indigo-400">#{ch.number}</span>
                    <span className="text-xs font-bold text-white">{ch.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">{ch.category}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface SlotTileProps {
  slotIdx: number;
  channel: Channel | null;
  hasAudio: boolean;
  onSelectAudio: () => void;
  onChangeChannel: () => void;
}

const SlotTile: React.FC<SlotTileProps> = ({
  channel,
  hasAudio,
  onSelectAudio,
  onChangeChannel,
}) => {
  return (
    <div
      className={`relative h-full w-full bg-black/50 rounded-3xl overflow-hidden border backdrop-blur-xl transition-all ${
        hasAudio ? 'border-indigo-500 shadow-xl shadow-indigo-500/25 ring-2 ring-indigo-500/30' : 'border-white/10 hover:border-white/20'
      }`}
    >
      {channel ? (
        <>
          <LivePlayer channelOverride={channel} />
          {/* Audio selector & channel badge bar */}
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-auto z-30">
            <button
              onClick={onChangeChannel}
              className="px-3.5 py-1.5 rounded-full bg-slate-950/80 hover:bg-slate-900 border border-white/15 text-xs font-bold text-white flex items-center gap-2 backdrop-blur-md transition shadow-md"
            >
              <Tv className="w-3.5 h-3.5 text-indigo-400" />
              <span>{channel.name}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            <button
              onClick={onSelectAudio}
              className={`p-2.5 rounded-full backdrop-blur-md border transition ${
                hasAudio
                  ? 'bg-indigo-500 text-white border-indigo-400 shadow-lg shadow-indigo-500/40'
                  : 'bg-slate-950/80 text-slate-400 border-white/10 hover:text-white'
              }`}
              title={hasAudio ? 'Son Actif' : 'Activer le son pour cet écran'}
            >
              {hasAudio ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
        </>
      ) : (
        <div className="h-full flex flex-col items-center justify-center p-4 text-center">
          <button
            onClick={onChangeChannel}
            className="w-14 h-14 rounded-full bg-white/5 hover:bg-indigo-500 border border-white/10 text-white flex items-center justify-center mb-3 transition shadow-lg"
          >
            <Plus className="w-6 h-6" />
          </button>
          <span className="text-xs font-bold text-slate-300">Ajouter un canal</span>
        </div>
      )}
    </div>
  );
};
