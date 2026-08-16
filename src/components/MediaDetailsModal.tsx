import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export interface MediaDetailsInfo {
  videoCodec?: string;
  resolution?: string;
  fps?: string;
  audioCodec?: string;
  audioChannels?: string;
  url: string;
}

interface MediaDetailsModalProps {
  details: MediaDetailsInfo;
  onClose: () => void;
}

export const MediaDetailsModal: React.FC<MediaDetailsModalProps> = ({ details, onClose }) => {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopyUrl = async () => {
    if (!details.url) return;
    try {
      await navigator.clipboard.writeText(details.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback if clipboard API is restricted
      const textarea = document.createElement('textarea');
      textarea.value = details.url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const videoText = `${details.videoCodec || 'h264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10'} ${details.resolution || '1920.0x1080.0'} ${details.fps || '50.0fps'}`;
  const audioText = `${details.audioCodec || 'aac AAC (Advanced Audio Coding)'} ${details.audioChannels || '2 channels'}`;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-md animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      <div 
        className="bg-[#2c2c2e]/95 text-white rounded-[28px] p-6 max-w-md w-full shadow-2xl border border-white/15 backdrop-blur-2xl space-y-4 pointer-events-auto select-text"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold text-white tracking-tight">
          Détails du média
        </h3>

        <div className="space-y-3.5 text-sm text-slate-100 leading-relaxed font-normal">
          <p>
            <span className="font-semibold text-white">Vidéo: </span>
            {videoText}
          </p>
          <p>
            <span className="font-semibold text-white">Audio: </span>
            {audioText}
          </p>
          <p className="break-all">
            <span className="font-semibold text-white">URL: </span>
            {details.url || 'http://stream.iptv.net/live.php'}
          </p>
        </div>

        {/* Action Buttons: OK and Copier l'URL */}
        <div className="flex items-center gap-3 pt-3">
          <button
            onClick={onClose}
            className="flex-1 py-3.5 px-6 rounded-2xl bg-white/15 hover:bg-white/25 active:scale-95 text-white font-bold text-sm transition-all text-center cursor-pointer shadow-sm"
          >
            OK
          </button>
          <button
            onClick={handleCopyUrl}
            className={`flex-1 py-3.5 px-6 rounded-2xl font-bold text-sm transition-all text-center flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-95 ${
              copied 
                ? 'bg-green-600 text-white' 
                : 'bg-white/15 hover:bg-white/25 text-white'
            }`}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-white" />
                <span>Copié !</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-white" />
                <span>Copier l'URL</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
