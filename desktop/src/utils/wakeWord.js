// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\desktop\src\utils\wakeWord.js

const WAKE_PHRASES = ['hey friday', 'hey, friday', 'hey fridey', 'hey fridy', 'if friday', 'if, friday', 'friday']
const VOICE_MATCH_THRESHOLD = 0.72
const NOISE_GATE_THRESHOLD = 0.015
const COMMAND_SILENCE_MS = 1800
const MAX_COMMAND_MS = 8000
const BACKEND = 'http://localhost:8888'

let wakeWordActive = false
let commandMode = false
let audioCtx = null
let analyser = null
let mediaStream = null
let scriptProcessor = null
let voiceProfile = null
let commandBuffer = []
let wakeWordBuffer = []
let samplesSinceLastCheck = 0
let commandSilenceTimer = null
let commandMaxTimer = null
let currentRMS = 0
let isOwnerVoice = false
let lastVoiceTime = 0

/**
 * Initializes the background Wake Word Engine.
 * @returns {Promise<boolean>} True if initialized successfully.
 */
async function initWakeWord() {
  console.log('[FRIDAY WAKE] Initializing wake word engine...');
  
  // 1. Load Voice Profile
  try {
    if (window.fridayVoiceEnrollment && typeof window.fridayVoiceEnrollment.loadVoiceProfile === 'function') {
      voiceProfile = await window.fridayVoiceEnrollment.loadVoiceProfile();
    }
    if (!voiceProfile) {
      console.log('[FRIDAY WAKE] No voice profile enrolled — running without owner verification');
      voiceProfile = null;
    } else {
      console.log('[FRIDAY WAKE] Voice profile loaded successfully for speaker isolation.');
    }
  } catch (err) {
    console.error('[FRIDAY WAKE] Error loading voice profile, continuing without verification:', err);
    voiceProfile = null;
  }

  // 2. Request microphone with autoGainControl: false to preserve raw acoustic amplitudes
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 16000
      }
    });

    // 3. Create AudioContext
    audioCtx = new AudioContext({ sampleRate: 16000 });
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(e => console.error('[FRIDAY WAKE] Failed to resume AudioContext during init:', e));
    }

    // 4. Create analyser
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;

    // 5. Create ScriptProcessorNode
    scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);

    // 6. Connect graph
    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(audioCtx.destination);

    // 7. Set process callback
    scriptProcessor.onaudioprocess = onAudioChunk;

    // 8. Set state
    wakeWordActive = true;
    commandMode = false;
    commandBuffer = [];
    wakeWordBuffer = [];
    samplesSinceLastCheck = 0;

    console.log('[FRIDAY WAKE] Wake word engine initialized — listening for: Hey Friday');

    // 9. Update UI Status
    if (typeof window.fridaySetStatus === 'function') {
      window.fridaySetStatus('PASSIVE', 'Say "Hey Friday"');
    }

    return true;
  } catch (err) {
    console.error('[FRIDAY WAKE] Microphone access denied or graph failed:', err);
    return false;
  }
}

/**
 * onaudioprocess callback processing audio chunks.
 * Handles noise gating, rolling buffer updates, and command buffering.
 */
