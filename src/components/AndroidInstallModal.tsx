import React, { useState } from 'react';
import { 
  Smartphone, 
  Tv, 
  Download, 
  Check, 
  Copy, 
  ExternalLink, 
  X, 
  Sparkles, 
  Tablet, 
  Share2, 
  HelpCircle,
  QrCode
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface AndroidInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AndroidInstallModal: React.FC<AndroidInstallModalProps> = ({ isOpen, onClose }) => {
  const { canInstall, isInstalled, isAndroid, promptInstall } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<'android_phone' | 'android_tv' | 'qr'>('android_phone');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [installStatus, setInstallStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentUrl = window.location.href;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(currentUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleTriggerInstall = async () => {
    if (canInstall) {
      setInstallStatus('Lancement de l\'installation Android...');
      const success = await promptInstall();
      if (success) {
        setInstallStatus('Application installée avec succès !');
        setTimeout(() => onClose(), 2000);
      } else {
        setInstallStatus(null);
      }
    } else {
      setActiveTab('android_phone');
    }
  };

  return (
    <div 
      id="android-install-modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-slate-950/95 border border-white/15 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5 text-left max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 p-0.5 shadow-lg shadow-emerald-500/20 flex items-center justify-center">
              <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center text-emerald-400">
                <Smartphone className="w-6 h-6" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">Installer sur Android</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  PWA / APK
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Profitez d'une expérience plein écran native, sans barre d'adresse et ultra-rapide.
              </p>
            </div>
          </div>
          <button
            id="close-android-install-modal-btn"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1-Click Install Banner (if prompt available) */}
        {canInstall && !isInstalled && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-md">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">Installation Directe Prête</div>
                <div className="text-xs text-emerald-200/80">Ajouter directement l'application à l'écran d'accueil</div>
              </div>
            </div>
            <button
              id="direct-pwa-install-btn"
              onClick={handleTriggerInstall}
              className="w-full sm:w-auto px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30 transition active:scale-95 cursor-pointer shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Installer maintenant</span>
            </button>
          </div>
        )}

        {isInstalled && (
          <div className="p-4 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
              <Check className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Application déjà installée</div>
              <div className="text-[11px] text-indigo-200">L'application fonctionne en mode autonome sur cet appareil.</div>
            </div>
          </div>
        )}

        {installStatus && (
          <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs font-medium text-center border border-emerald-500/30">
            {installStatus}
          </div>
        )}

        {/* Tab Selection */}
        <div className="flex items-center gap-1.5 p-1 bg-white/5 rounded-2xl border border-white/10">
          <button
            onClick={() => setActiveTab('android_phone')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer ${
              activeTab === 'android_phone'
                ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Smartphone & Tablette</span>
          </button>
          <button
            onClick={() => setActiveTab('android_tv')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer ${
              activeTab === 'android_tv'
                ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Tv className="w-3.5 h-3.5" />
            <span>Android TV & Box</span>
          </button>
          <button
            onClick={() => setActiveTab('qr')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer ${
              activeTab === 'qr'
                ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Ouvrir sur mobile</span>
          </button>
        </div>

        {/* TAB 1: Smartphone & Tablette (Chrome / Samsung / Brave) */}
        {activeTab === 'android_phone' && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-mono">1</span>
                <span>Ouvrez dans Chrome, Brave ou Samsung Internet</span>
              </div>
              <p className="text-slate-300 pl-7 text-[11px] leading-relaxed">
                Rendez-vous sur l'adresse du lecteur depuis votre navigateur Android habituel.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-mono">2</span>
                <span>Appuyez sur le menu du navigateur (3 points ⋮)</span>
              </div>
              <p className="text-slate-300 pl-7 text-[11px] leading-relaxed">
                Appuyez sur le menu en haut à droite (ou en bas sur Samsung Internet).
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px] font-mono">3</span>
                <span>Sélectionnez « Installer l'application » ou « Ajouter à l'écran d'accueil »</span>
              </div>
              <p className="text-slate-300 pl-7 text-[11px] leading-relaxed">
                L'icône <strong className="text-white">iSTB Player</strong> s'ajoutera à vos applications Android avec lancement en plein écran, sans latence et avec prise en charge du contrôle tactile et de la télécommande.
              </p>
            </div>
          </div>
        )}

        {/* TAB 2: Android TV / Google TV / Fire TV */}
        {activeTab === 'android_tv' && (
          <div className="space-y-3 text-xs">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2.5">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <Tv className="w-4 h-4 text-indigo-400" />
                <span>Box Android TV, Google TV, Fire TV & Smart TV</span>
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                Pour utiliser l'application sur votre TV avec votre télécommande physique :
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-slate-300 text-[11px]">
                <li>Ouvrez le navigateur TV (ex: <strong>Puffin TV</strong>, <strong>JioPages TV</strong>, <strong>Open TV Browser</strong> ou <strong>Amazon Silk</strong> sur Fire TV).</li>
                <li>Tapez l'adresse URL du lecteur ou envoyez-la via l'application <strong>Send Files to TV</strong>.</li>
                <li>Activez le mode <strong>Smart TV</strong> dans l'en-tête pour bénéficier de la navigation D-Pad (Touches fléchées de votre télécommande).</li>
                <li>Ajoutez la page en favori ou écran d'accueil sur le navigateur TV.</li>
              </ul>
            </div>
          </div>
        )}

        {/* TAB 3: QR Code & Link Sharing */}
        {activeTab === 'qr' && (
          <div className="space-y-4 text-center">
            <p className="text-xs text-slate-300">
              Scannez ce QR Code avec l'appareil photo de votre smartphone ou tablette Android pour ouvrir directement le lecteur :
            </p>

            <div className="p-4 bg-white rounded-2xl inline-block shadow-xl mx-auto">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(currentUrl)}`}
                alt="QR Code d'installation"
                className="w-44 h-44 mx-auto rounded-lg"
              />
            </div>

            <div className="flex items-center gap-2 max-w-md mx-auto">
              <input 
                type="text" 
                readOnly 
                value={currentUrl} 
                className="flex-1 bg-white/5 border border-white/10 px-3 py-2 rounded-xl text-[11px] font-mono text-slate-300 truncate outline-none"
              />
              <button
                onClick={handleCopyLink}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer shrink-0"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Copié !' : 'Copier'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-white/10">
          <button
            onClick={handleCopyLink}
            className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Lien copié' : 'Copier l\'adresse'}</span>
          </button>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg transition active:scale-95 cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
