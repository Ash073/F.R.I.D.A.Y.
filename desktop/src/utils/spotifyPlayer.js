// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\desktop\src\utils\spotifyPlayer.js

const CLOUD_URL = window.FRIDAY_CLOUD_URL || 'https://f-r-i-d-a-y-8ixf.onrender.com';

let progressInterval = null;

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
        
        // 3. Fetch token: GET ${CLOUD_URL}/spotify/token
        const tokenRes = await fetch(`${CLOUD_URL}/spotify/token`);
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
          // Try to refresh token and re-init player
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
  } catch (err) {
    console.error("[FRIDAY Spotify] initSpotifyPlayer failed:", err);
  }
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

    // Update HTML
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

    // Show widget
    if (widgetEl) widgetEl.classList.add('active');

    // Update HUD
    if (typeof window.fridaySetStatus === 'function') {
      window.fridaySetStatus(trackName, artistName);
    }

    // Store state on window
    window.fridayCurrentDuration = duration;
    window.fridayCurrentPosition = position;
    window.fridayIsPlaying = !isPaused;

    // Reactor Core pulse state integration
    if (typeof window.fridaySetState === 'function') {
      window.fridaySetState(isPaused ? 'idle' : 'speaking');
    }
  } catch (err) {
    console.error("[FRIDAY Spotify] updateSpotifyWidget failed:", err);
  }
}

export function hideSpotifyWidget() {
  try {
    const widgetEl = document.getElementById('spotify-widget');
    if (widgetEl) widgetEl.classList.remove('active');
    
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

    const fillEl = document.querySelector('.sp-progress-fill');
    if (fillEl) {
      fillEl.style.width = percent + '%';
    }
  } catch (err) {
    console.error("[FRIDAY Spotify] updateProgress failed:", err);
  }
}

export async function spotifyCommand(action, params = {}) {
  try {
    console.log(`[FRIDAY Spotify] Dispatching command: ${action}`, params);
    let url = `${CLOUD_URL}/spotify/${action}`;
    let method = 'POST';
    let headers = { 'Content-Type': 'application/json' };
    let body = null;

    if (action === 'search') {
      method = 'GET';
      url = `${CLOUD_URL}/spotify/search?q=${encodeURIComponent(params.query)}`;
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

    const res = await fetch(url, options);
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
