// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\executor.js
const { runAction } = require("./actionEngine");
const { queryAI, askFriday, clearHistory } = require("./aiQuery");

// Fallback handlers for command intents not in the action engine
const FALLBACK = {
  SEARCH:      ({ query })    => ({ ok: true,  message: `Searching for "${query}"…`, url: `https://google.com/search?q=${encodeURIComponent(query)}` }),
  REMINDER:    ({ task })     => ({ ok: true,  message: `Reminder set: "${task}"` }),
  TIMER:       ({ duration }) => ({ ok: true,  message: `Timer set for ${duration}` }),
  ALARM:       ({ time })     => ({ ok: true,  message: `Alarm set for ${time}` }),
  WEATHER:     ({ location }) => ({ ok: true,  message: `Fetching weather for ${location}… (mock: 22°C, sunny)` }),
  GET_TIME:    ()             => ({ ok: true,  message: `Current time: ${new Date().toLocaleTimeString()}` }),
  GET_DATE:    ()             => ({ ok: true,  message: `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}` }),
  MEDIA:       ({ action, target }) => ({ ok: true, message: `${action}${target ? ' ' + target : ''}` }),
  VOLUME:      ({ level })    => ({ ok: true,  message: `Volume ${level}` }),
  BRIGHTNESS:  ({ level })    => ({ ok: true,  message: `Brightness ${level}` }),
  SCREENSHOT:  ()             => ({ ok: true,  message: `Screenshot captured` }),
  SYSTEM:      ({ action })   => ({ ok: true,  message: `System ${action} initiated` }),
  CLOSE_APP:   ({ app })      => ({ ok: true,  message: `Closing ${app}…` }),
  MESSAGE:     ({ contact })  => ({ ok: true,  message: `Preparing message to ${contact}…` }),
};

// Helper to execute Spotify requests and intercept 401 errors
async function handleSpotifyFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    const err = new Error("Spotify unauthorized");
    err.status = 401;
    throw err;
  }
  return res;
}

/**
 * Execute an intent — handles both commands and AI queries.
 * @param {object} intentObj - Parsed intent from intentParser
 * @returns {Promise<object>} - Result with { ok, message, type }
 */
