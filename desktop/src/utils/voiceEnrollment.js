// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\desktop\src\utils\voiceEnrollment.js

const SAMPLE_COUNT = 3
const MIN_RECORD_MS = 1500
const MAX_RECORD_MS = 5000
const PROFILE_KEY = 'friday_voice_profile'
const MFCC_BINS = 13

let audioCtx = null
let analyser = null
let mediaStream = null
let scriptProcessor = null
let enrollmentChunks = []
let enrolledSamples = []
let currentStep = 0
let isRecording = false
let safetyTimeout = null

/**
 * Initializes voice enrollment microphone input and audio graph.
 * @returns {Promise<boolean>} True if microphone is authorized and graph initialized.
 */
async function initEnrollmentAudio() {
  console.log('[FRIDAY VOICE] Initializing enrollment audio graph...');
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000
      }
    });

    audioCtx = new AudioContext({ sampleRate: 16000 });
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;

    scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);

    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    analyser.connect(scriptProcessor);
    scriptProcessor.connect(audioCtx.destination);

    scriptProcessor.onaudioprocess = (e) => {
      if (isRecording) {
        const input = e.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        enrollmentChunks.push(copy);
      }
    };

    console.log('[FRIDAY VOICE] Microphone stream and AudioContext initialized successfully at 16000Hz.');
    return true;
  } catch (err) {
    console.error('[FRIDAY VOICE] Microphone access denied or initialization failed:', err);
    return false;
  }
}

/**
 * Starts recording mic input.
 */
function startRecording() {
  if (isRecording) return;

  // Explicitly resume suspended AudioContext due to browser autoplay policies
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => {
      console.log('[FRIDAY VOICE] AudioContext resumed successfully.');
    }).catch(e => {
      console.error('[FRIDAY VOICE] Failed to resume AudioContext:', e);
    });
  }

  isRecording = true;
  enrollmentChunks = [];

  console.log('[FRIDAY VOICE] Recording started.');

  // Safety timeout to automatically stop recording after MAX_RECORD_MS
  safetyTimeout = setTimeout(() => {
    console.log('[FRIDAY VOICE] Safety timeout reached. Stopping recording...');
    stopRecording();
  }, MAX_RECORD_MS);
}

/**
 * Stops current recording.
 */
function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  if (safetyTimeout) {
    clearTimeout(safetyTimeout);
    safetyTimeout = null;
  }

  console.log('[FRIDAY VOICE] Recording stopped, processing chunk...');
  window.fridayVoiceEnrollment.processRecordedSample();
}

/**
 * Processes the captured audio buffer in memory and extracts voice profile features instantly.
 */
async function processRecordedSample() {
  try {
    const totalSamples = enrollmentChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const pcmSamples = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of enrollmentChunks) {
      pcmSamples.set(chunk, offset);
      offset += chunk.length;
    }
    enrollmentChunks = [];

    console.log(`[FRIDAY VOICE] Captured raw audio successfully. Total samples: ${pcmSamples.length}`);
    
    const featureVector = extractVoiceFeatures(pcmSamples);
    enrolledSamples.push(featureVector);
    currentStep++;

    console.log(`[FRIDAY VOICE] Sample ${currentStep} of ${SAMPLE_COUNT} enrolled successfully.`);
  } catch (err) {
    console.error('[FRIDAY VOICE] Error in processRecordedSample:', err);
  }
}

/**
 * Extracts acoustic fingerprint feature vector (22 floats) from raw PCM samples.
 * @param {Float32Array} pcmSamples 
 * @returns {Float32Array} Normalized feature vector.
 */
