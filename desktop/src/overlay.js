// ═══════════════════════════════════════════════════════════
// F.R.I.D.A.Y. — ADVANCED VOICE ISOLATION PIPELINE
// Multi-stage: Mic → Filters → VAD → Near-field → Whisper
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  const orbIframe = document.getElementById('orbIframe');
  const statusEl  = document.getElementById('status');
  const cmdInput  = document.getElementById('cmdInput');
  const orbZone   = document.getElementById('big-orb-container');
  const voiceBtn  = document.getElementById('voiceBtn');

  let state = 'idle';
  let targetAmp = 0;
  const BAR_COUNT = 64;
  const barT = new Float32Array(BAR_COUNT);

  let pendingFollowUp = null;
  let followUpTimer = null;

  // ── Audio graph nodes ──
  let audioCtx, micStream, mediaRecorder;
  let analyserRaw;       // Pre-filter analyser (for raw amplitude)
  let analyserFiltered;  // Post-filter analyser (for speech detection)
  let dataRaw, dataFiltered;
  let audioChunks = [];
  let isRecording = false;
  let manualActivation = false;

  // ── VAD state ──
  let voiceDetectTime = 0;
  let silenceTime = 0;
  let hasSpoken = false;
  let noiseFloor = 0.02;
  let noiseAdaptFrames = 0;
  let smoothedRMS = 0;           // EMA-smoothed RMS (reduces jitter)
  let prevSpectrumEnergy = 0;    // Previous frame energy for flux calc
  let vadScore = 0;              // Composite VAD score (0–1)

  // ═══════════════════════════════════════════════════════════
  // TUNING CONSTANTS
  // ═══════════════════════════════════════════════════════════
  const VOICE_TRIGGER_MS    = 350;
  const SILENCE_STOP_MS     = 1200;
  const IDLE_TIMEOUT_MS     = 8000;
  const FOLLOWUP_TIMEOUT_MS = 3000;
  const MIN_BLOB_SIZE       = 5000;
  const MIN_CONFIDENCE      = 0.35;

  // VAD tuning
  const NEARFIELD_RMS_MIN   = 0.055;  // Absolute minimum RMS for near speaker
  const NOISE_FLOOR_MULT_ON = 2.8;    // Threshold to START detecting (stricter)
  const NOISE_FLOOR_MULT_OFF= 1.8;    // Threshold to STOP detecting (hysteresis)
  const SPEECH_BAND_RATIO   = 0.45;   // Min speech-band energy ratio
  const NOISE_ADAPT_FRAMES  = 150;    // ~2.5s initial calibration
  const NOISE_RISE_RATE     = 0.003;  // Noise floor rises slowly
  const NOISE_FALL_RATE     = 0.02;   // Noise floor drops faster (room gets quieter)
  const RMS_SMOOTH_ALPHA    = 0.3;    // EMA smoothing for RMS (0=smooth, 1=raw)
  const CENTROID_LO         = 800;    // Expected speech centroid lower bound (Hz)
  const CENTROID_HI         = 3000;   // Expected speech centroid upper bound (Hz)
  const VAD_SCORE_TRIGGER   = 0.55;   // Composite score to trigger (idle→listening)
  const VAD_SCORE_SUSTAIN   = 0.30;   // Composite score to sustain (during listening)

  // Wake word patterns
  const WAKE_PATTERNS = [
    /(?:hey|hello|hi|ok|okay)\s*(?:friday|f\.?r\.?i\.?d\.?a\.?y)/i,
    /^(?:friday|f\.?r\.?i\.?d\.?a\.?y)\b/i,
  ];
  function containsWakeWord(t) { return WAKE_PATTERNS.some(p => p.test(t.trim())); }


  // ═══════════════════════════════════════════════════════════
  // STAGE 1 — MIC INPUT + AUDIO FILTER CHAIN
  // getUserMedia → HighPass → BandPass → Compressor → Analyser
  // ═══════════════════════════════════════════════════════════

  async function bootFriday() {
    console.log('[FRIDAY] ⚡ Booting voice isolation pipeline...');
    setStatus('Initializing...');

    try {
      audioCtx = new AudioContext({ sampleRate: 16000 });

      // ── Mic with browser-level noise suppression ──
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        }
      });

      const source = audioCtx.createMediaStreamSource(micStream);

      // ── Stage 2a: High-pass filter — kill rumble < 80Hz ──
      const highPass = audioCtx.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.frequency.value = 80;
      highPass.Q.value = 0.7;

      // ── Stage 2b: Bandpass filter — focus on speech 300-3400Hz ──
      const bandPass = audioCtx.createBiquadFilter();
      bandPass.type = 'bandpass';
      bandPass.frequency.value = 1200;  // Center of 300-3400Hz
      bandPass.Q.value = 0.5;           // Wide Q for full speech range

      // ── Stage 2c: Compressor — normalize levels ──
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -30;
      compressor.knee.value = 10;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.1;

      // ── Raw analyser (before filters, for visualization) ──
      analyserRaw = audioCtx.createAnalyser();
      analyserRaw.fftSize = 256;
      analyserRaw.smoothingTimeConstant = 0.7;
      dataRaw = new Uint8Array(analyserRaw.frequencyBinCount);

      // ── Filtered analyser (after filters, for VAD) ──
      analyserFiltered = audioCtx.createAnalyser();
      analyserFiltered.fftSize = 512;
      analyserFiltered.smoothingTimeConstant = 0.75;
      dataFiltered = new Uint8Array(analyserFiltered.frequencyBinCount);

      // ── Wire the graph ──
      // source → raw analyser (visualization)
      source.connect(analyserRaw);
      // source → highpass → bandpass → compressor → filtered analyser (VAD)
      source.connect(highPass);
      highPass.connect(bandPass);
      bandPass.connect(compressor);
      compressor.connect(analyserFiltered);

      // ── MediaRecorder uses the ORIGINAL mic stream ──
      // (Whisper handles its own noise, we just send cleaner segments)
      mediaRecorder = new MediaRecorder(micStream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.onstop = processAudio;

      console.log('[FRIDAY] ✓ Audio filter chain: HighPass(80Hz) → BandPass(300-3400Hz) → Compressor');
      console.log('[FRIDAY] ✓ VAD: Adaptive noise floor + speech-band ratio + near-field RMS');
      console.log('[FRIDAY] ✓ Pipeline online');
    } catch (e) {
      console.error('[FRIDAY] ✗ Mic failed:', e);
      setStatus('Mic access denied');
      return;
    }

    audioLoop();
    setStatus('FRIDAY online');
    targetAmp = 0.8;
    setTimeout(() => { targetAmp = 0; }, 800);
    setTimeout(() => setStatus('Standing by...'), 2500);
  }

  setTimeout(bootFriday, 300);


  // ═══════════════════════════════════════════════════════════
  // STAGE 3 — ENHANCED VOICE ACTIVITY DETECTION
  // Metrics: Smoothed RMS + Speech-band ratio + Spectral
  //          centroid + Spectral flux + Adaptive noise floor
  // ═══════════════════════════════════════════════════════════

  /** RMS energy from frequency data (0.0 – 1.0) */
  function computeRMS(freqData) {
    let sumSq = 0;
    for (let i = 0; i < freqData.length; i++) {
      const v = freqData[i] / 255;
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / freqData.length);
  }

  /** Speech-band energy ratio (300-3400Hz energy / total energy) */
  function speechBandRatio(freqData, sampleRate, fftSize) {
    const binHz = sampleRate / fftSize;
    const loIdx = Math.floor(300 / binHz);
    const hiIdx = Math.min(Math.ceil(3400 / binHz), freqData.length - 1);

    let speechEnergy = 0, totalEnergy = 0;
    for (let i = 0; i < freqData.length; i++) {
      const e = freqData[i] * freqData[i];
      totalEnergy += e;
      if (i >= loIdx && i <= hiIdx) speechEnergy += e;
    }
    return totalEnergy > 0 ? speechEnergy / totalEnergy : 0;
  }

  /**
   * Spectral centroid — the "center of mass" of the spectrum.
   * Human speech typically has centroid in 800–3000 Hz.
   * Music/noise tends to be more spread out or much lower/higher.
   */
  function spectralCentroid(freqData, sampleRate, fftSize) {
    const binHz = sampleRate / fftSize;
    let weightedSum = 0, totalMag = 0;
    for (let i = 0; i < freqData.length; i++) {
      const mag = freqData[i];
      weightedSum += mag * (i * binHz);
      totalMag += mag;
    }
    return totalMag > 0 ? weightedSum / totalMag : 0;
  }

  /**
   * Spectral flux — measures how much the spectrum changed since last frame.
   * Speech has moderate, rhythmic flux. Steady noise has very low flux.
   * Returns 0.0–1.0 normalized value.
   */
  function spectralFlux(freqData) {
    let flux = 0;
    let currentEnergy = 0;
    for (let i = 0; i < freqData.length; i++) {
      const v = freqData[i] / 255;
      currentEnergy += v * v;
    }
    // Half-wave rectified difference (only positive changes count)
    const diff = currentEnergy - prevSpectrumEnergy;
    flux = Math.max(0, diff);
    prevSpectrumEnergy = currentEnergy;
    // Normalize: typical speech flux is 0.01–0.15
    return Math.min(flux / 0.15, 1.0);
  }

  /**
   * Adaptive noise floor with asymmetric rates.
   * Rises slowly (environment gets louder) but falls faster (gets quieter).
   */
  function updateNoiseFloor(rms) {
    if (noiseAdaptFrames < NOISE_ADAPT_FRAMES) {
      // Initial calibration: fast convergence
      noiseFloor = noiseFloor * 0.92 + rms * 0.08;
      noiseAdaptFrames++;
    } else if (state === 'idle') {
      // Continuous adaptation only when idle
      if (rms < noiseFloor) {
        // Room got quieter → adapt faster
        noiseFloor = noiseFloor * (1 - NOISE_FALL_RATE) + rms * NOISE_FALL_RATE;
      } else if (rms < noiseFloor * 1.5) {
        // Slight increase in ambient → adapt slowly (don't adapt to speech!)
        noiseFloor = noiseFloor * (1 - NOISE_RISE_RATE) + rms * NOISE_RISE_RATE;
      }
      // If rms > noiseFloor * 1.5, it's likely speech — don't adapt
    }
    // Clamp to sane range
    noiseFloor = Math.max(0.005, Math.min(noiseFloor, 0.15));
  }

  /**
   * Full VAD decision with composite scoring.
   * Returns { isSpeech, score, rms, ratio, centroid, flux, threshold }
   */
  function detectVoice() {
    analyserFiltered.getByteFrequencyData(dataFiltered);

    const rawRMS = computeRMS(dataFiltered);

    // EMA smoothing — reduces single-frame spikes from noise
    smoothedRMS = smoothedRMS * (1 - RMS_SMOOTH_ALPHA) + rawRMS * RMS_SMOOTH_ALPHA;

    const ratio = speechBandRatio(dataFiltered, audioCtx.sampleRate, analyserFiltered.fftSize);
    const centroid = spectralCentroid(dataFiltered, audioCtx.sampleRate, analyserFiltered.fftSize);
    const flux = spectralFlux(dataFiltered);

    updateNoiseFloor(smoothedRMS);

    // ── Compute individual metric scores (0–1) ──

    // 1. Energy score: how far above noise floor
    const thresholdOn = Math.max(noiseFloor * NOISE_FLOOR_MULT_ON, NEARFIELD_RMS_MIN);
    const thresholdOff = Math.max(noiseFloor * NOISE_FLOOR_MULT_OFF, NEARFIELD_RMS_MIN * 0.7);
    const threshold = hasSpoken ? thresholdOff : thresholdOn; // Hysteresis
    const energyScore = Math.min(Math.max((smoothedRMS - noiseFloor) / (threshold - noiseFloor), 0), 1);

    // 2. Speech-band score: is energy concentrated in speech frequencies?
    const bandScore = Math.min(Math.max((ratio - 0.3) / 0.4, 0), 1);

    // 3. Centroid score: is the spectral center in speech range?
    let centroidScore = 0;
    if (centroid >= CENTROID_LO && centroid <= CENTROID_HI) {
      // Peak score at ~1800Hz (center of speech range)
      const center = (CENTROID_LO + CENTROID_HI) / 2;
      const dist = Math.abs(centroid - center) / (CENTROID_HI - CENTROID_LO) * 2;
      centroidScore = Math.max(0, 1 - dist * 0.5);
    }

    // 4. Flux score: speech has moderate flux, steady noise has low
    const fluxScore = Math.min(flux / 0.5, 1);

    // ── Weighted composite score ──
    // Energy is king, but other metrics provide discrimination
    vadScore =
      energyScore   * 0.40 +
      bandScore     * 0.25 +
      centroidScore * 0.20 +
      fluxScore     * 0.15;

    const isSpeech = vadScore > (hasSpoken ? VAD_SCORE_SUSTAIN : VAD_SCORE_TRIGGER);

    return { isSpeech, score: vadScore, rms: smoothedRMS, ratio, centroid, flux, threshold };
  }


  // ═══════════════════════════════════════════════════════════
  // AUDIO LOOP — Always-on monitoring + VAD + visualization
  // ═══════════════════════════════════════════════════════════

  function audioLoop() {
    requestAnimationFrame(audioLoop);
    if (!analyserRaw || !analyserFiltered) return;

    // Raw data for visualization
    analyserRaw.getByteFrequencyData(dataRaw);
    const rawAmp = computeRMS(dataRaw);

    // Bar visualization
    const bs = Math.max(1, Math.floor(dataRaw.length / BAR_COUNT));
    for (let b = 0; b < BAR_COUNT; b++) {
      let s = 0;
      for (let j = 0; j < bs; j++) {
        const idx = b * bs + j;
        if (idx < dataRaw.length) s += dataRaw[idx];
      }
      barT[b] = s / bs / 255;
    }

    // ── IDLE: Voice activity detection ──
    if (state === 'idle') {
      targetAmp = rawAmp * 0.3;
      const vad = detectVoice();

      if (vad.isSpeech) {
        voiceDetectTime += 16;
        if (voiceDetectTime >= VOICE_TRIGGER_MS) {
          console.log(`[VAD] ✓ Speech detected (score=${vad.score.toFixed(2)}, RMS=${vad.rms.toFixed(3)}, centroid=${vad.centroid.toFixed(0)}Hz, floor=${noiseFloor.toFixed(3)})`);
          startRecording();
          voiceDetectTime = 0;
        }
      } else {
        voiceDetectTime = Math.max(0, voiceDetectTime - 8); // Slow decay
      }
    }

    // ── LISTENING: Silence detection ──
    if (state === 'listening' && isRecording) {
      targetAmp = rawAmp * 1.5;
      const vad = detectVoice();

      if (vad.isSpeech) {
        hasSpoken = true;
        silenceTime = 0;
      } else {
        silenceTime += 16;
        if (hasSpoken && silenceTime > SILENCE_STOP_MS) {
          console.log('[VAD] ⏹ Speech ended');
          stopRecording();
        } else if (!hasSpoken && silenceTime > IDLE_TIMEOUT_MS) {
          console.log('[VAD] ⏹ No speech — cancelling');
          cancelRecording();
        }
      }
    }

    // Push to orb
    try {
      if (orbIframe && orbIframe.contentWindow) {
        orbIframe.contentWindow.postMessage({ type: 'setAudioLevel', value: targetAmp }, '*');
      }
    } catch (e) { }
  }


  // ═══════════════════════════════════════════════════════════
  // RECORDING CONTROLS
  // ═══════════════════════════════════════════════════════════

  function startRecording() {
    if (isRecording || !mediaRecorder) return;
    setState('listening');
    setStatus('Listening...');
    isRecording = true;
    hasSpoken = false;
    silenceTime = 0;
    audioChunks = [];
    if (mediaRecorder.state === 'inactive') mediaRecorder.start();
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    hasSpoken = false;
    silenceTime = 0;
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  }

  function cancelRecording() {
    isRecording = false;
    hasSpoken = false;
    silenceTime = 0;
    voiceDetectTime = 0;
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.ondataavailable = () => {};
      mediaRecorder.stop();
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
      audioChunks = [];
    }
    goIdle();
  }


  // ═══════════════════════════════════════════════════════════
  // STAGE 5 — WHISPER + CONFIDENCE CHECK
  // ═══════════════════════════════════════════════════════════

  async function processAudio() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    audioChunks = [];

    if (audioBlob.size < MIN_BLOB_SIZE) {
      console.log('[FRIDAY] Audio too short, ignoring');
      goIdle();
      return;
    }

    setState('thinking');
    targetAmp = 0.5;
    setStatus('Processing...');

    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    try {
      const res = await fetch("https://f-r-i-d-a-y-8ixf.onrender.com/transcribe", {
        method: "POST",
        body: formData
      });
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      const transcribed = (data.text || "").trim();
      const confidence = data.confidence ?? 1.0;

      // ── CONFIDENCE GATE — reject unclear/low-quality transcriptions ──
      if (confidence < MIN_CONFIDENCE && !manualActivation) {
        console.log(`[FRIDAY] Rejected (low confidence ${confidence.toFixed(2)}): "${transcribed}"`);
        goIdle();
        return;
      }

      // ── FOLLOW-UP: No wake word needed ──
      if (pendingFollowUp && transcribed) {
        cmdInput.value = transcribed;
        clearFollowUpTimer();
        handleFollowUpAnswer(transcribed);
        return;
      }

      // ── WAKE WORD GATE ──
      if (!manualActivation && !containsWakeWord(transcribed)) {
        console.log(`[FRIDAY] Ignored (no wake word): "${transcribed}"`);
        goIdle();
        return;
      }

      manualActivation = false;
      if (transcribed) cmdInput.value = transcribed;

      if (data.result) {
        handleResult(data.result, data.intent);
      } else {
        speak("I didn't catch that. Try again.");
        goIdle();
      }
    } catch (err) {
      console.error("Pipeline error:", err);
      speak('Processing failed.');
      goIdle();
    }
  }


  // ═══════════════════════════════════════════════════════════
  // RESULT HANDLING + FOLLOW-UPS
  // ═══════════════════════════════════════════════════════════

  function handleResult(result, intent) {
    const msg = result.message || JSON.stringify(result);
    const type = result.type || intent?.type || 'command';

    if (result.followUp) {
      pendingFollowUp = result.followUp;
      startFollowUpTimer();
      setStatus('Awaiting response...');
      speakThenListen(msg);
      return;
    }

    pendingFollowUp = null;
    clearFollowUpTimer();

    // Clear input now that we have a final result
    cmdInput.value = '';

    if (type === 'command') {
      setStatus('Executing...');
      setState('executing');
      setTimeout(() => speak(msg), 200);
    } else {
      setStatus('AI responding...');
      setTimeout(() => speak(msg), 200);
    }
  }

  async function handleFollowUpAnswer(answerText) {
    const context = pendingFollowUp;
    pendingFollowUp = null;
    clearFollowUpTimer();
    setState('thinking');
    setStatus('Processing...');

    try {
      const res = await fetch("https://f-r-i-d-a-y-8ixf.onrender.com/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followUpContext: context, answer: answerText })
      });
      const data = await res.json();
      if (data.result) {
        cmdInput.value = ''; // Clear answer from input
        setStatus('Executing...');
        setState('executing');
        setTimeout(() => speak(data.result.message || JSON.stringify(data.result)), 200);
      } else { speak("Something went wrong."); goIdle(); }
    } catch (err) { speak("Failed to process."); goIdle(); }
  }

  function startFollowUpTimer() {
    clearFollowUpTimer();
    followUpTimer = setTimeout(() => {
      if (pendingFollowUp) {
        speak("No response. Opening normally.");
        setTimeout(() => handleFollowUpAnswer("skip"), 2000);
      }
    }, FOLLOWUP_TIMEOUT_MS);
  }

  function clearFollowUpTimer() { if (followUpTimer) { clearTimeout(followUpTimer); followUpTimer = null; } }

  function goIdle() {
    pendingFollowUp = null;
    clearFollowUpTimer();
    setState('idle');
    targetAmp = 0;
    clearBars();
    voiceDetectTime = 0;
    silenceTime = 0;
    smoothedRMS = 0;
    vadScore = 0;
    cmdInput.value = '';
    setStatus('Standing by...');
  }

  async function sendTextCommand(text) {
    try {
      if (pendingFollowUp) { clearFollowUpTimer(); handleFollowUpAnswer(text); return; }
      const res = await fetch("https://f-r-i-d-a-y-8ixf.onrender.com/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      const d = await res.json();
      if (d && d.result) handleResult(d.result, d.intent);
    } catch { speak('Backend is offline.'); }
  }


  // ═══════════════════════════════════════════════════════════
  // TTS — VOICE ENGINE
  // ═══════════════════════════════════════════════════════════

  const PREFERRED_VOICE = {
    exactName: "",
    preferredLangs: ["en-IE", "en-GB", "en-AU", "en-US"],
    preferFemale: true,
    pitch: 0.90,
    rate: 0.88,
  };

  let cachedVoices = [];
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoices = window.speechSynthesis.getVoices();
    console.log('═══ AVAILABLE VOICES ═══');
    cachedVoices.forEach((v, i) => console.log(`  [${i}] ${v.name} — ${v.lang} ${v.localService ? '(local)' : '(remote)'}`));
    console.log('════════════════════════');
  };

  function pickVoice() {
    const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    if (PREFERRED_VOICE.exactName) {
      const exact = voices.find(v => v.name.toLowerCase().includes(PREFERRED_VOICE.exactName.toLowerCase()));
      if (exact) return exact;
    }
    let best = null, bestScore = -1;
    for (const v of voices) {
      let score = 0;
      const name = v.name.toLowerCase(), lang = v.lang.toLowerCase();
      for (let i = 0; i < PREFERRED_VOICE.preferredLangs.length; i++) {
        if (lang.startsWith(PREFERRED_VOICE.preferredLangs[i].toLowerCase())) { score += (PREFERRED_VOICE.preferredLangs.length - i) * 10; break; }
      }
      if (!lang.startsWith("en")) continue;
      if (PREFERRED_VOICE.preferFemale) {
        if (/female|woman|zira|hazel|susan|kate|moira|samantha|jenny|aria|sonia/i.test(name)) score += 25;
        if (/\bmale\b|\bman\b|david|mark|george|james|ryan|guy\b/i.test(name)) score -= 20;
      }
      if (/natural|neural|online/i.test(name)) score += 5;
      if (v.localService) score += 3;
      if (score > bestScore) { bestScore = score; best = v; }
    }
    return best || voices.find(v => v.lang.startsWith('en')) || voices[0];
  }

  function _speak(text, onEnd) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.pitch = PREFERRED_VOICE.pitch;
      u.rate = PREFERRED_VOICE.rate;
      u.onstart = () => { setState('speaking'); setStatus('Transmitting...'); };
      u.onboundary = (ev) => {
        if (ev.name === 'word') {
          targetAmp = 0.7 + Math.random() * 0.5;
          for (let b = 0; b < BAR_COUNT; b++) barT[b] = 0.08 + Math.random() * 0.45 * Math.sin((b / BAR_COUNT) * Math.PI);
          setTimeout(() => { if (state === 'speaking') { targetAmp = 0.25; for (let b = 0; b < BAR_COUNT; b++) barT[b] *= 0.25; } }, 130);
        }
      };
      u.onend = onEnd;
      window.speechSynthesis.speak(u);
    }, 150);
  }

  function speak(text) { _speak(text, () => goIdle()); }

  function speakThenListen(text) {
    _speak(text, () => {
      setState('idle');
      targetAmp = 0;
      clearBars();
      setStatus('Waiting for your answer...');
    });
  }


  // ═══════════════════════════════════════════════════════════
  // UI
  // ═══════════════════════════════════════════════════════════

  const suggestions = [
    'Say "Hey FRIDAY" to activate...',
    '"Hey FRIDAY, open Spotify"',
    '"Hey FRIDAY, search for..."',
    '"Hello FRIDAY, what\'s the weather?"',
    'Click the orb for manual activation',
  ];
  let sugIdx = 0;

  function rollSuggestion() {
    if (state !== 'idle' || cmdInput.value !== '') { cmdInput.placeholder = "speak or type..."; return; }
    cmdInput.style.transition = 'opacity 0.3s ease';
    cmdInput.style.opacity = '0';
    setTimeout(() => { cmdInput.placeholder = suggestions[sugIdx]; cmdInput.style.opacity = '1'; sugIdx = (sugIdx + 1) % suggestions.length; }, 300);
  }
  rollSuggestion();
  setInterval(rollSuggestion, 3500);

  function setState(s) {
    state = s;
    voiceBtn.classList.toggle('active', state === 'listening');
    try { if (orbIframe && orbIframe.contentWindow) orbIframe.contentWindow.postMessage({ type: 'setState', value: state }, '*'); } catch (e) { }
  }
  function setStatus(t) { statusEl.style.opacity = '0'; setTimeout(() => { statusEl.textContent = t; statusEl.style.opacity = '1'; }, 300); }
  function clearBars() { for (let b = 0; b < BAR_COUNT; b++) barT[b] = 0; }

  orbZone.addEventListener('click', () => { if (state === 'idle') { manualActivation = true; startRecording(); } else if (state === 'listening') stopRecording(); });
  voiceBtn.addEventListener('click', () => { if (state === 'idle') { manualActivation = true; startRecording(); } else if (state === 'listening') stopRecording(); });

  cmdInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const t = cmdInput.value.trim();
    if (!t) return;
    cmdInput.value = '';
    setState('thinking'); targetAmp = 0.5; setStatus('Processing...');
    sendTextCommand(t);
  });

  document.getElementById('closeBtn').addEventListener('click', () => window.close());

})();
