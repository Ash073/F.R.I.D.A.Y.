const { runAction } = require("./actionEngine");
const { queryAI }   = require("./aiQuery");

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

/**
 * Execute an intent — handles both commands and AI queries.
 * @param {object} intentObj - Parsed intent from intentParser
 * @returns {Promise<object>} - Result with { ok, message, type }
 */
async function execute(intentObj) {
  // ── SPOTIFY PATH ──────────────────────────────────────────
  if (intentObj.intent === "SPOTIFY") {
    console.log(`[FRIDAY] Routing Spotify Action: ${intentObj.params.action}`);
    try {
      const { action, query, direction } = intentObj.params;
      
      const PORT = process.env.PORT || 3131;
      const CLOUD_URL = process.env.CLOUD_URL || 'https://f-r-i-d-a-y-8ixf.onrender.com';
      const isCloud = process.env.RENDER || (process.env.PORT && process.env.PORT !== "3131" && process.env.PORT !== "8888");
      const spotifyBase = isCloud ? `http://localhost:${PORT}` : CLOUD_URL;

      if (action === 'spotify_play') {
        const searchRes = await fetch(`${spotifyBase}/spotify/search?q=${encodeURIComponent(query)}`);
        const tracks = await searchRes.json();
        if (tracks && tracks.error) {
          if (tracks.error.toLowerCase().includes("unauthorized") || tracks.error.toLowerCase().includes("auth")) {
            return { ok: false, message: `I'm not connected to Spotify yet, Boss. Please authorize Spotify by visiting: ${CLOUD_URL}/spotify/login` };
          }
          return { ok: false, message: `Spotify search error: ${tracks.error}` };
        }
        if (!tracks || tracks.length === 0) {
          return { ok: false, message: `I couldn't find "${query}" on Spotify.` };
        }
        const track = tracks[0];
        
        const playRes = await fetch(`${spotifyBase}/spotify/play`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri: track.uri, device_id: intentObj.params.deviceId })
        });
        const playData = await playRes.json();
        if (playData.error) {
          return { ok: false, message: `Spotify error: ${playData.error}` };
        }
        return { ok: true, message: `Playing ${track.name} by ${track.artist}`, reply: `Playing ${track.name} by ${track.artist}` };
      }

      if (action === 'spotify_pause') {
        await fetch(`${spotifyBase}/spotify/pause`, { method: 'POST' });
        return { ok: true, message: 'Music paused.', reply: 'Music paused.' };
      }

      if (action === 'spotify_next') {
        await fetch(`${spotifyBase}/spotify/next`, { method: 'POST' });
        return { ok: true, message: 'Skipping track.', reply: 'Skipping track.' };
      }

      if (action === 'spotify_previous') {
        await fetch(`${spotifyBase}/spotify/previous`, { method: 'POST' });
        return { ok: true, message: 'Going back.', reply: 'Going back.' };
      }

      if (action === 'spotify_volume') {
        const targetVol = direction === 'up' ? 80 : 30;
        await fetch(`${spotifyBase}/spotify/volume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ volume_percent: targetVol })
        });
        return { ok: true, message: 'Volume adjusted.', reply: 'Volume adjusted.' };
      }

      if (action === 'spotify_current') {
        const curRes = await fetch(`${spotifyBase}/spotify/current`);
        const curData = await curRes.json();
        if (curData && curData.trackName) {
          return { ok: true, message: `Currently playing ${curData.trackName} by ${curData.artistName}`, reply: `Currently playing ${curData.trackName} by ${curData.artistName}` };
        }
        return { ok: true, message: 'Nothing is currently playing.', reply: 'Nothing is currently playing.' };
      }
    } catch (err) {
      console.error("[SPOTIFY EXECUTION ERROR]", err);
      return { ok: false, message: `Spotify command failed: ${err.message}` };
    }
  }

  // ── AI QUERY PATH ─────────────────────────────────────────
  if (intentObj.type === "query") {
    console.log(`[FRIDAY] Routing to AI: "${intentObj.raw}"`);
    const aiResult = await queryAI(intentObj.raw);
    return { ...aiResult, type: "query" };
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
  const aiResult = await queryAI(intentObj.raw);
  return { ...aiResult, type: "query" };
}

module.exports = { execute };