function extractVoiceFeatures(pcmSamples, analyserOverride = null) {
  const segmentCount = 10;
  const segmentLength = Math.floor(pcmSamples.length / segmentCount);

  // 1. ENERGY PROFILE (RMS) & 2. ZERO CROSSING RATE (ZCR)
  const energyProfile = new Float32Array(segmentCount);
  const zeroCrossingRate = new Float32Array(segmentCount);

  for (let s = 0; s < segmentCount; s++) {
    const startIdx = s * segmentLength;
    const endIdx = startIdx + segmentLength;
    
    let sumSq = 0;
    let crossCount = 0;
    
    for (let i = startIdx; i < endIdx; i++) {
      const val = pcmSamples[i];
      sumSq += val * val;
      
      if (i > startIdx) {
        const prevVal = pcmSamples[i - 1];
        if ((val >= 0 && prevVal < 0) || (val < 0 && prevVal >= 0)) {
          crossCount++;
        }
      }
    }
    
    energyProfile[s] = Math.sqrt(sumSq / segmentLength);
    zeroCrossingRate[s] = crossCount / segmentLength;
  }

  // Local RMS profile normalization to achieve volume invariance
  let maxEnergy = 0;
  for (let i = 0; i < segmentCount; i++) {
    if (energyProfile[i] > maxEnergy) maxEnergy = energyProfile[i];
  }
  for (let i = 0; i < segmentCount; i++) {
    energyProfile[i] = maxEnergy > 0 ? energyProfile[i] / maxEnergy : 0;
  }

  // 3. Robust DFT-Based SPECTRAL CENTROID over the peak energy window of 512 samples
  let spectralCentroid = 0.5; // fallback
  const dftWindowSize = 512;
  if (pcmSamples.length >= dftWindowSize) {
    let peakEnergy = -1;
    let peakStart = 0;
    for (let i = 0; i <= pcmSamples.length - dftWindowSize; i += 256) {
      let energy = 0;
      for (let j = 0; j < dftWindowSize; j++) {
        const v = pcmSamples[i + j];
        energy += v * v;
      }
      if (energy > peakEnergy) {
        peakEnergy = energy;
        peakStart = i;
      }
    }

    const binCount = 128;
    const binHz = 8000 / binCount; // sampleRate = 16000 (Nyquist = 8000)
    let weightedSum = 0;
    let totalMagnitude = 0;

    for (let k = 0; k < binCount; k++) {
      let real = 0;
      let imag = 0;
      const angleArg = (2 * Math.PI * k) / dftWindowSize;
      for (let n = 0; n < dftWindowSize; n++) {
        const sample = pcmSamples[peakStart + n];
        const angle = angleArg * n;
        real += sample * Math.cos(angle);
        imag -= sample * Math.sin(angle);
      }
      const magnitude = Math.sqrt(real * real + imag * imag);
      const freq = k * binHz;
      weightedSum += magnitude * freq;
      totalMagnitude += magnitude;
    }

    const rawCentroid = totalMagnitude > 0 ? (weightedSum / totalMagnitude) : 1200;
    spectralCentroid = Math.max(0, Math.min(rawCentroid / 8000, 1.0));
  }

  // 4. Robust PITCH ESTIMATE (Autocorrelation on 1024-sample window centered at peak energy segment)
  const pitchWindowSize = 1024;
  let pitchEstimate = 0.5; // default fallback normalized pitch
  if (pcmSamples.length >= pitchWindowSize) {
    let peakEnergy = -1;
    let peakStart = 0;
    for (let i = 0; i <= pcmSamples.length - pitchWindowSize; i += 256) {
      let energy = 0;
      for (let j = 0; j < pitchWindowSize; j++) {
        const v = pcmSamples[i + j];
        energy += v * v;
      }
      if (energy > peakEnergy) {
        peakEnergy = energy;
        peakStart = i;
      }
    }

    const pitchWindow = pcmSamples.slice(peakStart, peakStart + pitchWindowSize);
    
    // Autocorrelation for lags 50 to 500 (32Hz to 320Hz at 16kHz)
    let bestLag = -1;
    let maxCorrelation = -Infinity;
    
    for (let lag = 50; lag <= 500; lag++) {
      let correlation = 0;
      for (let i = 0; i < pitchWindowSize - lag; i++) {
        correlation += pitchWindow[i] * pitchWindow[i + lag];
      }
      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
        bestLag = lag;
      }
    }
    
    if (bestLag > 0) {
      const freq = 16000 / bestLag;
      // Normalize relative to typical voice range (80Hz to 300Hz)
      const normPitch = (freq - 80) / (300 - 80);
      pitchEstimate = Math.max(0, Math.min(normPitch, 1.0));
    }
  }

  // 5. VOICE ACTIVITY RATIO
  let activeSamples = 0;
  for (let i = 0; i < pcmSamples.length; i++) {
    if (Math.abs(pcmSamples[i]) > 0.01) {
      activeSamples++;
    }
  }
  const voiceActivityRatio = pcmSamples.length > 0 ? (activeSamples / pcmSamples.length) : 0;

  // Assemble the 22 features
  const rawFeatures = [
    ...energyProfile,
    ...zeroCrossingRate,
    spectralCentroid,
    pitchEstimate,
    voiceActivityRatio
  ];

  // We return the raw features directly. They are all individually bounded strictly between 0 and 1.
  // Mixing and scaling different physical metrics via a global min-max is mathematically flawed
  // and breaks cosine similarity stability.
  const featureVector = new Float32Array(rawFeatures);

  console.log('[FRIDAY VOICE] Extracted voice feature signature vector (22 points).');
  return featureVector;
}

