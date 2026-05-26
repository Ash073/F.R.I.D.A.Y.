import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Send, Terminal, Shield, Zap, Settings as SettingsIcon, Home, MessageSquare } from 'lucide-react';
import ReactorCore from './components/ReactorCore';
import HUDOverlay from './components/HUDOverlay';
import QuickAccessTray from './components/QuickAccessTray';
import SettingsDrawer from './components/SettingsDrawer';
import SystemMetricsDashboard from './components/SystemMetricsDashboard';
import { useFridayVoicePipeline, TranscribeResult, VoiceProfile, smartFetch, getBackendBaseUrl } from './hooks/useFridayVoicePipeline';
import VoiceProfileWizard from './components/VoiceProfileWizard';
import SpotifyWidget from './components/SpotifyWidget';
import { useSpotifyPlayer } from './hooks/useSpotifyPlayer';
import InteractiveChatPanel from './components/InteractiveChatPanel';

type AssistantState = 'idle' | 'listening' | 'processing' | 'speaking';

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

export const DEFAULT_SETTINGS: Settings = {
    accentColor: '#ff8c00',
    hudDensity: 0.8,
    animationSpeed: 1,
    showUplink: true,
    showCoreTemp: true,
    showClimate: true,
    showGeodata: true,
    showScanlines: true,
    showMetricsBtn: true,
    alwaysOnVoice: true, // Default to TRUE to keep the system active all the time!
    voiceLock: true,     // Default to TRUE to secure the system via voice print lock!
    voicePitch: 145,
    voiceProfile: undefined,
};