function onAudioChunk(audioProcessingEvent) {
  if (!wakeWordActive) return;

  const inputBuffer = audioProcessingEvent.inputBuffer.getChannelData(0); // Float32Array (4096 samples)
  
  // Calculate RMS
  let sumSq = 0;
  for (let i = 0; i < inputBuffer.length; i++) {
    sumSq += inputBuffer[i] * inputBuffer[i];
  }
  currentRMS = Math.sqrt(sumSq / inputBuffer.length);

  // Update visualizer amplitude
  window.fridayAmplitude = currentRMS * 8;

  // VOICE COMMAND RECORDING MODE
  if (commandMode) {
    // NOISE GATE Check for Silence detection
    if (currentRMS < NOISE_GATE_THRESHOLD) {
      // If we are in command mode and it's silent, let the silence timer run
      // It will eventually trigger finalizeCommand when COMMAND_SILENCE_MS is reached.
      return;
    }
    
    lastVoiceTime = Date.now();

    // Accumulate command audio
    const chunkCopy = new Float32Array(inputBuffer.length);
    chunkCopy.set(inputBuffer);
    commandBuffer.push(chunkCopy);

    // Reset silence timer
    if (commandSilenceTimer) clearTimeout(commandSilenceTimer);
    commandSilenceTimer = setTimeout(finalizeCommand, COMMAND_SILENCE_MS);
    return;
  }

  // PASSIVE WAKE WORD LISTENING MODE
  // Accumulate ALL chunks continuously into the rolling wakeWordBuffer (3-second window)
  // to maintain absolute time continuity and avoid stitching distortions
  for (let i = 0; i < inputBuffer.length; i++) {
    wakeWordBuffer.push(inputBuffer[i]);
  }

  // Cap wakeWordBuffer to 3 seconds of audio at 16kHz (48000 samples)
  if (wakeWordBuffer.length > 48000) {
    wakeWordBuffer = wakeWordBuffer.slice(wakeWordBuffer.length - 48000);
  }

  // Every time we accumulate 0.75 seconds of audio (12000 samples) and have at least 1.5 seconds (24000 samples)
  samplesSinceLastCheck += inputBuffer.length;
  if (wakeWordBuffer.length >= 24000 && samplesSinceLastCheck >= 12000) {
    samplesSinceLastCheck = 0;
    
    // Extract current buffer as Float32Array
    const audioBuffer = new Float32Array(wakeWordBuffer);

    // Only check for wake word if the buffer has actual voice energy 
    // to prevent calling Whisper transcription on pure silence
    let maxRMSInBuffer = 0;
    const step = 4000;
    for (let offset = 0; offset < audioBuffer.length; offset += step) {
      let subSum = 0;
      const limit = Math.min(offset + step, audioBuffer.length);
      const len = limit - offset;
      for (let j = offset; j < limit; j++) {
        subSum += audioBuffer[j] * audioBuffer[j];
      }
      const rms = Math.sqrt(subSum / len);
      if (rms > maxRMSInBuffer) maxRMSInBuffer = rms;
    }

    if (maxRMSInBuffer >= NOISE_GATE_THRESHOLD) {
      checkForWakeWord(audioBuffer);
    }
  }
}

/**
 * Checks rolling audio window for wake word and owner verification.
 */