/**
 * Averages vectors and standard deviations to generate and save a secure local Voice Profile.
 */
function saveVoiceProfile() {
  if (enrolledSamples.length < SAMPLE_COUNT) {
    console.error(`[FRIDAY VOICE] Cannot save voice profile: Only ${enrolledSamples.length} of ${SAMPLE_COUNT} samples recorded.`);
    return null;
  }

  const vecSize = enrolledSamples[0].length;
  const averagedVector = new Float32Array(vecSize);
  const stdDevVector = new Float32Array(vecSize);

  // Calculate Element-wise Average
  for (let i = 0; i < vecSize; i++) {
    let sum = 0;
    for (let s = 0; s < SAMPLE_COUNT; s++) {
      sum += enrolledSamples[s][i];
    }
    averagedVector[i] = sum / SAMPLE_COUNT;
  }

  // Calculate Element-wise Standard Deviation (Tolerance Range)
  for (let i = 0; i < vecSize; i++) {
    let sumSqDiff = 0;
    const avg = averagedVector[i];
    for (let s = 0; s < SAMPLE_COUNT; s++) {
      const diff = enrolledSamples[s][i] - avg;
      sumSqDiff += diff * diff;
    }
    // Calculate sample standard deviation
    stdDevVector[i] = Math.sqrt(sumSqDiff / SAMPLE_COUNT);
  }

  const profile = {
    version: 1,
    createdAt: Date.now(),
    featureVector: Array.from(averagedVector),
    toleranceVector: Array.from(stdDevVector),
    sampleCount: SAMPLE_COUNT
  };

  // Save to LocalStorage
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));

  // Save via Electron IPC if available
  if (window.electronAPI?.saveVoiceProfile) {
    window.electronAPI.saveVoiceProfile(JSON.stringify(profile))
      .then(res => {
        console.log('[FRIDAY VOICE] Electron IPC voice profile synced to userData folder.');
      })
      .catch(err => {
        console.error('[FRIDAY VOICE] Electron IPC voice profile sync failed:', err);
      });
  }

  console.log('[FRIDAY VOICE] Voice profile saved successfully');
  return profile;
}

/**
 * Loads the active Voice Profile from localStorage or Electron IPC.
 */
async function loadVoiceProfile() {
  try {
    let profileJSON = localStorage.getItem(PROFILE_KEY);
    
    if (!profileJSON && window.electronAPI?.loadVoiceProfile) {
      profileJSON = await window.electronAPI.loadVoiceProfile();
      if (profileJSON) {
        localStorage.setItem(PROFILE_KEY, profileJSON);
      }
    }

    if (!profileJSON) {
      return null;
    }

    const profile = JSON.parse(profileJSON);
    console.log('[FRIDAY VOICE] Voice profile loaded');
    return profile;
  } catch (err) {
    console.error('[FRIDAY VOICE] Error loading voice profile:', err);
    return null;
  }
}

/**
 * Returns true if a voice profile is enrolled.
 */
async function hasVoiceProfile() {
  const profile = await loadVoiceProfile();
  return profile !== null;
}

/**
 * Clears saved voice profile.
 */
function clearVoiceProfile() {
  localStorage.removeItem(PROFILE_KEY);
  enrolledSamples = [];
  currentStep = 0;

  if (window.electronAPI?.clearVoiceProfile) {
    window.electronAPI.clearVoiceProfile();
  }
  console.log('[FRIDAY VOICE] Voice profile cleared');
}

// Exports
const exportsObj = {
  initEnrollmentAudio,
  startRecording,
  stopRecording,
  processRecordedSample,
  extractVoiceFeatures,
  saveVoiceProfile,
  loadVoiceProfile,
  hasVoiceProfile,
  clearVoiceProfile,
  currentStep: () => currentStep,
  isRecording: () => isRecording
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = exportsObj;
}

// Expose on window for frontend use
window.fridayVoiceEnrollment = exportsObj;
