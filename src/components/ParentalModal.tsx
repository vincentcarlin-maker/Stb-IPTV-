import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Unlock, 
  KeyRound, 
  Check, 
  HelpCircle,
  Lock
} from 'lucide-react';
import { useIPTV } from '../context/IPTVContext';

interface ParentalModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'verify' | 'manage';
}

export const ParentalModal: React.FC<ParentalModalProps> = ({
  isOpen,
  onClose,
  mode = 'verify',
}) => {
  const {
    parentalSettings,
    updateParentalSettings,
    unlockSessionWithPin,
    lockSession,
    isSessionUnlocked,
    pinModalTitle,
    handlePinSuccess,
  } = useIPTV();

  const [activeTab, setActiveTab] = useState<'keypad' | 'settings' | 'recovery'>(
    mode === 'manage' || isSessionUnlocked ? 'settings' : 'keypad'
  );

  const [enteredPin, setEnteredPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState<boolean>(false);

  // Settings tab form states
  const [newPin, setNewPin] = useState<string>('');
  const [confirmNewPin, setConfirmNewPin] = useState<string>('');
  const [settingsSuccessMsg, setSettingsSuccessMsg] = useState<string | null>(null);

  // Recovery states
  const [recoveryAnswer, setRecoveryAnswer] = useState<string>('');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEnteredPin('');
      setErrorMsg(null);
      setSettingsSuccessMsg(null);
      setRecoveryError(null);
      if (mode === 'manage' && !isSessionUnlocked) {
        setActiveTab('keypad');
      } else if (isSessionUnlocked) {
        setActiveTab('settings');
      } else {
        setActiveTab('keypad');
      }
    }
  }, [isOpen, mode, isSessionUnlocked]);

  if (!isOpen) return null;

  const handleDigitPress = (digit: string) => {
    if (enteredPin.length < 4) {
      const updated = enteredPin + digit;
      setEnteredPin(updated);
      setErrorMsg(null);

      // Auto submit on 4th digit
      if (updated.length === 4) {
        validatePin(updated);
      }
    }
  };

  const handleDelete = () => {
    setEnteredPin((prev) => prev.slice(0, -1));
    setErrorMsg(null);
  };

  const handleClear = () => {
    setEnteredPin('');
    setErrorMsg(null);
  };

  const validatePin = (pinToTest: string) => {
    if (pinToTest === parentalSettings.pinCode) {
      unlockSessionWithPin(pinToTest);
      handlePinSuccess();
      if (mode === 'manage') {
        setActiveTab('settings');
      } else {
        onClose();
      }
    } else {
      setIsShaking(true);
      setErrorMsg('Code PIN incorrect. Veuillez réessayer.');
      setTimeout(() => {
        setIsShaking(false);
        setEnteredPin('');
      }, 600);
    }
  };

  const handleSaveNewPin = () => {
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setErrorMsg('Le code PIN doit comporter exactement 4 chiffres.');
      return;
    }
    if (newPin !== confirmNewPin) {
      setErrorMsg('Les deux codes PIN ne correspondent pas.');
      return;
    }

    updateParentalSettings({ pinCode: newPin });
    setSettingsSuccessMsg('Code PIN modifié avec succès ! (Nouveau code : ' + newPin + ')');
    setNewPin('');
    setConfirmNewPin('');
  };

  const handleCategoryToggle = (category: string) => {
    const current = parentalSettings.lockedCategories;
    const updated = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    updateParentalSettings({ lockedCategories: updated });
  };

  const handleRatingToggle = (rating: string) => {
    const current = parentalSettings.lockedRatings;
    const updated = current.includes(rating)
      ? current.filter((r) => r !== rating)
      : [...current, rating];
    updateParentalSettings({ lockedRatings: updated });
  };

  const handleRecoverySubmit = () => {
    if (recoveryAnswer.trim().toLowerCase() === parentalSettings.securityAnswer.trim().toLowerCase()) {
      updateParentalSettings({ pinCode: '0000' });
      setSettingsSuccessMsg('Code PIN réinitialisé par défaut à 0000.');
      setActiveTab('keypad');
      setEnteredPin('');
    } else {
      setRecoveryError('Réponse de sécurité incorrecte.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="bg-slate-950/85 backdrop-blur-3xl border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-6 bg-white/[0.02] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              {isSessionUnlocked ? <Unlock className="w-5 h-5 text-amber-400" /> : <ShieldCheck className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white">
                {activeTab === 'settings' ? 'Gestion Contrôle Parental' : pinModalTitle || 'Contrôle Parental'}
              </h2>
              <p className="text-xs text-slate-400">
                {activeTab === 'settings' ? 'Paramètres de sécurité & verrouillage' : 'Protection par code PIN à 4 chiffres'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        {(isSessionUnlocked || mode === 'manage') && (
          <div className="flex bg-white/[0.02] px-6 pt-3 gap-2 border-b border-white/10">
            <button
              onClick={() => setActiveTab('keypad')}
              className={`px-4 py-2 rounded-t-xl text-xs font-bold transition ${
                activeTab === 'keypad' ? 'bg-white/10 text-indigo-300 border-t border-x border-white/15' : 'text-slate-400 hover:text-white'
              }`}
            >
              Clavier PIN
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 rounded-t-xl text-xs font-bold transition ${
                activeTab === 'settings' ? 'bg-white/10 text-indigo-300 border-t border-x border-white/15' : 'text-slate-400 hover:text-white'
              }`}
            >
              Configuration
            </button>
          </div>
        )}

        {/* TAB 1: PIN KEYPAD */}
        {activeTab === 'keypad' && (
          <div className="p-6 flex flex-col items-center">
            {/* PIN Dots Indicator */}
            <div
              className={`flex items-center gap-3.5 my-4 ${
                isShaking ? 'animate-shake' : ''
              }`}
            >
              {[0, 1, 2, 3].map((idx) => {
                const filled = enteredPin.length > idx;
                return (
                  <div
                    key={idx}
                    className={`w-4 h-4 rounded-full transition-all duration-150 ${
                      filled
                        ? 'bg-indigo-400 scale-125 shadow-lg shadow-indigo-400/50'
                        : 'border-2 border-white/20 bg-white/5'
                    }`}
                  />
                );
              })}
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div className="text-xs font-bold text-red-400 mb-3 text-center">
                {errorMsg}
              </div>
            )}

            {/* Numeric Keypad Grid */}
            <div className="grid grid-cols-3 gap-3 w-64 my-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  onClick={() => handleDigitPress(digit)}
                  className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-indigo-500 border border-white/10 text-xl font-bold text-white transition flex items-center justify-center cursor-pointer shadow-sm active:scale-95"
                >
                  {digit}
                </button>
              ))}
              <button
                onClick={handleClear}
                className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-400 hover:text-white transition flex items-center justify-center"
              >
                EFFACER
              </button>
              <button
                onClick={() => handleDigitPress('0')}
                className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 active:bg-indigo-500 border border-white/10 text-xl font-bold text-white transition flex items-center justify-center cursor-pointer shadow-sm active:scale-95"
              >
                0
              </button>
              <button
                onClick={handleDelete}
                className="h-14 rounded-2xl bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-400 hover:text-white transition flex items-center justify-center"
              >
                ⌫
              </button>
            </div>

            <div className="w-full flex items-center justify-between text-[11px] text-slate-400 mt-4 pt-4 border-t border-white/10">
              <span className="font-mono">Code par défaut : 0000</span>
              <button
                onClick={() => setActiveTab('recovery')}
                className="text-indigo-400 hover:underline"
              >
                Code oublié ?
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: CONFIGURATION & SETTINGS */}
        {activeTab === 'settings' && (
          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
            {settingsSuccessMsg && (
              <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2">
                <Check className="w-4 h-4" />
                {settingsSuccessMsg}
              </div>
            )}

            {/* Master Toggle */}
            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white">Activer le Contrôle Parental</div>
                <div className="text-[10px] text-slate-400">Verrouille l'accès aux flux sensibles et adultes</div>
              </div>
              <input
                type="checkbox"
                checked={parentalSettings.enabled}
                onChange={(e) => updateParentalSettings({ enabled: e.target.checked })}
                className="w-4 h-4 accent-indigo-500 cursor-pointer"
              />
            </div>

            {/* Change Master PIN Code */}
            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10 space-y-3">
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-indigo-400" />
                Modifier le code PIN
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Nouveau code (4 chiffres)</label>
                  <input
                    type="password"
                    maxLength={4}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    placeholder="Ex: 1234"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-400 font-mono tracking-widest text-center"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Confirmer nouveau code</label>
                  <input
                    type="password"
                    maxLength={4}
                    value={confirmNewPin}
                    onChange={(e) => setConfirmNewPin(e.target.value)}
                    placeholder="Ex: 1234"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-400 font-mono tracking-widest text-center"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveNewPin}
                className="w-full py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold transition shadow-lg shadow-indigo-500/25"
              >
                Enregistrer le nouveau code PIN
              </button>
            </div>

            {/* Locked Categories */}
            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10 space-y-2.5">
              <div className="text-xs font-bold text-white">Catégories Verrouillées</div>
              <div className="grid grid-cols-2 gap-2">
                {['Adulte / +18', 'Charme', 'Horreur 18+', 'Cinéma & Séries', 'Sport', 'Généraliste'].map((cat) => {
                  const isLocked = parentalSettings.lockedCategories.includes(cat);
                  return (
                    <button
                      key={cat}
                      onClick={() => handleCategoryToggle(cat)}
                      className={`p-2.5 rounded-xl border text-left text-xs font-semibold flex items-center justify-between transition cursor-pointer ${
                        isLocked
                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                          : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
                      }`}
                    >
                      <span>{cat}</span>
                      {isLocked ? <Lock className="w-3 h-3 text-red-400" /> : <Unlock className="w-3 h-3 text-slate-600" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Locked Ratings */}
            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10 space-y-2">
              <div className="text-xs font-bold text-white">Classification d'âge minimale à verrouiller</div>
              <div className="flex gap-2">
                {['12+', '16+', '18+'].map((rating) => {
                  const isLocked = parentalSettings.lockedRatings.includes(rating);
                  return (
                    <button
                      key={rating}
                      onClick={() => handleRatingToggle(rating)}
                      className={`flex-1 py-2 rounded-xl border text-xs font-bold transition ${
                        isLocked
                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                          : 'bg-white/5 text-slate-400 border-white/10'
                      }`}
                    >
                      {rating}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Lock Session action */}
            {isSessionUnlocked && (
              <button
                onClick={() => {
                  lockSession();
                  onClose();
                }}
                className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-amber-400 text-xs font-bold flex items-center justify-center gap-2 border border-white/10 transition"
              >
                <Lock className="w-4 h-4" />
                Verrouiller la session maintenant
              </button>
            )}
          </div>
        )}

        {/* TAB 3: RECOVERY */}
        {activeTab === 'recovery' && (
          <div className="p-6 space-y-4">
            <div className="text-center">
              <HelpCircle className="w-10 h-10 text-indigo-400 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-white">Récupération du Code PIN</h3>
              <p className="text-xs text-slate-400 mt-1">
                Répondez à la question secrète pour réinitialiser le code PIN à 0000.
              </p>
            </div>

            <div className="p-4 bg-white/[0.04] rounded-2xl border border-white/10">
              <div className="text-[10px] uppercase font-bold text-slate-400">Question Secrète :</div>
              <div className="text-xs font-semibold text-white mt-0.5">{parentalSettings.securityQuestion}</div>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Votre réponse :</label>
              <input
                type="text"
                value={recoveryAnswer}
                onChange={(e) => setRecoveryAnswer(e.target.value)}
                placeholder="Ex: Paris"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-400"
              />
            </div>

            {recoveryError && (
              <div className="text-xs font-bold text-red-400">{recoveryError}</div>
            )}

            <div className="flex gap-2.5">
              <button
                onClick={() => setActiveTab('keypad')}
                className="flex-1 py-2.5 rounded-xl bg-white/5 text-slate-300 text-xs font-bold hover:bg-white/10"
              >
                Retour
              </button>
              <button
                onClick={handleRecoverySubmit}
                className="flex-1 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold shadow-lg shadow-indigo-500/25"
              >
                Valider & Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