async function checkForWakeWord(audioBuffer) {
  // 1. OWNER VOICE CHECK (if profile exists)
  if (voiceProfile) {
    let features;
    if (window.fridayVoiceEnrollment && typeof window.fridayVoiceEnrollment.extractVoiceFeatures === 'function') {
      features = window.fridayVoiceEnrollment.extractVoiceFeatures(audioBuffer, analyser);
    }
    
    if (features) {
      const matchScore = matchVoiceProfile(features);
      if (matchScore < VOICE_MATCH_THRESHOLD) {
        console.log(`[FRIDAY WAKE] Voice detected but not owner (Score: ${matchScore.toFixed(3)}) — ignoring`);
        isOwnerVoice = false;
        return false;
      }
      isOwnerVoice = true;
    }
  } else {
    isOwnerVoice = false;
  }

  // 2. SEND TO WHISPER FOR WAKE WORD TRANSCRIPTION
  try {
    const wavBlob = encodeWAV(audioBuffer);
    const formData = new FormData();
    formData.append('audio', wavBlob, 'wake.wav');

    const res = await fetch(`${BACKEND}/transcribe/wake`, {
      method: 'POST',
      body: formData
    });
    
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}`);
    }

    const data = await res.json();
    const transcript = (data.transcript || '').toLowerCase().trim();

    if (!transcript) return false;

    // 3. WAKE WORD MATCHING
    let isMatched = false;
    
    // Direct phrase matching
    for (const phrase of WAKE_PHRASES) {
      if (transcript.includes(phrase)) {
        isMatched = true;
        break;
      }
    }

    // Fuzzy Levenshtein phonetic check
    if (!isMatched) {
      const words = transcript.split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        if (levenshteinDistance(words[i], 'friday') <= 2) {
          isMatched = true;
          break;
        }
        if (i < words.length - 1) {
          const doubleWord = words[i] + ' ' + words[i + 1];
          if (levenshteinDistance(doubleWord, 'hey friday') <= 3) {
            isMatched = true;
            break;
          }
        }
      }
    }

    if (isMatched) {
      console.log(`[FRIDAY WAKE] Wake word detected! Transcript: "${transcript}". Owner Voice: ${voiceProfile ? isOwnerVoice : 'UNVERIFIED'}`);
      onWakeWordDetected();
      return true;
    }

  } catch (err) {
    console.error('[FRIDAY WAKE] Wake word transcription failed:', err);
  }

  return false;
}

/**
 * Calculates weighted cosine similarity and tolerance penalty.
 */
function matchVoiceProfile(featureVector) {
  if (!voiceProfile) return 1.0;

  const targetVector = voiceProfile.featureVector;
  const toleranceVector = voiceProfile.toleranceVector;
  const len = featureVector.length;

  // Cosine Similarity
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dotProduct += featureVector[i] * targetVector[i];
    normA += featureVector[i] * featureVector[i];
    normB += targetVector[i] * targetVector[i];
  }

  const cosineSimilarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

  // Tolerance range calculation
  let penaltyScore = 0;
  for (let i = 0; i < len; i++) {
    const diff = Math.abs(featureVector[i] - targetVector[i]);
    const tolerance = toleranceVector[i] * 2; // generous tolerance range
    if (diff > tolerance) {
      penaltyScore += (diff - tolerance);
    }
  }

  const normalizedPenalty = penaltyScore / len;
  const finalScore = cosineSimilarity - normalizedPenalty;

  console.log(`[FRIDAY WAKE] Cosine: ${cosineSimilarity.toFixed(3)}, Penalty: ${normalizedPenalty.toFixed(3)}. Voice match score: ${finalScore.toFixed(3)}`);
  return finalScore;
}

/**
 * Transitions the pipeline state machine into command recording mode.
 */
function onWakeWordDetected() {
  commandMode = true;
  commandBuffer = [];
  wakeWordBuffer = []; // clear rolling buffer to avoid double triggers
  
  if (typeof window.fridaySetState === 'function') {
    window.fridaySetState('listening');
  }
  if (typeof window.fridaySetStatus === 'function') {
    window.fridaySetStatus('LISTENING', 'Speak your command...');
  }

  // Play subtle activation sound
  const audio = new Audio('./assets/activate.mp3');
  audio.volume = 0.20;
  audio.play().catch(e => {
    // Catch silently if activation asset is not present yet
  });

  // Start command timers
  if (commandMaxTimer) clearTimeout(commandMaxTimer);
  commandMaxTimer = setTimeout(finalizeCommand, MAX_COMMAND_MS);

  if (commandSilenceTimer) clearTimeout(commandSilenceTimer);
  commandSilenceTimer = setTimeout(finalizeCommand, COMMAND_SILENCE_MS);

  console.log('[FRIDAY WAKE] Command mode activated — waiting for voice command...');
}

/**
 * Stops command recording and dispatches WAV blob to local Whisper base model.
 */
async function finalizeCommand() {
  if (commandMaxTimer) { clearTimeout(commandMaxTimer); commandMaxTimer = null; }
  if (commandSilenceTimer) { clearTimeout(commandSilenceTimer); commandSilenceTimer = null; }

  if (!commandMode) return;
  commandMode = false;

  // Flatten the accumulated chunks
  const totalSamples = commandBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
  
  if (totalSamples < 8000) { // less than 0.5 seconds of audio
    console.log('[FRIDAY WAKE] Command too short — ignoring.');
    commandBuffer = [];
    if (typeof window.fridaySetState === 'function') window.fridaySetState('idle');
    if (typeof window.fridaySetStatus === 'function') window.fridaySetStatus('PASSIVE', 'Say "Hey Friday"');
    return;
  }

  const pcmData = new Float32Array(totalSamples);
  let offset = 0;
  for (let chunk of commandBuffer) {
    pcmData.set(chunk, offset);
    offset += chunk.length;
  }
  commandBuffer = [];

  if (typeof window.fridaySetState === 'function') {
    window.fridaySetState('processing');
  }
  if (typeof window.fridaySetStatus === 'function') {
    window.fridaySetStatus('PROCESSING', 'Analyzing command...');
  }

  try {
    const wavBlob = encodeWAV(pcmData);
    const formData = new FormData();
    formData.append('audio', wavBlob, 'command.wav');
    if (window.fridayDeviceId) {
      formData.append('deviceId', window.fridayDeviceId);
    }

    console.log('[FRIDAY WAKE] Sending command audio block to backend transcribe...');
    const res = await fetch(`${BACKEND}/transcribe`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}`);
    }

    const data = await res.json();
    const transcript = (data.text || '').trim();

    console.log(`[FRIDAY WAKE] Command transcribed: "${transcript}"`);

    if (!transcript) {
      if (typeof window.fridaySetState === 'function') window.fridaySetState('idle');
      if (typeof window.fridaySetStatus === 'function') window.fridaySetStatus('PASSIVE', 'Say "Hey Friday"');
      return;
    }

    // Execute the final cinematic action
    if (typeof window.fridayProcessCommand === 'function') {
      await window.fridayProcessCommand(transcript);
    }

  } catch (err) {
    console.error('[FRIDAY WAKE] Command transcription pipeline failed:', err);
  }

  // Reset to passive mode
  setTimeout(() => {
    commandBuffer = [];
    if (typeof window.fridaySetStatus === 'function') {
      window.fridaySetStatus('PASSIVE', 'Say "Hey Friday"');
    }
  }, 500);
}