// Format milliseconds to mm:ss for the audio deck progress display
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function App() {
  const [state, setState] = useState<AssistantState>('idle');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant', text: string }[]>([]);
  const [systemLoad, setSystemLoad] = useState(12.4);
  const [status, setStatus] = useState('ONLINE');

  const { 
    state: spotifyState, 
    widgetMode: spotifyWidgetMode,
    showWidget: spotifyShowWidget,
    hideWidget: spotifyHideWidget,
    minimizeWidget: spotifyMinimizeWidget,
    expandWidget: spotifyExpandWidget,
    collapseWidget: spotifyCollapseWidget,
    togglePlay: spotifyTogglePlay, 
    nextTrack: spotifyNextTrack, 
    previousTrack: spotifyPreviousTrack,
    searchTracks: spotifySearch,
    playTrack: spotifyPlayTrack,
  } = useSpotifyPlayer();

  const [spotifyPulseData, setSpotifyPulseData] = useState<{ amplitude: number, frequencies: Uint8Array }>({
    amplitude: 0,
    frequencies: new Uint8Array(32)
  });
  const [spotifySearchQuery, setSpotifySearchQuery] = useState('');
  const [spotifySearchResults, setSpotifySearchResults] = useState<any[]>([]);
  const [spotifySearching, setSpotifySearching] = useState(false);
  const spotifyWidgetRef = useRef<HTMLDivElement>(null);
  
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const saved = localStorage.getItem('friday_settings');
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
    } catch {}
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    try {
      localStorage.setItem('friday_settings', JSON.stringify(settings));
    } catch {}
  }, [settings]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMetricsOpen, setIsMetricsOpen] = useState(false);
  const [isVoiceWizardOpen, setIsVoiceWizardOpen] = useState(false);
  const [isChatPanelOpen, setIsChatPanelOpen] = useState(false);

  // API configuration and exhaustion levels
  const [apiStatus, setApiStatus] = useState<any>(null);

  const fetchApiStatus = useCallback(async () => {
    try {
      const response = await smartFetch("/api/api-status");
      if (response.ok) {
        const data = await response.json();
        setApiStatus(data);
      }
    } catch (err) {
      console.warn("[FRIDAY APP] Failed to fetch API key configurations:", err);
    }
  }, []);

  const handleSaveApiKeys = useCallback(async (geminiKey: string, openaiKey: string) => {
    try {
      const response = await smartFetch("/api/save-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geminiApiKey: geminiKey || undefined,
          openaiApiKey: openaiKey || undefined
        })
      });
      if (response.ok) {
        await fetchApiStatus();
      } else {
        throw new Error(await response.text());
      }
    } catch (err) {
      console.error("[FRIDAY APP] Failed to save keys:", err);
      throw err;
    }
  }, [fetchApiStatus]);

  useEffect(() => {
    fetchApiStatus();
    const apiInterval = setInterval(fetchApiStatus, 15000);
    return () => clearInterval(apiInterval);
  }, [fetchApiStatus]);

  useEffect(() => {
    if (isSettingsOpen) {
      fetchApiStatus();
    }
  }, [isSettingsOpen, fetchApiStatus]);

  const [uplink, setUplink] = useState(1.2);
  const [coreTemp, setCoreTemp] = useState(34.2);
  const [metricsHistory, setMetricsHistory] = useState<{ time: string, load: number, temp: number, uplink: number }[]>([]);
  
  // Follow-up context states and refs
  const [pendingFollowUp, setPendingFollowUp] = useState<any>(null);
  const pendingFollowUpRef = useRef<any>(null);
  const startRecordingRef = useRef<any>(null);

  useEffect(() => {
    pendingFollowUpRef.current = pendingFollowUp;
  }, [pendingFollowUp]);

  // TTS with proper onend callback to return to idle or continue listening for follow-up
  const speakAndIdle = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const femaleVoice = voices.find(v => 
      /female|woman|zira|hazel|susan|kate|moira|samantha|jenny|aria|sonia|heera/i.test(v.name) && 
      v.lang.startsWith('en')
    );
    const fallbackVoice = voices.find(v => 
      v.lang.startsWith('en') && 
      !/\bmale\b|\bman\b|david|mark|george|james|ryan|guy|ravi/i.test(v.name)
    );
    const fridayVoice = femaleVoice || fallbackVoice || voices.find(v => v.lang.startsWith('en')) || voices[0];
    if (fridayVoice) utterance.voice = fridayVoice;
    utterance.pitch = 0.9;
    utterance.rate = 0.88;
    utterance.onstart = () => { setState('speaking'); setStatus('TRANSMITTING_RESPONSE'); };
    utterance.onend = () => {
      if (pendingFollowUpRef.current) {
        setState('listening');
        setStatus('LISTENING');
        if (startRecordingRef.current) {
          startRecordingRef.current(true); // manual = true, bypass wake word
        }
      } else {
        setState('idle');
        setStatus('STANDING_BY');
      }
    };
    synth.speak(utterance);
  }, []);
  
  const [fakeData, setFakeData] = useState<{ amplitude: number, frequencies: Uint8Array }>({ 
    amplitude: 0, 
    frequencies: new Uint8Array(32) 
  });
  


  // Simulate voice pulse when speaking
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (state === 'speaking') {
      interval = setInterval(() => {
        const amp = Math.random() * 0.4 + 0.6;
        const freqs = new Uint8Array(32);
        for (let i = 0; i < 32; i++) freqs[i] = Math.random() * 255 * (amp * Math.random());
        setFakeData({ amplitude: amp, frequencies: freqs });
      }, 80);
    } else {
      setFakeData({ amplitude: 0, frequencies: new Uint8Array(32) });
    }
    return () => { if (interval) clearInterval(interval); };
  }, [state]);

  // Poll REAL system metrics from backend
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await smartFetch('/api/system-metrics');
        const m = await res.json();
        setSystemLoad(m.cpuPercent ?? 0);
        setCoreTemp(m.cpuTemp ?? 0);
        setUplink(m.memUsedGB ?? 0);
        const now = new Date();
        const timeStr = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;
        setMetricsHistory(prev => [...prev, { time: timeStr, load: m.cpuPercent, temp: m.cpuTemp ?? 0, uplink: m.memUsedGB ?? 0 }].slice(-30));
      } catch {} // backend offline, ignore
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);



  const handleChatPanelSendMessage = useCallback(async (text: string, attachment?: any) => {
    setState('processing'); setStatus('PROCESSING_QUERY');
    try {
      const res = await smartFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          deviceId: (window as any).fridayDeviceId,
          attachment: attachment ? { base64: attachment.base64, mimeType: attachment.mimeType } : undefined
        })
      });
      const data = await res.json();
      const responseText = data.text || data.result?.message || (data.result?.ok ? "Mission objective complete." : "Execution failed.");
      
      if (responseText) {
        setMessages(prev => [
          ...prev, 
          { role: 'user', text },
          { role: 'assistant', text: responseText }
        ]);
        
        speakAndIdle(responseText);
        return responseText;
      }
      return null;
    } catch (err) {
      console.error(err);
      setStatus('ERROR');
      setState('idle');
      return null;
    } finally {
      fetchApiStatus();
    }
  }, [speakAndIdle, fetchApiStatus]);

  // ── VOICE RESULT HANDLER — uses /transcribe result directly (no double-send!) ──
  const onVoiceResult = useCallback((data: TranscribeResult, wasManual: boolean) => {
    const { text, confidence, intent, result } = data;
    if (confidence < 0.3 && !wasManual) return;
    
    // If backend ignored it due to missing wake word
    if (intent?.intent === 'IGNORED') return;

    // Use the result already computed by /transcribe
    setMessages(prev => [...prev, { role: 'user', text }]);
    const msg = result?.message || 'I didn\'t catch that. Try again.';
    setMessages(prev => [...prev, { role: 'assistant', text: msg }]);

    // Trigger Spotify OAuth if requested (voice pipeline support!)
    if (result?.openSpotify) {
      console.log("[FRIDAY React] Spotify authorization requested. Opening login link...");
      getBackendBaseUrl().then(baseUrl => {
        window.open(`${baseUrl}/spotify/login`, "_blank");
      });
    }

    // Show Spotify widget when a play command is detected
    if (intent?.intent === 'SPOTIFY' || intent?.intent?.startsWith?.('spotify') || 
        (result?.message && (result.message.toLowerCase().includes('playing') || result.message.toLowerCase().includes('spotify')))) {
      spotifyShowWidget();
    }

    // Update pending follow-up context
    if (result?.followUp) {
      setPendingFollowUp(result.followUp);
    } else {
      setPendingFollowUp(null);
    }

    if (intent?.type === 'query') {
      setIsChatPanelOpen(true);
    }

    fetchApiStatus();
    speakAndIdle(msg);
  }, [speakAndIdle, fetchApiStatus]);

  const { 
    data: voiceData, 
    voiceState, 
    startRecording, 
    stopRecording,
    trainVoicePrint,
    isTraining
  } = useFridayVoicePipeline(
    onVoiceResult, 
    pendingFollowUpRef,
    settings.alwaysOnVoice,
    settings.voiceLock,
    settings.voicePitch,
    settings.voiceProfile
  );

  // Sync the start recording ref for callbacks
  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  // Sync pipeline voice state → UI state
  useEffect(() => {
    if (voiceState === 'listening' && state === 'idle') { setState('listening'); setStatus('LISTENING'); }
    else if (voiceState === 'processing' && state !== 'processing') { setState('processing'); setStatus('PROCESSING'); }
    else if (voiceState === 'idle' && (state === 'listening' || state === 'processing') && state !== 'speaking') { setState('idle'); setStatus('STANDING_BY'); }
  }, [voiceState]);

  // ── TYPED TEXT INPUT — uses /api/chat with full intent + action execution ──
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setState('processing'); setStatus('PROCESSING_QUERY');
    try {
      let res;
      if (pendingFollowUpRef.current) {
        res = await smartFetch('/followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            followUpContext: pendingFollowUpRef.current,
            answer: text,
            deviceId: (window as any).fridayDeviceId
          })
        });
      } else {
        res = await smartFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            deviceId: (window as any).fridayDeviceId
          })
        });
      }
      
      const data = await res.json();
      const responseText = data.text || data.result?.message || (data.result?.ok ? "Mission objective complete." : "Execution failed.");
      
      if (responseText) {
        setMessages(prev => [...prev, { role: 'assistant', text: responseText }]);
        
        const resultObj = data.result || data;
        
        // Trigger Spotify OAuth if requested (typed command support!)
        if (resultObj.openSpotify) {
          console.log("[FRIDAY React] Spotify authorization requested. Opening login link...");
          getBackendBaseUrl().then(baseUrl => {
            window.open(`${baseUrl}/spotify/login`, "_blank");
          });
        }

        // Show Spotify widget when a Spotify command completes
        if (resultObj.openSpotify || 
            (responseText && (responseText.toLowerCase().includes('playing') || responseText.toLowerCase().includes('spotify')))) {
          spotifyShowWidget();
        }

        // Update pending follow-up context
        if (resultObj.followUp) {
          setPendingFollowUp(resultObj.followUp);
        } else {
          setPendingFollowUp(null);
        }

        if (data.intent?.type === 'query') {
          setIsChatPanelOpen(true);
        }

        speakAndIdle(responseText);
      } else { throw new Error('No response'); }
    } catch (err) { console.error(err); setStatus('ERROR'); setState('idle'); }
    finally {
      fetchApiStatus();
    }
  }, [speakAndIdle, fetchApiStatus]);

  const toggleListening = () => {
    if (state === 'idle') {
      startRecording(true);
    } else if (state === 'listening') {
      stopRecording();
    }
  };

  // Simulate active music pulse when Spotify is playing
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (spotifyState.isPlaying && state === 'idle') {
      interval = setInterval(() => {
        const amp = 0.3 + Math.random() * 0.4;
        const freqs = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
          freqs[i] = Math.round(Math.random() * 255 * (amp * Math.random()));
        }
        setSpotifyPulseData({ amplitude: amp, frequencies: freqs });
      }, 100);
    } else {
      setSpotifyPulseData({ amplitude: 0, frequencies: new Uint8Array(32) });
    }
    return () => { if (interval) clearInterval(interval); };
  }, [spotifyState.isPlaying, state]);

  const activeVoiceData = useMemo(() => {
    if (state === 'speaking') return fakeData;
    if (state === 'listening') return voiceData;
    if (spotifyState.isPlaying && state === 'idle') return spotifyPulseData;
    return { amplitude: 0, frequencies: new Uint8Array(32) };
  }, [state, voiceData, fakeData, spotifyState.isPlaying, spotifyPulseData]);

  return (
    <div className="relative w-screen h-screen flex flex-col items-center justify-center bg-[#0d0000]/40 backdrop-blur-xl text-orange-500 overflow-hidden select-none" style={{ '--accent': settings.accentColor } as any}>
      {/* Background Grid */}
      <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" 
           style={{ backgroundImage: `radial-gradient(circle, ${settings.accentColor} 1px, transparent 1px)`, backgroundSize: '40px 40px' }} />
      
      {/* Focus Backdrop Overlay */}
      <motion.div 
        className="absolute inset-0 z-[40] pointer-events-none"
        animate={{ 
          backgroundColor: state !== 'idle' ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0)',
        }}
        transition={{ duration: 1, ease: "easeInOut" }}
      />
      
      {/* Scanline Effect */}
      {settings.showScanlines && (
        <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden opacity-10">
          <div className="w-full h-[2px] bg-orange-500 animate-[scan_4s_linear_infinite]" style={{ backgroundColor: settings.accentColor }} />
        </div>
      )}

      <HUDOverlay 
        status={status} 
        systemLoad={systemLoad} 
        encryption={state === 'processing' ? 'DECRYPTING...' : 'AES-512-RSA'} 
        accentColor={settings.accentColor}
        coreTemp={coreTemp}
        uplink={uplink}
        showUplink={settings.showUplink}
        showCoreTemp={settings.showCoreTemp}
        showClimate={settings.showClimate}
        showGeodata={settings.showGeodata}
        onMetricsClick={() => setIsMetricsOpen(true)}
        showMetricsBtn={settings.showMetricsBtn}
        apiStatus={apiStatus}
      />

      <QuickAccessTray accentColor={settings.accentColor} />
      


      {/* HUD Panel Toggles on Right */}
      <div className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-4 pointer-events-auto">
        <button 
          onClick={() => setIsChatPanelOpen(true)}
          className="p-2 md:p-3 border transition-all duration-500 rounded-lg group bg-transparent border-white/5 hover:border-white/20 cursor-pointer"
          style={{ color: settings.accentColor + '99', borderColor: settings.accentColor + '1a' }}
          title="Open Intelligence Chat"
        >
          <MessageSquare size={16} className="group-hover:scale-110 transition-transform" />
        </button>

        <button 
          onClick={() => setIsSettingsOpen(true)}
          className="p-2 md:p-3 border transition-all duration-500 rounded-lg group bg-transparent border-white/5 hover:border-white/20 cursor-pointer"
          style={{ color: settings.accentColor + '99', borderColor: settings.accentColor + '1a' }}
          title="System Settings"
        >
          <SettingsIcon size={16} className="group-hover:rotate-90 transition-transform" />
        </button>
      </div>

      <SettingsDrawer 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        settings={settings}
        onUpdate={setSettings}
        onOpenVoiceWizard={() => {
          setIsSettingsOpen(false);
          setIsVoiceWizardOpen(true);
        }}
        apiStatus={apiStatus}
        onSaveKeys={handleSaveApiKeys}
      />

      <VoiceProfileWizard 
        isOpen={isVoiceWizardOpen}
        onClose={() => setIsVoiceWizardOpen(false)}
        accentColor={settings.accentColor}
        onSaveProfile={(profile) => {
          setSettings(prev => ({
            ...prev,
            voiceProfile: profile,
            voiceLock: true // Automatically lock once trained!
          }));
        }}
      />

      <SystemMetricsDashboard 
        isOpen={isMetricsOpen}
        onClose={() => setIsMetricsOpen(false)}
        data={metricsHistory}
        accentColor={settings.accentColor}
      />

      {/* Focused Transcription Layer */}
      <AnimatePresence>
        {state !== 'idle' && (
          <div className="absolute inset-x-0 top-1/4 z-[45] flex flex-col items-center pointer-events-none p-4 md:p-12 overflow-hidden">
            <div className="w-full max-w-4xl flex flex-col gap-6 md:gap-8 items-center">
              {/* User Speech (The "Perspective" Background Speech) */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="text-center font-mono italic text-white/30 text-sm md:text-2xl tracking-[0.2em] md:tracking-[0.3em] uppercase max-w-3xl leading-relaxed"
                style={{ filter: 'blur(1px)' }}
              >
                {messages.filter(m => m.role === 'user').pop()?.text}
              </motion.div>

              {/* F.R.I.D.A.Y. Response */}
              {state === 'speaking' && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="bg-black/40 border border-white/10 backdrop-blur-sm p-4 md:p-8 rounded-2xl shadow-2xl max-w-[90vw] md:max-w-2xl text-center"
                >
                  <div className="flex items-center justify-center gap-2 mb-2 md:mb-4 text-[7px] md:text-[8px] text-white/40 uppercase tracking-[0.3em] md:tracking-[0.5em]">
                    <span className="w-3 md:w-4 h-px bg-white/20" />
                    Neural_Response_Stream
                    <span className="w-3 md:w-4 h-px bg-white/20" />
                  </div>
                  <p className="text-xs md:text-lg font-mono text-white leading-relaxed tracking-wide" style={{ textShadow: `0 0 15px ${settings.accentColor}cc` }}>
                    {messages.filter(m => m.role === 'assistant').pop()?.text}
                  </p>
                </motion.div>
              )}
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Reactor Viewport */}
      <div className="relative w-full aspect-square max-w-[300px] md:max-w-[450px] lg:max-w-[600px] flex items-center justify-center transition-all duration-500">
        <ReactorCore 
            state={state} 
            amplitude={activeVoiceData.amplitude} 
            frequencies={activeVoiceData.frequencies}
            accentColor={settings.accentColor}
        />
        
        {/* Central Identity Text */}
        <div className="z-10 text-center flex flex-col items-center pointer-events-none px-4">
          <motion.h1 
            className="text-3xl md:text-5xl lg:text-6xl font-anurati font-black tracking-[0.2em] text-white glow-orange"
            style={{ 
                textShadow: `0 0 10px ${settings.accentColor}, 0 0 20px ${settings.accentColor}44`,
                scale: state === 'speaking' ? 1 + activeVoiceData.amplitude * 0.1 : 1 
            }}
          >
            F.R.I.D.A.Y.
          </motion.h1>
          <p className="text-[6px] md:text-[7px] tracking-[0.4em] opacity-60 mt-2 md:mt-4 text-orange-200 uppercase font-mono max-w-[180px] md:max-w-[250px]" style={{ color: settings.accentColor + 'cc' }}>
            FULLY RESPONSIVE INTELLIGENCE DEFENSE ARRAY YOUNGSTER
          </p>
        </div>
      </div>

      {/* Interactive Controls */}
      <div className="absolute bottom-8 md:bottom-16 w-full max-w-xl px-4 md:px-8 z-[60] flex flex-col gap-4 md:gap-6">
        <div className="flex items-center gap-2 md:gap-4 bg-orange-950/20 border border-orange-500/20 p-1 md:p-2 rounded-full backdrop-blur-sm shadow-inner group transition-all focus-within:border-orange-500/50" style={{ borderColor: settings.accentColor + '33' }}>
          <button 
            onClick={toggleListening}
            className={`p-2 md:p-3 rounded-full transition-all ${state === 'listening' ? 'bg-white text-black' : 'bg-transparent text-white hover:bg-white/10'}`}
            style={state === 'listening' ? { backgroundColor: settings.accentColor, color: '#000' } : { color: settings.accentColor }}
          >
            {state === 'listening' ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
          
          <input 
            type="text" 
            placeholder={state === 'listening' ? "Listening..." : "Enter mission parameters..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend(input)}
            className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-orange-950 placeholder:uppercase tracking-widest uppercase font-mono"
            style={{ color: settings.accentColor }}
          />
          
          <button 
            onClick={() => handleSend(input)}
            disabled={!input.trim()}
            className="p-3 bg-orange-500 text-black rounded-full hover:bg-orange-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            style={{ backgroundColor: settings.accentColor }}
          >
            <Send size={20} />
          </button>
        </div>

        <div className="flex justify-center px-4">
            {/* Feature Icons */}
            <div className="flex gap-8 text-orange-500/30">
                <div className="flex flex-col items-center gap-2 group cursor-help transition-all hover:text-white" style={{ '--hover': settings.accentColor } as any}>
                    <Shield size={14} className="group-hover:text-[var(--hover)]" />
                    <span className="text-[7px] tracking-tighter opacity-0 group-hover:opacity-100 uppercase">Defense_Protocol</span>
                </div>
                <div className="flex flex-col items-center gap-2 group cursor-help transition-all hover:text-white" style={{ '--hover': settings.accentColor } as any}>
                    <Zap size={14} className="group-hover:text-[var(--hover)]" />
                    <span className="text-[7px] tracking-tighter opacity-0 group-hover:opacity-100 uppercase">Energy_Optimal</span>
                </div>
            </div>
        </div>
      </div>

      <InteractiveChatPanel
        isOpen={isChatPanelOpen}
        onClose={() => setIsChatPanelOpen(false)}
        accentColor={settings.accentColor}
        voiceState={voiceState === 'listening' ? 'listening' : voiceState === 'processing' ? 'processing' : 'idle'}
        startRecording={startRecording}
        stopRecording={stopRecording}
        onSendMessage={handleChatPanelSendMessage}
        initialMessages={messages}
        apiStatus={apiStatus}
      />

      {/* ═══ CINEMATIC FRIDAY AUDIO DECK WIDGET ═══ */}
      <SpotifyWidget
        spotifyState={spotifyState}
        widgetMode={spotifyWidgetMode}
        accentColor={settings.accentColor}
        onMinimize={spotifyMinimizeWidget}
        onExpand={spotifyExpandWidget}
        onCollapse={spotifyCollapseWidget}
        onHide={spotifyHideWidget}
        onShow={() => spotifyShowWidget()}
        onTogglePlay={spotifyTogglePlay}
        onNext={spotifyNextTrack}
        onPrev={spotifyPreviousTrack}
        onPlayTrack={spotifyPlayTrack}
        onSearch={spotifySearch}
      />

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes scan {
          from { transform: translateY(-100%); }
          to { transform: translateY(100vh); }
        }
      `}} />
    </div>
  );
}
