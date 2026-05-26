import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Palette, Settings2, Sliders, Mic, KeyRound } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../App';

interface VoiceProfile {
    pitchMin: number;
    pitchMax: number;
    pitchAvg: number;
    centroidAvg: number;
    isCalibrated: boolean;
}

interface Settings {
    accentColor: string;
    hudDensity: number;
    animationSpeed: number;
    showUplink: boolean;
    showCoreTemp: boolean;
    showClimate: boolean;
    showGeodata: boolean;
    showScanlines: boolean;
    showMetricsBtn: boolean;
    alwaysOnVoice: boolean;
    voiceLock: boolean;
    voicePitch: number;
    voiceProfile?: VoiceProfile;
}

interface ApiStatusItem {
    configured: boolean;
    exhausted: boolean;
    masked: string | null;
}

interface ApiStatus {
    gemini: ApiStatusItem;
    openai: ApiStatusItem;
}

interface SettingsDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    settings: Settings;
    onUpdate: (newSettings: Settings) => void;
    onOpenVoiceWizard?: () => void;
    apiStatus: ApiStatus | null;
    onSaveKeys: (geminiKey: string, openaiKey: string) => Promise<void>;
}

const COLORS = [
    { name: 'Burned Orange', value: '#ff8c00' },
    { name: 'Stark Red', value: '#e23636' },
    { name: 'S.H.I.E.L.D Blue', value: '#00ccff' },
    { name: 'Gamma Green', value: '#3cff00' },
    { name: 'Vibranium Purple', value: '#a036e2' },
];

const TOGGLES = [
    { key: 'showUplink', label: 'Uplink Bandwidth' },
    { key: 'showCoreTemp', label: 'Core Temperature' },
    { key: 'showClimate', label: 'Climate Data' },
    { key: 'showGeodata', label: 'Geolocation' },
    { key: 'showScanlines', label: 'Scanline Effect' },
    { key: 'showMetricsBtn', label: 'Metrics Analysis Button' },
] as const;