/**
 * Encodes Float32 PCM samples into a pure 16kHz, 16-bit, mono WAV audio Blob.
 */
function encodeWAV(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw PCM) */
  view.setUint16(20, 1, true);
  /* channel count (mono) */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, 16000, true);
  /* byte rate (sampleRate * blockAlign) */
  view.setUint32(28, 32000, true);
  /* block align (channelCount * bytesPerSample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  // PCM data: convert float32 samples to int16
  let index = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(index, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    index += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Standard Levenshtein distance implementation.
 */
function levenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,    // deletion
          matrix[i][j - 1] + 1,    // insertion
          matrix[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Pauses background wake word detection.
 */
function pauseWakeWord() {
  wakeWordActive = false;
  console.log('[FRIDAY WAKE] Wake word detection paused');
}

/**
 * Resumes background wake word detection.
 */
function resumeWakeWord() {
  wakeWordActive = true;
  commandMode = false;
  commandBuffer = [];
  wakeWordBuffer = [];
  
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => console.error('[FRIDAY WAKE] Failed to resume AudioContext:', e));
  }
  
  if (typeof window.fridaySetStatus === 'function') {
    window.fridaySetStatus('PASSIVE', 'Say "Hey Friday"');
  }
  console.log('[FRIDAY WAKE] Wake word detection resumed');
}

/**
 * Completely destroys the wake word microphone graph and release resources.
 */
function destroyWakeWord() {
  wakeWordActive = false;
  
  if (scriptProcessor) {
    scriptProcessor.disconnect();
    scriptProcessor.onaudioprocess = null;
    scriptProcessor = null;
  }
  
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  
  analyser = null;
  voiceProfile = null;
  
  console.log('[FRIDAY WAKE] Wake word engine destroyed');
}

function manualTrigger() {
  if (wakeWordActive && !commandMode) {
    // Explicitly resume AudioContext if suspended due to browser autoplay policies
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(e => console.error('[FRIDAY WAKE] Failed to resume AudioContext:', e));
    }
    console.log('[FRIDAY WAKE] Manual trigger received. Activating command mode...');
    onWakeWordDetected();
  }
}

function manualStop() {
  if (wakeWordActive && commandMode) {
    console.log('[FRIDAY WAKE] Manual stop received. Finalizing command...');
    finalizeCommand();
  }
}

// Expose on window object
window.fridayWakeWord = {
  init: initWakeWord,
  pause: pauseWakeWord,
  resume: resumeWakeWord,
  destroy: destroyWakeWord,
  manualTrigger: manualTrigger,
  manualStop: manualStop,
  getStatus: () => ({ active: wakeWordActive, commandMode, isOwnerVoice, currentRMS })
};
