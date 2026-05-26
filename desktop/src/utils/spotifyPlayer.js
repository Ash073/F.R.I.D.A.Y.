// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\desktop\src\utils\spotifyPlayer.js
/**
 * F.R.I.D.A.Y. Spotify Web Playback SDK integration & HUD Sync Module.
 * Connects the virtual 'FRIDAY System' Web Player, coordinates dual widget displays,
 * manages progress bars/tickers, and handles direct/priority playback commands.
 */

const CLOUD_URL = window.FRIDAY_CLOUD_URL || 'https://f-r-i-d-a-y-8ixf.onrender.com';
const LOCAL_URL = 'http://localhost:8888';

let progressInterval = null;

/**
 * Smart fetch helper that queries the local backend first, falling back to cloud.
 */
async function fetchFromBackend(path, options = {}) {
  const targetPath = path.startsWith('/') ? path : `/${path}`;
  
  // Try to use the pre-loaded dynamic routing client if it exists (automatically handles port detection)
  if (typeof window !== 'undefined' && window.friday && typeof window.friday.fridayFetch === 'function') {
    try {
      const res = await window.friday.fridayFetch('spotify', targetPath, options);
      if (res.ok) return res;
      throw new Error(`fridayFetch returned status ${res.status}`);
    } catch (err) {
      console.log(`[FRIDAY Spotify] Dynamic router unavailable (${err.message}). Using static local fallback...`);
    }
  }

  // Fallback to static localhost URL
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${LOCAL_URL}${targetPath}`, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) return res;
    throw new Error(`Local returned status ${res.status}`);
  } catch (err) {
    console.log(`[FRIDAY Spotify] Local endpoint unavailable (${err.message}). Using cloud...`);
    return await fetch(`${CLOUD_URL}${targetPath}`, options);
  }
}

/**
 * Convert milliseconds to "m:ss" format
 */
function formatTime(ms) {
  if (isNaN(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export async function initSpotifyPlayer() {
  try {
    console.log("[FRIDAY Spotify] Initializing Spotify Player...");
    
    // 1. Load https://sdk.scdn.co/spotify-player.js dynamically if not already loaded
    if (!document.getElementById("spotify-player-sdk")) {
      const script = document.createElement("script");
      script.id = "spotify-player-sdk";
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      document.body.appendChild(script);
    }

    // 2. Wait for window.onSpotifyWebPlaybackSDKReady to fire
    window.onSpotifyWebPlaybackSDKReady = async () => {
      try {
        console.log("[FRIDAY Spotify] Web Playback SDK is Ready. Fetching OAuth Token...");
        
        // 3. Fetch token: GET /spotify/token
        const tokenRes = await fetchFromBackend('/spotify/token');
        const tokenData = await tokenRes.json();
        const token = tokenData.token;
        if (!token) {
          throw new Error("No Spotify token returned from server.");
        }

        // 4. Initialize Spotify Player
        const player = new Spotify.Player({
          name: 'FRIDAY System',
          getOAuthToken: cb => cb(token),
          volume: 0.7
        });

        // 5. Register listeners:
        player.addListener('ready', ({ device_id }) => {
          console.log('[FRIDAY Spotify] Ready with Device ID:', device_id);
          window.fridayDeviceId = device_id;
          if (typeof window.fridaySetStatus === 'function') {
            window.fridaySetStatus('SPOTIFY READY', 'Audio engine online');
          }
        });

        player.addListener('not_ready', ({ device_id }) => {
          console.warn('[FRIDAY Spotify] Device ID went offline:', device_id);
          if (typeof window.fridaySetStatus === 'function') {
            window.fridaySetStatus('SPOTIFY OFFLINE', 'Reconnecting...');
          }
          setTimeout(initSpotifyPlayer, 5000);
        });

        player.addListener('player_state_changed', state => {
          if (!state) {
            hideSpotifyWidget();
          } else {
            updateSpotifyWidget(state);
          }
        });

        player.addListener('initialization_error', ({ message }) => {
          console.error('[FRIDAY Spotify] Initialization Error:', message);
          if (typeof window.fridaySetStatus === 'function') {
            window.fridaySetStatus('SPOTIFY INIT ERROR', message);
          }
        });

        player.addListener('authentication_error', async ({ message }) => {
          console.error('[FRIDAY Spotify] Authentication Error:', message);
          if (typeof window.fridaySetStatus === 'function') {
            window.fridaySetStatus('SPOTIFY AUTH ERROR', 'Refreshing token...');
          }
          setTimeout(initSpotifyPlayer, 2000);
        });

        player.addListener('account_error', ({ message }) => {
          console.error('[FRIDAY Spotify] Account Error:', message);
        });

        player.addListener('playback_error', ({ message }) => {
          console.error('[FRIDAY Spotify] Playback Error:', message);
        });

        // 6. Connect Player
        await player.connect();

        // 7. Store player on window
        window.fridayPlayer = player;

        // 8. Start progress ticker
        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(updateProgress, 500);

      } catch (err) {
        console.error("[FRIDAY Spotify] error during SDK setup:", err);
      }
    };

    // Wire HUD widget listeners after dynamic load
    wireHudListeners();

  } catch (err) {
    console.error("[FRIDAY Spotify] initSpotifyPlayer failed:", err);
  }
}

/**
 * Binds control buttons on the premium HUD widget to their actions
 */
function wireHudListeners() {
  const prevHud = document.getElementById('sp-prev-hud');
  const playPauseHud = document.getElementById('sp-playpause-hud');
  const nextHud = document.getElementById('sp-next-hud');

  if (prevHud) prevHud.onclick = () => spotifyCommand('previous');
  if (playPauseHud) playPauseHud.onclick = () => window.fridayPlayer?.togglePlay();
  if (nextHud) nextHud.onclick = () => spotifyCommand('next');
}

export function updateSpotifyWidget(state) {
  try {
    const currentTrack = state.track_window.current_track;
    if (!currentTrack) {
      hideSpotifyWidget();
      return;
    }

    const trackName = currentTrack.name;
    const artistName = currentTrack.artists.map(a => a.name).join(', ');
    const albumArtUrl = currentTrack.album.images[0]?.url || '';
    const isPaused = state.paused;
    const position = state.position;
    const duration = state.duration;

    // --- Update Widget 1: Old #spotify-widget ---
    const trackEl = document.getElementById('sp-track-name');
    const artistEl = document.getElementById('sp-artist-name');
    const artEl = document.getElementById('sp-album-art');
    const playPauseBtn = document.getElementById('sp-play-pause');
    const widgetEl = document.getElementById('spotify-widget');

    if (trackEl) trackEl.innerText = trackName;
    if (artistEl) artistEl.innerText = artistName;
    if (artEl) artEl.src = albumArtUrl;
    if (playPauseBtn) {
      playPauseBtn.innerText = isPaused ? '▶' : '⏸';
    }
    if (widgetEl) widgetEl.classList.add('active');

    // --- Update Widget 2: New HUD #sp-widget ---
    const hudTrackEl = document.getElementById('sp-track');
    const hudArtistEl = document.getElementById('sp-artist');
    const hudArtEl = document.getElementById('sp-art');
    const hudPlayPauseBtn = document.getElementById('sp-playpause-hud');
    const hudWidgetEl = document.getElementById('sp-widget');
    const hudTotalEl = document.getElementById('sp-total');

    if (hudTrackEl) hudTrackEl.innerText = trackName;
    if (hudArtistEl) hudArtistEl.innerText = artistName;
    if (hudArtEl) hudArtEl.src = albumArtUrl;
    if (hudPlayPauseBtn) {
      hudPlayPauseBtn.innerText = isPaused ? '▶' : '⏸';
    }
    if (hudTotalEl) hudTotalEl.innerText = formatTime(duration);
    if (hudWidgetEl) hudWidgetEl.classList.add('sp-active');

    // Update HUD System status readout
    if (typeof window.fridaySetStatus === 'function') {
      window.fridaySetStatus(trackName, artistName);
    }

    // Store state on window for intervals
    window.fridayCurrentDuration = duration;
    window.fridayCurrentPosition = position;
    window.fridayIsPlaying = !isPaused;

    // Sync reactor visual orb state
    if (typeof window.fridaySetState === 'function') {
      window.fridaySetState(isPaused ? 'idle' : 'speaking');
    }
  } catch (err) {
    console.error("[FRIDAY Spotify] updateSpotifyWidget failed:", err);
  }
}

export function hideSpotifyWidget() {
  try {
    // Hide standard widget
    const widgetEl = document.getElementById('spotify-widget');
    if (widgetEl) widgetEl.classList.remove('active');

    // Hide premium HUD widget
    const hudWidgetEl = document.getElementById('sp-widget');
    if (hudWidgetEl) hudWidgetEl.classList.remove('sp-active');
    
    window.fridayIsPlaying = false;

    if (typeof window.fridaySetState === 'function') {
      window.fridaySetState('idle');
    }
    if (typeof window.fridaySetStatus === 'function') {
      window.fridaySetStatus('IDLE', 'Standing by');
    }
  } catch (err) {
    console.error("[FRIDAY Spotify] hideSpotifyWidget failed:", err);
  }
}

export function updateProgress() {
  try {
    if (!window.fridayIsPlaying) return;
    if (window.fridayCurrentPosition === undefined || window.fridayCurrentDuration === undefined) return;

    window.fridayCurrentPosition += 500;
    const percent = Math.min((window.fridayCurrentPosition / window.fridayCurrentDuration) * 100, 100);

    // Update old widget progress
    const fillEl = document.querySelector('.sp-progress-fill');
    if (fillEl) {
      fillEl.style.width = percent + '%';
    }

    // Update new HUD widget progress
    const hudFillEl = document.getElementById('sp-fill');
    const hudElapsedEl = document.getElementById('sp-elapsed');
    if (hudFillEl) {
      hudFillEl.style.width = percent + '%';
    }
    if (hudElapsedEl) {
      hudElapsedEl.innerText = formatTime(window.fridayCurrentPosition);
    }
  } catch (err) {
    console.error("[FRIDAY Spotify] updateProgress failed:", err);
  }
}

export async function spotifyCommand(action, params = {}) {
  try {
    console.log(`[FRIDAY Spotify] Dispatching command: ${action}`, params);
    let path = `/spotify/${action}`;
    let method = 'POST';
    let headers = { 'Content-Type': 'application/json' };
    let body = null;

    if (action === 'search') {
      method = 'GET';
      path = `/spotify/search?q=${encodeURIComponent(params.query)}`;
    } else if (action === 'play') {
      body = JSON.stringify({ uri: params.uri, device_id: window.fridayDeviceId });
    } else if (action === 'volume') {
      body = JSON.stringify({ volume_percent: params.volume_percent });
    } else {
      // pause, next, previous
      body = JSON.stringify({});
    }

    const options = { method, headers };
    if (body) options.body = body;

    const res = await fetchFromBackend(path, options);
    if (!res.ok) throw new Error(`Spotify API replied with code ${res.status}`);
    
    if (action === 'search') {
      const data = await res.json();
      return data;
    }
    return true;
  } catch (err) {
    console.error(`[FRIDAY Spotify] spotifyCommand ${action} failed:`, err);
    return null;
  }
}