export default function SettingsDrawer({ 
    isOpen, 
    onClose, 
    settings, 
    onUpdate,
    onOpenVoiceWizard,
    apiStatus,
    onSaveKeys
}: SettingsDrawerProps) {
    const [localGeminiKey, setLocalGeminiKey] = useState('');
    const [localOpenaiKey, setLocalOpenaiKey] = useState('');
    const [isSavingKeys, setIsSavingKeys] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setLocalGeminiKey('');
            setLocalOpenaiKey('');
        }
    }, [isOpen]);

    const handleSaveApiKeys = async () => {
        setIsSavingKeys(true);
        try {
            await onSaveKeys(localGeminiKey, localOpenaiKey);
        } catch (err) {
            console.error("Failed to save keys:", err);
        } finally {
            setIsSavingKeys(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
                    />
                    <motion.div 
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed right-0 top-0 h-full w-full sm:w-80 bg-[#0d0000] border-l z-[70] p-6 shadow-[-10px_0_30px_rgba(0,0,0,0.5)] overflow-y-auto"
                        style={{ borderColor: settings.accentColor + '33' }}
                    >
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3" style={{ color: settings.accentColor }}>
                                <Settings2 className="animate-spin-slow" />
                                <h2 className="font-orbitron font-bold tracking-widest uppercase">System Config</h2>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full" style={{ color: settings.accentColor }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex flex-col gap-8">
                            {/* Color Selection */}
                            <section>
                                <div className="flex items-center gap-2 text-[10px] mb-4 tracking-tighter font-mono" style={{ color: settings.accentColor + '66' }}>
                                    <Palette size={12} />
                                    <span>PRIMARY_CHROMA_SYNC</span>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    {COLORS.map((color) => (
                                        <button
                                            key={color.value}
                                            onClick={() => onUpdate({ ...settings, accentColor: color.value })}
                                            className={`w-8 h-8 rounded-full border-2 transition-all ${settings.accentColor === color.value ? 'scale-110 border-white' : 'border-black opacity-60 hover:opacity-100'}`}
                                            style={{ backgroundColor: color.value }}
                                            title={color.name}
                                        />
                                    ))}
                                </div>
                            </section>

                            {/* Component Toggles */}
                            <section>
                                <div className="flex items-center gap-2 text-[10px] mb-4 tracking-tighter font-mono" style={{ color: settings.accentColor + '66' }}>
                                    <Sliders size={12} />
                                    <span>COMPONENT_VISIBILITY</span>
                                </div>
                                <div className="flex flex-col gap-3">
                                    {TOGGLES.map((toggle) => (
                                        <div key={toggle.key} className="flex items-center justify-between group cursor-pointer" onClick={() => onUpdate({ ...settings, [toggle.key]: !settings[toggle.key as keyof Settings] })}>
                                            <span className="text-[10px] font-mono tracking-widest uppercase group-hover:text-white transition-colors" style={{ color: settings.accentColor + '99' }}>
                                                {toggle.label}
                                            </span>
                                            <div className="w-8 h-4 rounded-full border relative transition-all" style={{ borderColor: settings.accentColor + '44', backgroundColor: settings[toggle.key as keyof Settings] ? settings.accentColor + '33' : 'transparent' }}>
                                                <motion.div 
                                                    animate={{ x: settings[toggle.key as keyof Settings] ? 16 : 2 }}
                                                    className="absolute top-1 w-2 h-2 rounded-full"
                                                    style={{ backgroundColor: settings[toggle.key as keyof Settings] ? settings.accentColor : settings.accentColor + '33' }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {/* Sliders */}
                            <section className="flex flex-col gap-6">
                                <div className="space-y-4">
                                    <div className="flex justify-between text-[10px] font-mono tracking-widest">
                                        <span className="uppercase" style={{ color: settings.accentColor + '99' }}>Animation_Velocity</span>
                                        <span style={{ color: settings.accentColor }}>{settings.animationSpeed.toFixed(1)}x</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="0.5" 
                                        max="3" 
                                        step="0.1"
                                        value={settings.animationSpeed}
                                        onChange={(e) => onUpdate({ ...settings, animationSpeed: parseFloat(e.target.value) })}
                                        className="w-full h-1 rounded-lg appearance-none cursor-pointer"
                                        style={{ accentColor: settings.accentColor, backgroundColor: settings.accentColor + '22' }}
                                    />
                                </div>

                                <div className="space-y-4">
                                    <div className="flex justify-between text-[10px] font-mono tracking-widest">
                                        <span className="uppercase" style={{ color: settings.accentColor + '99' }}>HUD_Density_Filter</span>
                                        <span style={{ color: settings.accentColor }}>{Math.round(settings.hudDensity * 100)}%</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max="1" 
                                        step="0.1"
                                        value={settings.hudDensity}
                                        onChange={(e) => onUpdate({ ...settings, hudDensity: parseFloat(e.target.value) })}
                                        className="w-full h-1 rounded-lg appearance-none cursor-pointer"
                                        style={{ accentColor: settings.accentColor, backgroundColor: settings.accentColor + '22' }}
                                    />
                                </div>
                            </section>

                            {/* Voice Biometrics Calibration */}
                            <section className="mt-4 pt-4 border-t border-orange-500/10">
                                <div className="flex items-center gap-2 text-[10px] mb-4 tracking-tighter font-mono" style={{ color: settings.accentColor + '66' }}>
                                    <Mic size={12} />
                                    <span>BIOMETRIC_VOICE_LOCK</span>
                                </div>
                                
                                <div className="flex flex-col gap-4">
                                    {/* Toggle Always-On */}
                                    <div className="flex items-center justify-between group cursor-pointer" onClick={() => onUpdate({ ...settings, alwaysOnVoice: !settings.alwaysOnVoice })}>
                                        <span className="text-[10px] font-mono tracking-widest uppercase group-hover:text-white transition-colors" style={{ color: settings.accentColor + '99' }}>
                                            Always-on mic (VAD)
                                        </span>
                                        <div className="w-8 h-4 rounded-full border relative transition-all" style={{ borderColor: settings.accentColor + '44', backgroundColor: settings.alwaysOnVoice ? settings.accentColor + '33' : 'transparent' }}>
                                            <motion.div 
                                                animate={{ x: settings.alwaysOnVoice ? 16 : 2 }}
                                                className="absolute top-1 w-2 h-2 rounded-full"
                                                style={{ backgroundColor: settings.alwaysOnVoice ? settings.accentColor : settings.accentColor + '33' }}
                                            />
                                        </div>
                                    </div>

                                    {/* Toggle Voice Lock */}
                                    <div className="flex items-center justify-between group cursor-pointer" onClick={() => onUpdate({ ...settings, voiceLock: !settings.voiceLock })}>
                                        <span className="text-[10px] font-mono tracking-widest uppercase group-hover:text-white transition-colors" style={{ color: settings.accentColor + '99' }}>
                                            Voice lock biometrics
                                        </span>
                                        <div className="w-8 h-4 rounded-full border relative transition-all" style={{ borderColor: settings.accentColor + '44', backgroundColor: settings.voiceLock ? settings.accentColor + '33' : 'transparent' }}>
                                            <motion.div 
                                                animate={{ x: settings.voiceLock ? 16 : 2 }}
                                                className="absolute top-1 w-2 h-2 rounded-full"
                                                style={{ backgroundColor: settings.voiceLock ? settings.accentColor : settings.accentColor + '33' }}
                                            />
                                        </div>
                                    </div>

                                    {/* Voice Print Status */}
                                    <div className="flex flex-col gap-2 p-3 rounded-lg border" style={{ backgroundColor: settings.accentColor + '08', borderColor: settings.accentColor + '22' }}>
                                        <div className="flex justify-between items-center text-[9px] font-mono">
                                            <span style={{ color: settings.accentColor + '66' }}>VOICE_MATRIX_PROFILE</span>
                                            <span className="font-bold text-[9px] text-right" style={{ color: settings.accentColor }}>
                                                {settings.voiceProfile?.isCalibrated 
                                                    ? `${settings.voiceProfile.pitchMin}-${settings.voiceProfile.pitchMax} Hz` 
                                                    : settings.voicePitch 
                                                        ? `${settings.voicePitch} Hz` 
                                                        : 'NOT_CALIBRATED'}
                                            </span>
                                        </div>
                                        
                                        <button
                                            type="button"
                                            onClick={onOpenVoiceWizard}
                                            className="w-full mt-1.5 py-2 border border-dashed text-[8px] font-mono transition-all hover:text-black cursor-pointer uppercase tracking-wider rounded"
                                            style={{ 
                                                borderColor: settings.accentColor + '66', 
                                                color: settings.accentColor,
                                                backgroundColor: 'transparent' 
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = settings.accentColor;
                                                e.currentTarget.style.color = '#000';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                e.currentTarget.style.color = settings.accentColor;
                                            }}
                                        >
                                            ⚙️ LAUNCH VOICE TRAINING WIZARD
                                        </button>
                                    </div>
                                </div>
                            </section>

                            {/* AI Core API Credentials */}
                            <section className="mt-4 pt-4 border-t border-orange-500/10">
                                <div className="flex items-center gap-2 text-[10px] mb-4 tracking-tighter font-mono" style={{ color: settings.accentColor + '66' }}>
                                    <KeyRound size={12} />
                                    <span>AI_CORE_API_CREDENTIALS</span>
                                </div>
                                <div className="flex flex-col gap-4">
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex justify-between items-center text-[8px] font-mono tracking-widest uppercase">
                                            <span style={{ color: settings.accentColor + '99' }}>Gemini API Slot</span>
                                            {apiStatus?.gemini?.exhausted ? (
                                                <span className="text-red-500 font-bold">⚠️ EXHAUSTED</span>
                                            ) : apiStatus?.gemini?.configured ? (
                                                <span className="text-green-500">ACTIVE</span>
                                            ) : (
                                                <span style={{ color: settings.accentColor + '44' }}>EMPTY</span>
                                            )}
                                        </div>
                                        <input
                                            type="password"
                                            value={localGeminiKey}
                                            onChange={(e) => setLocalGeminiKey(e.target.value)}
                                            placeholder={apiStatus?.gemini?.masked || "ENTER GEMINI API KEY..."}
                                            className="w-full bg-black/60 border text-[10px] font-mono px-3 py-2 outline-none"
                                            style={{ borderColor: settings.accentColor + '33', color: settings.accentColor }}
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex justify-between items-center text-[8px] font-mono tracking-widest uppercase">
                                            <span style={{ color: settings.accentColor + '99' }}>OpenAI API Slot</span>
                                            {apiStatus?.openai?.exhausted ? (
                                                <span className="text-red-500 font-bold">⚠️ EXHAUSTED</span>
                                            ) : apiStatus?.openai?.configured ? (
                                                <span className="text-green-500">ACTIVE</span>
                                            ) : (
                                                <span style={{ color: settings.accentColor + '44' }}>EMPTY</span>
                                            )}
                                        </div>
                                        <input
                                            type="password"
                                            value={localOpenaiKey}
                                            onChange={(e) => setLocalOpenaiKey(e.target.value)}
                                            placeholder={apiStatus?.openai?.masked || "ENTER OPENAI API KEY..."}
                                            className="w-full bg-black/60 border text-[10px] font-mono px-3 py-2 outline-none"
                                            style={{ borderColor: settings.accentColor + '33', color: settings.accentColor }}
                                        />
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleSaveApiKeys}
                                        disabled={isSavingKeys}
                                        className="w-full py-2 border text-[9px] font-mono font-bold tracking-widest transition-all uppercase rounded cursor-pointer mt-1"
                                        style={{ 
                                            borderColor: settings.accentColor + '66', 
                                            color: '#000',
                                            backgroundColor: settings.accentColor
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'transparent';
                                            e.currentTarget.style.color = settings.accentColor;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = settings.accentColor;
                                            e.currentTarget.style.color = '#000';
                                        }}
                                    >
                                        {isSavingKeys ? "💾 SYSTEM SYNCING..." : "💾 SAVE API CREDENTIALS"}
                                    </button>
                                </div>
                            </section>

                            {/* Additional Customization */}
                            <section className="mt-4 pt-4 border-t border-orange-500/10">
                                <button 
                                    onClick={() => onUpdate(DEFAULT_SETTINGS as any)}
                                    className="w-full p-3 border text-[10px] font-mono transition-all uppercase tracking-widest cursor-pointer"
                                    style={{ borderColor: settings.accentColor + '33', color: settings.accentColor }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = settings.accentColor;
                                        e.currentTarget.style.color = '#000';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                        e.currentTarget.style.color = settings.accentColor;
                                    }}
                                >
                                    Reset Neural Link
                                </button>
                            </section>
                        </div>

                        <div className="mt-12 text-[8px] font-mono text-center uppercase tracking-widest pb-6" style={{ color: settings.accentColor + '33' }}>
                            F.R.I.D.A.Y_CONFIG_STABLE_V6.2.3
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