async function execute(intentObj, attachment = null) {
  // ── DUAL-AI ACTIONS INTERCEPT ──
  if (intentObj.action === 'ai_query') {
    if (typeof window !== 'undefined' && typeof window.fridaySetState === 'function') {
      window.fridaySetState('processing');
    }
    const reply = await askFriday(intentObj.query, intentObj.mode || 'auto', attachment);
    if (typeof window !== 'undefined' && typeof window.fridaySetState === 'function') {
      window.fridaySetState('speaking');
    }
    return { reply, message: reply, ok: true };
  }

  if (intentObj.action === 'ai_clear_history') {
    clearHistory();
    return { reply: 'Conversation history cleared. Starting fresh.', message: 'Conversation history cleared. Starting fresh.', ok: true };
  }

  if (intentObj.action === 'ai_set_mode') {
    const { setAIMode } = require('./intentParser');
    setAIMode(intentObj.mode);
    
    // Also update Electron HUD if available
    if (typeof window !== 'undefined' && typeof window.fridaySetAIMode === 'function') {
      window.fridaySetAIMode(intentObj.mode);
    }
    
    const modeNames = {
      gemini: 'Gemini 1.5 Pro',
      openai: 'GPT-4o',
      merged: 'Merged dual AI',
      auto: 'Automatic'
    };
    const reply = `AI mode switched to ${modeNames[intentObj.mode]}.`;
    return { reply, message: reply, ok: true };
  }

  // ── SPOTIFY PATH ──────────────────────────────────────────
  if (intentObj.intent === "SPOTIFY" || intentObj.intent.startsWith("spotify")) {
    const action = intentObj.params?.action || intentObj.intent;
    const query = intentObj.params?.query || intentObj.query || intentObj.params?.q || intentObj.q;
    const direction = intentObj.params?.direction || intentObj.direction;

    console.log(`[FRIDAY] Routing Spotify Action: ${action}`);
    try {
      // 1. Direct browser-side window context support (if executed in a frontend webview or shared Electron context)
      if (typeof window !== 'undefined') {
        switch (action) {
          case 'spotify_play':
            if (typeof window.fridaySpotifyPlay === 'function') {
              await window.fridaySpotifyPlay(query);
            }
            return { ok: true, reply: `Searching for ${query} on Spotify.`, message: `Searching for ${query} on Spotify.` };

          case 'spotify_pause':
            if (window.fridayPlayer) {
              await window.fridayPlayer.pause();
            } else if (typeof window.spotifyCommand === 'function') {
              await window.spotifyCommand('pause');
            }
            return { ok: true, reply: 'Music paused.', message: 'Music paused.' };

          case 'spotify_next':
            if (typeof window.spotifyCommand === 'function') {
              await window.spotifyCommand('next');
            }
            return { ok: true, reply: 'Next track.', message: 'Next track.' };

          case 'spotify_previous':
            if (typeof window.spotifyCommand === 'function') {
              await window.spotifyCommand('previous');
            }
            return { ok: true, reply: 'Previous track.', message: 'Previous track.' };

          case 'spotify_volume':
            const vol = direction === 'up' ? 80 : 30;
            if (typeof window.spotifyCommand === 'function') {
              await window.spotifyCommand('volume', { volume_percent: vol });
            }
            return { ok: true, reply: `Volume ${direction}.`, message: `Volume ${direction}.` };
        }
      }

      // 2. Standard robust Node/Express server backend fallback proxy
      const PORT = process.env.PORT || 8888;
      const CLOUD_URL = process.env.CLOUD_URL || 'https://f-r-i-d-a-y-8ixf.onrender.com';
      const isCloud = process.env.RENDER || (process.env.PORT && process.env.PORT !== "3131" && process.env.PORT !== "8888");
      const spotifyBase = `http://localhost:${PORT}`;

      switch (action) {
        case 'spotify_play':
          const searchRes = await handleSpotifyFetch(`${spotifyBase}/spotify/search?q=${encodeURIComponent(query)}`);
          const tracks = await searchRes.json();
          if (tracks && tracks.error) {
            const errStr = tracks.error.toLowerCase();
            if (errStr.includes("unauthorized") || errStr.includes("auth")) {
              const err = new Error("Spotify unauthorized");
              err.status = 401;
              throw err;
            }
            return { ok: false, message: `Spotify search error: ${tracks.error}` };
          }
          if (!tracks || tracks.length === 0) {
            return { ok: false, message: `I couldn't find "${query}" on Spotify.` };
          }
          const track = tracks[0];
          
          const playRes = await handleSpotifyFetch(`${spotifyBase}/spotify/play`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uri: track.uri, device_id: intentObj.params?.deviceId })
          });
          const playData = await playRes.json();
          if (playData.error) {
            const errStr = playData.error.toLowerCase();
            if (errStr.includes("unauthorized") || errStr.includes("auth")) {
              const err = new Error("Spotify unauthorized");
              err.status = 401;
              throw err;
            }
            if (errStr.includes("premium")) {
              return { ok: false, message: "Spotify error: Premium account required. Remotely controlling playback via the Web API is restricted to Spotify Premium users, Boss." };
            }
            if (errStr.includes("no active device") || errStr.includes("not found")) {
              return { ok: false, message: "Spotify error: No active device found. Please make sure you have the Spotify App open on your computer or phone, or are logged into the Web Player, to establish an active session, Boss." };
            }
            return { ok: false, message: `Spotify error: ${playData.error}` };
          }
          return { ok: true, message: `Playing ${track.name} by ${track.artist}`, reply: `Searching for ${query} on Spotify.` };

        case 'spotify_pause':
          await handleSpotifyFetch(`${spotifyBase}/spotify/pause`, { method: 'POST' });
          return { ok: true, message: 'Music paused.', reply: 'Music paused.' };

        case 'spotify_next':
          await handleSpotifyFetch(`${spotifyBase}/spotify/next`, { method: 'POST' });
          return { ok: true, message: 'Next track.', reply: 'Next track.' };

        case 'spotify_previous':
          await handleSpotifyFetch(`${spotifyBase}/spotify/previous`, { method: 'POST' });
          return { ok: true, message: 'Previous track.', reply: 'Previous track.' };

        case 'spotify_volume':
          const targetVol = direction === 'up' ? 80 : 30;
          await handleSpotifyFetch(`${spotifyBase}/spotify/volume`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ volume_percent: targetVol })
          });
          return { ok: true, message: `Volume ${direction}.`, reply: `Volume ${direction}.` };

        case 'spotify_current':
          const curRes = await handleSpotifyFetch(`${spotifyBase}/spotify/current`);
          const curData = await curRes.json();
          if (curData && curData.trackName) {
            return { ok: true, message: `Currently playing ${curData.trackName} by ${curData.artistName}`, reply: `Currently playing ${curData.trackName} by ${curData.artistName}` };
          }
          return { ok: true, message: 'Nothing is currently playing.', reply: 'Nothing is currently playing.' };
      }
    } catch (err) {
      console.error("[SPOTIFY EXECUTION ERROR]", err);
      if (err.status === 401) {
        const spotify = require("./spotify");
        const hasLocal = typeof spotify.hasLocalCreds === "function" ? spotify.hasLocalCreds() : false;
        const PORT = process.env.PORT || 8888;
        const authUrl = hasLocal 
          ? `http://localhost:${PORT}/spotify/login` 
          : `${process.env.CLOUD_URL || 'https://f-r-i-d-a-y-8ixf.onrender.com'}/spotify/login`;
        return {
          ok: false,
          openSpotify: true,
          message: `I'm not connected to Spotify yet, Boss. Please authorize Spotify by visiting: ${authUrl}`
        };
      }
      return { ok: false, message: `Spotify command failed: ${err.message}` };
    }
  }

  // ── AI QUERY PATH ─────────────────────────────────────────
  if (intentObj.type === "query") {
    console.log(`[FRIDAY] Routing to AI: "${intentObj.raw}"`);
    const reply = await askFriday(intentObj.raw, 'auto', attachment);
    return { reply, message: reply, ok: true, source: "askFriday", type: "query" };
  }

  // ── COMMAND PATH ──────────────────────────────────────────
  console.log(`[FRIDAY] Executing command: ${intentObj.intent}`);

  // 1. Try action engine first (CALL, OPEN_APP, CLOSE_APP, SEARCH, …)
  const result = await runAction(intentObj);
  if (result) return { ...result, type: "command" };

  // 2. Fall back to simple handlers
  const handler = FALLBACK[intentObj.intent];
  if (handler) return { ...handler(intentObj.params, intentObj.raw), type: "command" };

  // 3. Nothing matched — send to AI as last resort
  console.log(`[FRIDAY] Unknown command, falling back to AI`);
  const reply = await askFriday(intentObj.raw, 'auto', attachment);
  return { reply, message: reply, ok: true, source: "askFriday", type: "query" };
}

module.exports = { execute };
