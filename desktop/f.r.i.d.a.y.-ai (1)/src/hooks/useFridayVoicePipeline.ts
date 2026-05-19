import { useState, useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════════
// F.R.I.D.A.Y. Voice Pipeline — React Hook
// Mirrors the proven overlay.js VAD + Whisper pipeline exactly.
// Always-on mic → VAD → Record → /transcribe → full result
// ═══════════════════════════════════════════════════════════

export interface TranscribeResult {
  text: string;
  confidence: number;
  intent?: { intent: string; type: string; [key: string]: any };
  result?: { message?: string; ok?: boolean; followUp?: any; type?: string; [key: string]: any };
}

export interface VoiceProfile {
  pitchMin: number;
  pitchMax: number;
  pitchAvg: number;
  centroidAvg: number;
  isCalibrated: boolean;
}

export function useFridayVoicePipeline(
  onResult: (result: TranscribeResult, wasManual: boolean) => void,
  pendingFollowUpRef?: React.MutableRefObject<any>,
  alwaysOnVoice: boolean = false,
  voiceLock: boolean = false,
  voicePitch: number = 145,
  voiceProfile?: VoiceProfile
) {
  const [data, setData] = useState({ amplitude: 0, frequencies: new Uint8Array(0) });
  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [isTraining, setIsTraining] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRawRef = useRef<AnalyserNode | null>(null);
  const analyzerFilteredRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef(false);
  const manualActivationRef = useRef(false);
  const onResultRef = useRef(onResult);
  const recordedPitches = useRef<number[]>([]);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // VAD state (from overlay.js)
  const vad = useRef({
    voiceDetectTime: 0, silenceTime: 0, hasSpoken: false,
    noiseFloor: 0.02, noiseAdaptFrames: 0, smoothedRMS: 0, prevSpectrumEnergy: 0,
  });

  // ── TUNING (overlay.js proven values) ──
  const VOICE_TRIGGER_MS = 350;
  const SILENCE_STOP_MS = 1200;
  const IDLE_TIMEOUT_MS = 8000;
  const NEARFIELD_RMS_MIN = 0.055;
  const NOISE_FLOOR_MULT_ON = 2.8;
  const NOISE_FLOOR_MULT_OFF = 1.8;
  const NOISE_ADAPT_FRAMES = 150;
  const NOISE_RISE_RATE = 0.003;
  const NOISE_FALL_RATE = 0.02;
  const RMS_SMOOTH_ALPHA = 0.3;
  const CENTROID_LO = 800;
  const CENTROID_HI = 3000;
  const VAD_SCORE_TRIGGER = 0.55;
  const VAD_SCORE_SUSTAIN = 0.30;
  const MIN_BLOB_SIZE = 5000;

  useEffect(() => { bootPipeline(); return () => shutdown(); }, []);

  // ═══════════════════════════════════════
  // BOOT — mic + filter chain + analysers
  // ═══════════════════════════════════════
  const bootPipeline = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 }
      });
      streamRef.current = stream;
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC({ sampleRate: 16000 });
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);

      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80; hp.Q.value = 0.7;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -30; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.1;

      const aRaw = ctx.createAnalyser(); aRaw.fftSize = 256; aRaw.smoothingTimeConstant = 0.7;
      analyzerRawRef.current = aRaw;
      const aFilt = ctx.createAnalyser(); aFilt.fftSize = 512; aFilt.smoothingTimeConstant = 0.75;
      analyzerFilteredRef.current = aFilt;

      source.connect(aRaw);
      source.connect(hp); hp.connect(bp); bp.connect(comp); comp.connect(aFilt);

      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => processAudio();

      console.log('[FRIDAY] Pipeline online');
      loop();
    } catch (err) { console.error('[FRIDAY] Mic failed:', err); }
  };

  const shutdown = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') audioContextRef.current.close();
  };

  // ═══════════════════════════════════════
  // PITCH METRIC — Autocorrelation Pitch Detector
  // ═══════════════════════════════════════
  const detectPitch = (buffer: Float32Array, sampleRate: number) => {
    const SIZE = buffer.length;
    let sum = 0;
    for (let i = 0; i < SIZE; i++) sum += buffer[i] * buffer[i];
    const rms = Math.sqrt(sum / SIZE);
    if (rms < 0.008) return -1; // too quiet

    let r1 = 0, r2 = SIZE - 1;
    const thres = 0.15;
    for (let i = 0; i < SIZE / 2; i++) {
      if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
    }
    for (let i = SIZE - 1; i >= SIZE / 2; i--) {
      if (Math.abs(buffer[i]) < thres) { r2 = i; break; }
    }
    const buf = buffer.subarray(r1, r2);
    const len = buf.length;
    if (len < 64) return -1;

    const c = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      for (let j = 0; j < len - i; j++) {
        c[i] = c[i] + buf[j] * buf[j + i];
      }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < len / 2; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }

    let T0 = maxpos;
    if (T0 > 0) {
      return sampleRate / T0;
    }
    return -1;
  };

  // ═══════════════════════════════════════
  // VAD METRICS (exact overlay.js logic)
  // ═══════════════════════════════════════
  const computeRMS = (d: Uint8Array) => { let s = 0; for (let i = 0; i < d.length; i++) { const v = d[i] / 255; s += v * v; } return Math.sqrt(s / d.length); };

  const detectVoice = () => {
    const af = analyzerFilteredRef.current, ac = audioContextRef.current;
    if (!af || !ac) return { isSpeech: false };
    const fd = new Uint8Array(af.frequencyBinCount);
    af.getByteFrequencyData(fd);
    const v = vad.current;
    const rawRMS = computeRMS(fd);
    v.smoothedRMS = v.smoothedRMS * (1 - RMS_SMOOTH_ALPHA) + rawRMS * RMS_SMOOTH_ALPHA;

    // Noise floor adaptation
    if (v.noiseAdaptFrames < NOISE_ADAPT_FRAMES) { 
      v.noiseFloor = v.noiseFloor * 0.92 + v.smoothedRMS * 0.08; 
      v.noiseAdaptFrames++; 
      if (v.noiseAdaptFrames === NOISE_ADAPT_FRAMES) {
        console.log(`[VAD] ✓ Calibration complete. Calibrated Room Noise Floor: ${v.noiseFloor.toFixed(4)}`);
      }
    }
    else if (!isRecordingRef.current) {
      if (v.smoothedRMS < v.noiseFloor) v.noiseFloor = v.noiseFloor * (1 - NOISE_FALL_RATE) + v.smoothedRMS * NOISE_FALL_RATE;
      else if (v.smoothedRMS < v.noiseFloor * 1.5) v.noiseFloor = v.noiseFloor * (1 - NOISE_RISE_RATE) + v.smoothedRMS * NOISE_RISE_RATE;
    }
    v.noiseFloor = Math.max(0.005, Math.min(v.noiseFloor, 0.15));

    // Energy score with hysteresis
    const thOn = Math.max(v.noiseFloor * NOISE_FLOOR_MULT_ON, NEARFIELD_RMS_MIN);
    const thOff = Math.max(v.noiseFloor * NOISE_FLOOR_MULT_OFF, NEARFIELD_RMS_MIN * 0.7);
    const th = v.hasSpoken ? thOff : thOn;
    const eScore = Math.min(Math.max((v.smoothedRMS - v.noiseFloor) / (th - v.noiseFloor), 0), 1);

    // Speech-band ratio
    const binHz = ac.sampleRate / af.fftSize;
    const lo = Math.floor(300 / binHz), hi = Math.min(Math.ceil(3400 / binHz), fd.length - 1);
    let sE = 0, tE = 0;
    for (let i = 0; i < fd.length; i++) { const e = fd[i] * fd[i]; tE += e; if (i >= lo && i <= hi) sE += e; }
    const bScore = Math.min(Math.max(((tE > 0 ? sE / tE : 0) - 0.3) / 0.4, 0), 1);

    // Centroid score
    let wSum = 0, tMag = 0;
    for (let i = 0; i < fd.length; i++) { wSum += fd[i] * (i * binHz); tMag += fd[i]; }
    const cent = tMag > 0 ? wSum / tMag : 0;
    let cScore = 0;
    if (cent >= CENTROID_LO && cent <= CENTROID_HI) { cScore = Math.max(0, 1 - Math.abs(cent - 1900) / 1100); }

    // Flux score
    let curE = 0; for (let i = 0; i < fd.length; i++) { const x = fd[i] / 255; curE += x * x; }
    const fScore = Math.min(Math.max(0, curE - v.prevSpectrumEnergy) / 0.15, 1);
    v.prevSpectrumEnergy = curE;

    const score = eScore * 0.40 + bScore * 0.25 + cScore * 0.20 + fScore * 0.15;
    return { isSpeech: score > (v.hasSpoken ? VAD_SCORE_SUSTAIN : VAD_SCORE_TRIGGER) };
  };

  // ═══════════════════════════════════════
  // AUDIO LOOP — always-on monitoring
  // ═══════════════════════════════════════
  const loop = () => {
    if (!analyzerRawRef.current) return;
    const dr = new Uint8Array(analyzerRawRef.current.frequencyBinCount);
    analyzerRawRef.current.getByteFrequencyData(dr);
    setData({ amplitude: Math.min(computeRMS(dr) * 2, 1), frequencies: new Uint8Array(dr) });

    const { isSpeech } = detectVoice();
    const v = vad.current;
    const isCalibrated = v.noiseAdaptFrames >= NOISE_ADAPT_FRAMES;

    // Pitch collection during active recording
    if (isRecordingRef.current && analyzerRawRef.current) {
      const timeData = new Float32Array(analyzerRawRef.current.fftSize);
      analyzerRawRef.current.getFloatTimeDomainData(timeData);
      const pitch = detectPitch(timeData, audioContextRef.current?.sampleRate || 16000);
      if (pitch > 60 && pitch < 400) {
        recordedPitches.current.push(pitch);
      }
    }

    if (!isRecordingRef.current) {
      if (alwaysOnVoice && isCalibrated && isSpeech) { 
        v.voiceDetectTime += 16; 
        if (v.voiceDetectTime >= VOICE_TRIGGER_MS) { 
          beginRecording(false); 
          v.voiceDetectTime = 0; 
        } 
      }
      else { v.voiceDetectTime = Math.max(0, v.voiceDetectTime - 8); }
    } else {
      if (isSpeech) { v.hasSpoken = true; v.silenceTime = 0; }
      else {
        v.silenceTime += 16;
        if (v.hasSpoken && v.silenceTime > SILENCE_STOP_MS) { console.log('[VAD] Speech ended'); endRecording(); }
        else if (!v.hasSpoken && v.silenceTime > IDLE_TIMEOUT_MS) { console.log('[VAD] No speech, cancel'); cancelRecording(); }
      }
    }
    animationRef.current = requestAnimationFrame(loop);
  };

  // ═══════════════════════════════════════
  // RECORDING CONTROLS
  // ═══════════════════════════════════════
  const beginRecording = (manual = false) => {
    if (isRecordingRef.current || !mediaRecorderRef.current) return;
    isRecordingRef.current = true;
    manualActivationRef.current = manual;
    recordedPitches.current = [];
    setVoiceState('listening');
    vad.current.hasSpoken = false; vad.current.silenceTime = 0;
    audioChunksRef.current = [];
    if (mediaRecorderRef.current.state === 'inactive') mediaRecorderRef.current.start();
  };

  const endRecording = () => {
    if (!isRecordingRef.current || !mediaRecorderRef.current) return;
    isRecordingRef.current = false;
    vad.current.hasSpoken = false; vad.current.silenceTime = 0;
    if (mediaRecorderRef.current.state === 'recording') mediaRecorderRef.current.stop();
  };

  const cancelRecording = () => {
    isRecordingRef.current = false; manualActivationRef.current = false;
    vad.current.hasSpoken = false; vad.current.silenceTime = 0; vad.current.voiceDetectTime = 0;
    setVoiceState('idle');
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      const orig = mediaRecorderRef.current.ondataavailable;
      mediaRecorderRef.current.ondataavailable = () => {};
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.ondataavailable = orig;
    }
    audioChunksRef.current = [];
  };

  // ═══════════════════════════════════════
  // BIOMETRIC VOICE PRINT CALIBRATION
  // ═══════════════════════════════════════
  const trainVoicePrint = async (onComplete: (pitch: number) => void) => {
    if (isTraining) return;
    console.log('[FRIDAY Biometrics] Starting voice print calibration...');
    setIsTraining(true);
    
    const pitches: number[] = [];
    const trainingEndTime = Date.now() + 3000;
    
    const trainLoop = () => {
      if (Date.now() >= trainingEndTime) {
        const validPitches = pitches.filter(p => p > 60 && p < 400);
        const avg = validPitches.length > 0 
          ? validPitches.reduce((a, b) => a + b, 0) / validPitches.length 
          : 145; // default fallback
        
        console.log(`[FRIDAY Biometrics] Calibration complete! Average pitch saved: ${avg.toFixed(1)} Hz`);
        setIsTraining(false);
        onComplete(Math.round(avg));
        return;
      }
      
      if (analyzerRawRef.current) {
        const timeData = new Float32Array(analyzerRawRef.current.fftSize);
        analyzerRawRef.current.getFloatTimeDomainData(timeData);
        const pitch = detectPitch(timeData, audioContextRef.current?.sampleRate || 16000);
        if (pitch > 60 && pitch < 400) {
          pitches.push(pitch);
        }
      }
      
      requestAnimationFrame(trainLoop);
    };
    
    trainLoop();
  };

  // ═══════════════════════════════════════
  // PROCESS — send to /transcribe, return FULL result
  // ═══════════════════════════════════════
  const processAudio = async () => {
    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    audioChunksRef.current = [];
    if (blob.size < MIN_BLOB_SIZE) { setVoiceState('idle'); manualActivationRef.current = false; return; }

    const wasManual = manualActivationRef.current || (pendingFollowUpRef && !!pendingFollowUpRef.current);
    
    // ── BIOMETRIC SPEECH VERIFICATION CHECK ──
    if (!wasManual && voiceLock) {
      const averagePitch = recordedPitches.current.length > 0 
        ? recordedPitches.current.reduce((a, b) => a + b, 0) / recordedPitches.current.length 
        : 0;
      
      let isVerified = false;
      let reason = "";

      if (voiceProfile && voiceProfile.isCalibrated) {
        // Multi-register profile verification!
        // We allow 20% tolerance beyond the calibrated minimum and maximum boundaries
        const minBound = voiceProfile.pitchMin * 0.8;
        const maxBound = voiceProfile.pitchMax * 1.2;
        
        if (averagePitch >= minBound && averagePitch <= maxBound) {
          isVerified = true;
        } else {
          reason = `Detected pitch ${averagePitch.toFixed(1)}Hz is outside calibrated range [${minBound.toFixed(0)}Hz - ${maxBound.toFixed(0)}Hz]`;
        }
      } else {
        // Single pitch fallback
        const pitchDiff = Math.abs(averagePitch - voicePitch);
        const allowedTolerance = voicePitch * 0.25; // 25% tolerance
        
        if (averagePitch > 0 && pitchDiff <= allowedTolerance) {
          isVerified = true;
        } else {
          reason = `Detected pitch ${averagePitch.toFixed(1)}Hz deviates > 25% from baseline ${voicePitch}Hz`;
        }
      }
      
      if (!isVerified) {
        console.warn(`[FRIDAY Biometrics] ❌ SPEAKER VERIFICATION FAILED. ${reason}. Discarding command.`);
        cancelRecording();
        return;
      }
      console.log(`[FRIDAY Biometrics] ✅ SPEAKER VERIFICATION SUCCESS. Voice pitch matched within safe biometric envelope (${averagePitch.toFixed(1)}Hz).`);
    }

    setVoiceState('processing');
    manualActivationRef.current = false;
    const fd = new FormData();
    fd.append('audio', blob, 'recording.webm');
    fd.append('manual', wasManual ? 'true' : 'false');
    if (pendingFollowUpRef && pendingFollowUpRef.current) {
      fd.append('followUpContext', JSON.stringify(pendingFollowUpRef.current));
    }

    try {
      const res = await fetch('https://f-r-i-d-a-y-8ixf.onrender.com/transcribe', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.text) {
        console.log(`[FRIDAY] "${data.text}" (conf=${data.confidence})`);
        onResultRef.current(data as TranscribeResult, wasManual);
      }
    } catch (err) { console.error('[FRIDAY] Transcribe failed:', err); }
    setVoiceState('idle');
  };

  return { 
    data, 
    voiceState, 
    startRecording: beginRecording, 
    stopRecording: endRecording,
    trainVoicePrint,
    isTraining
  };
}
