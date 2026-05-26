// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\spotify.js
/**
 * Spotify Integration Service Router
 * Handles Spotify OAuth 2.0 flow, token state, and playback controls.
 * 
 * ARCHITECTURE:
 * - If local Spotify credentials (CLIENT_ID/SECRET) are configured, the full
 *   OAuth flow runs locally.
 * - If they are NOT configured, the backend syncs the access token from the
 *   cloud production server on startup and periodically. All Spotify API calls
 *   (search, play, pause, etc.) are then made LOCALLY using the synced token.
 *   This ensures device_id from the Electron Web Playback SDK works correctly
 *   and that launching the desktop Spotify app via shell also works.
 * - Only the /login route redirects to the cloud for authentication.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

let accessToken = "";
let refreshToken = "";
let tokenExpirationTime = 0;

// ── PERSISTENT TOKEN STORAGE ─────────────────────────────────────────
// Save tokens to disk so they survive server restarts (no re-login needed!)
const TOKEN_FILE = path.join(__dirname, ".spotify_tokens.json");

function saveTokensToDisk() {
  try {
    const data = { accessToken, refreshToken, tokenExpirationTime };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), "utf8");
    console.log("[SPOTIFY] ✓ Tokens persisted to disk.");
  } catch (err) {
    console.warn("[SPOTIFY] Could not persist tokens:", err.message);
  }
}

function loadTokensFromDisk() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const raw = fs.readFileSync(TOKEN_FILE, "utf8");
      const data = JSON.parse(raw);
      if (data.accessToken || data.refreshToken) {
        accessToken = data.accessToken || "";
        refreshToken = data.refreshToken || "";
        tokenExpirationTime = data.tokenExpirationTime || 0;
        console.log("[SPOTIFY] ✓ Loaded saved tokens from disk.");
        return true;
      }
    }
  } catch (err) {
    console.warn("[SPOTIFY] Could not load saved tokens:", err.message);
  }
  return false;
}

// Helper to check if credentials are loaded
function getSpotifyCreds() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  return { clientId, clientSecret, redirectUri };
}

function hasLocalCreds() {
  const { clientId, clientSecret } = getSpotifyCreds();
  return !!(clientId && clientSecret);
}

// ── CLOUD TOKEN SYNC ──────────────────────────────────────────────────
// When no local Spotify credentials are configured, fetch and cache
// the access token from the cloud server so all API calls run locally.

const CLOUD_URL = process.env.CLOUD_URL || 'https://f-r-i-d-a-y-8ixf.onrender.com';

async function syncTokenFromCloud() {
  if (hasLocalCreds()) return; // Not needed if we have our own credentials

  try {
    console.log("[SPOTIFY SYNC] Fetching tokens from cloud server...");

    // First, try to get full token set (access + refresh) from cloud
    try {
      const fullRes = await fetch(`${CLOUD_URL}/spotify/full-token`, {
        signal: AbortSignal.timeout(10000)
      });
      if (fullRes.ok) {
        const fullData = await fullRes.json();
        if (fullData.token && fullData.refreshToken) {
          accessToken = fullData.token;
          refreshToken = fullData.refreshToken;
          tokenExpirationTime = Date.now() + 50 * 60 * 1000;
          saveTokensToDisk();
          console.log("[SPOTIFY SYNC] ✓ Full token set (access + refresh) synced from cloud. Auto-refresh enabled!");
          return;
        }
      }
    } catch { /* Fall through to basic sync */ }

    // Fallback: basic access token only
    const res = await fetch(`${CLOUD_URL}/spotify/token`, {
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.warn(`[SPOTIFY SYNC] Cloud returned ${res.status}: ${errData.error || 'unknown'}`);
      return;
    }

    const data = await res.json();
    if (data.token) {
      accessToken = data.token;
      // Cloud tokens last 1 hour; set local expiration to 50 minutes to re-sync early
      tokenExpirationTime = Date.now() + 50 * 60 * 1000;
      saveTokensToDisk();
      console.log("[SPOTIFY SYNC] ✓ Access token synced from cloud (no refresh token — will need re-sync).");
    } else {
      console.warn("[SPOTIFY SYNC] Cloud returned no token. User may not be logged in.");
    }
  } catch (err) {
    console.error("[SPOTIFY SYNC] ✗ Failed to sync token from cloud:", err.message);
  }
}

// Proxy refresh: send our saved refresh token to the cloud server to get a new access token
// This works even without local Spotify credentials
async function proxyRefreshViaCloud() {
  if (!refreshToken) return false;
  try {
    console.log("[SPOTIFY] Attempting cloud-proxy token refresh...");
    const res = await fetch(`${CLOUD_URL}/spotify/proxy-refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(10000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.access_token) {
        accessToken = data.access_token;
        tokenExpirationTime = Date.now() + ((data.expires_in || 3600) * 1000);
        if (data.refresh_token) refreshToken = data.refresh_token;
        saveTokensToDisk();
        console.log("[SPOTIFY] ✓ Token refreshed via cloud proxy. Auto-refresh working!");
        return true;
      }
    }
  } catch (err) {
    console.warn("[SPOTIFY] Cloud-proxy refresh failed:", err.message);
  }
  return false;
}

// On startup: load saved tokens from disk first, then refresh or sync
setTimeout(async () => {
  const hasSavedTokens = loadTokensFromDisk();
  if (hasSavedTokens && refreshToken && hasLocalCreds()) {
    // We have saved tokens AND local credentials — refresh immediately
    console.log("[SPOTIFY] Refreshing persisted token on startup...");
    await refreshSpotifyToken();
  } else if (hasSavedTokens && refreshToken && !hasLocalCreds()) {
    // Have refresh token but no local creds — try cloud proxy refresh first
    if (Date.now() < tokenExpirationTime) {
      console.log("[SPOTIFY] ✓ Saved access token is still valid.");
    } else {
      console.log("[SPOTIFY] Saved access token expired. Trying proxy refresh...");
      const refreshed = await proxyRefreshViaCloud();
      if (!refreshed) {
        console.log("[SPOTIFY] Proxy refresh failed. Falling back to cloud sync...");
        await syncTokenFromCloud();
      }
    }
  } else if (hasSavedTokens && accessToken && Date.now() < tokenExpirationTime) {
    // Have a valid access token on disk, no refresh token — use it
    console.log("[SPOTIFY] ✓ Saved access token still valid (no refresh token).");
  } else {
    // No saved tokens — sync from cloud
    await syncTokenFromCloud();
  }
}, 2000);

// Re-sync every 45 minutes (tokens expire after 60 minutes)
setInterval(async () => {
  if (hasLocalCreds()) return; // Local creds handle their own refresh
  // Try proxy refresh first (if we have a refresh token saved)
  if (refreshToken) {
    const ok = await proxyRefreshViaCloud();
    if (ok) return;
  }
  // Fallback to basic cloud sync
  await syncTokenFromCloud();
}, 45 * 60 * 1000);


// ── LOCAL TOKEN REFRESH ───────────────────────────────────────────────
// Only used when local Spotify credentials are configured.

async function refreshSpotifyToken() {
  const { clientId, clientSecret } = getSpotifyCreds();
  if (!refreshToken || !clientId || !clientSecret) {
    console.log("[SPOTIFY] Skip token refresh: missing token or client credentials.");
    return;
  }

  console.log("[SPOTIFY] Initiating access token refresh...");
  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    accessToken = data.access_token;
    tokenExpirationTime = Date.now() + (data.expires_in * 1000);
    if (data.refresh_token) refreshToken = data.refresh_token;

    console.log("[SPOTIFY] ✓ Access token refreshed successfully.");
    saveTokensToDisk();
  } catch (err) {
    console.error("[SPOTIFY] ✗ Failed to refresh access token:", err.message);
  }
}

// Check and trigger refresh every 40 minutes if active (local creds mode)
setInterval(() => {
  if (refreshToken && hasLocalCreds()) {
    refreshSpotifyToken();
  }
}, 40 * 60 * 1000);


// ── MIDDLEWARE: Auto-sync if token is expired ──────────────────────────
// Before any route handler runs, check if we need to re-sync the token.
router.use(async (req, res, next) => {
  // For /login, just redirect to cloud if no local creds
  if (req.path === '/login' && !hasLocalCreds()) {
    console.log(`[SPOTIFY] Redirecting login to cloud: ${CLOUD_URL}/spotify/login`);
    return res.redirect(`${CLOUD_URL}/spotify/login`);
  }

  // For /callback, redirect to cloud if no local creds
  if (req.path === '/callback' && !hasLocalCreds()) {
    const queryStr = new URLSearchParams(req.query).toString();
    return res.redirect(`${CLOUD_URL}/spotify/callback?${queryStr}`);
  }

  // If token is expired or missing, try to recover
  if (!accessToken || Date.now() >= tokenExpirationTime) {
    if (hasLocalCreds() && refreshToken) {
      await refreshSpotifyToken();
    } else if (refreshToken) {
      // Try proxy refresh with saved refresh token first
      const ok = await proxyRefreshViaCloud();
      if (!ok) await syncTokenFromCloud();
    } else if (!hasLocalCreds()) {
      await syncTokenFromCloud();
    }
  }

  next();
});


// ── ROUTE HANDLERS ──────────────────────────────────────────────────

// Debug endpoint to safely inspect env configurations
router.get("/debug", (req, res) => {
  const { clientId, redirectUri } = getSpotifyCreds();
  res.json({
    clientId: clientId ? `${clientId.substring(0, 5)}...` : "missing (cloud-sync mode)",
    redirectUri: redirectUri || "using cloud",
    hasToken: !!accessToken,
    tokenExpires: tokenExpirationTime ? new Date(tokenExpirationTime).toISOString() : "never",
    mode: hasLocalCreds() ? "local" : "cloud-sync"
  });
});

// 1. Redirect to Spotify Authorization
router.get("/login", (req, res) => {
  const { clientId, redirectUri } = getSpotifyCreds();
  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: "Spotify credentials are not configured on the server." });
  }

  const scopes = [
    "streaming",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing"
  ].join(" ");

  // Don't force show_dialog — allows Spotify to skip login if already authenticated
  const authUrl = `https://accounts.spotify.com/authorize?` + new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
  }).toString();

  res.redirect(authUrl);
});

// 2. OAuth Callback Interface
router.get("/callback", async (req, res) => {
  const { code } = req.query;
  const { clientId, clientSecret, redirectUri } = getSpotifyCreds();

  if (!code) {
    return res.status(400).send("Authorization code is missing.");
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", redirectUri);

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    tokenExpirationTime = Date.now() + (data.expires_in * 1000);
    saveTokensToDisk();

    console.log("[SPOTIFY] ✓ Client authenticated successfully. Tokens loaded.");
    
    // Relay tokens to the user's local FRIDAY instance via browser-side fetch
    // This is the KEY to persistent auth: the cloud callback page (in the user's browser)
    // sends tokens to localhost, where they're saved forever.
    const tokenPayload = JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in
    }).replace(/</g, '\\u003c');

    res.send(`<!DOCTYPE html>
<html><head><title>F.R.I.D.A.Y. — Spotify Connected</title>
<style>
  body { background: #0d0000; color: #ff8c00; font-family: 'Courier New', monospace; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; border: 1px solid #ff8c0033; padding: 40px 60px; border-radius: 12px; background: rgba(0,0,0,0.8); box-shadow: 0 0 30px #ff8c0011; }
  h1 { font-size: 14px; letter-spacing: 0.3em; text-transform: uppercase; margin-bottom: 12px; }
  p { font-size: 11px; opacity: 0.6; letter-spacing: 0.1em; }
  #status { font-size: 10px; margin-top: 10px; opacity: 0.8; }
  .bar { width: 100%; height: 2px; background: linear-gradient(90deg, transparent, #ff8c00, transparent); margin-top: 20px; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
</style></head><body>
<div class="card">
  <h1>✓ Spotify Linked</h1>
  <p>Authentication successful.</p>
  <p id="status">Syncing tokens to local FRIDAY...</p>
  <div class="bar"></div>
</div>
<script>
  // Relay tokens to local FRIDAY instance
  const payload = ${tokenPayload};
  const tryLocal = async () => {
    let synced = false;
    const ports = ['8888', '3131'];
    for (const port of ports) {
      try {
        const res = await fetch('http://localhost:' + port + '/spotify/save-tokens', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          synced = true;
          document.getElementById('status').innerText = '✓ Tokens synced to local FRIDAY! Closing...';
          document.getElementById('status').style.color = '#1DB954';
          break;
        }
      } catch(e) {
        // Try next port
      }
    }
    if (!synced) {
      document.getElementById('status').innerText = '✓ Authenticated. Close this tab and return to FRIDAY.';
    }
    setTimeout(() => window.close(), 2500);
  };
  tryLocal();
</script>
</body></html>`);
  } catch (err) {
    console.error("[SPOTIFY] Auth exchange failed:", err.message);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// 3. Retrieve Client Web Access Token
// 3a. Token Status — detailed health check for HUD display
router.get("/status", async (req, res) => {
  const now = Date.now();
  const hasToken = !!accessToken;
  const expiresAt = tokenExpirationTime;
  const remainingMs = Math.max(0, expiresAt - now);
  const remainingMin = Math.round(remainingMs / 60000);
  const localExpired = now >= expiresAt;

  // If token looks expired locally, try to refresh before reporting
  if (hasToken && localExpired) {
    console.log("[SPOTIFY STATUS] Token appears expired locally. Attempting auto-refresh...");
    if (hasLocalCreds() && refreshToken) {
      await refreshSpotifyToken();
    } else {
      await syncTokenFromCloud();
    }
    // Re-check after refresh attempt
    const refreshedRemaining = Math.max(0, tokenExpirationTime - Date.now());
    if (refreshedRemaining > 0) {
      return res.json({
        status: "ACTIVE",
        hasToken: true,
        verified: true,
        remainingMin: Math.round(refreshedRemaining / 60000),
        expiresAt: new Date(tokenExpirationTime).toISOString(),
        message: "Token was expired but auto-refreshed successfully",
        autoRefreshed: true
      });
    }
  }

  // Verify token is actually working by making a lightweight Spotify API call
  let verified = false;
  if (hasToken && !localExpired) {
    try {
      const checkRes = await fetch("https://api.spotify.com/v1/me", {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      verified = checkRes.ok;
      if (!verified && checkRes.status === 401) {
        // Token is invalid despite local timestamp — try refresh
        console.log("[SPOTIFY STATUS] Token rejected by Spotify (401). Auto-refreshing...");
        if (hasLocalCreds() && refreshToken) {
          await refreshSpotifyToken();
        } else {
          await syncTokenFromCloud();
        }
        const refreshedRemaining = Math.max(0, tokenExpirationTime - Date.now());
        verified = refreshedRemaining > 0;
      }
    } catch {
      // Network error — can't verify but token may still be valid
      verified = true; // Assume valid if we can't reach Spotify
    }
  }

  const finalRemaining = Math.max(0, tokenExpirationTime - Date.now());
  let status = "OFFLINE";
  if (!hasToken && !accessToken) status = "NO_TOKEN";
  else if (verified || finalRemaining > 0) status = "ACTIVE";
  else status = "EXPIRED";

  res.json({
    status,
    hasToken: !!accessToken,
    verified,
    remainingMin: Math.round(finalRemaining / 60000),
    expiresAt: tokenExpirationTime ? new Date(tokenExpirationTime).toISOString() : null,
    mode: hasLocalCreds() ? "local" : "cloud-sync",
    message: status === "ACTIVE" 
      ? `Token valid for ~${Math.round(finalRemaining / 60000)} minutes`
      : status === "EXPIRED" ? "Token expired. Re-authenticate via /spotify/login"
      : "No Spotify token available",
    autoRefreshed: false
  });
});

// 3b. Get Current Token
router.get("/token", async (req, res) => {
  // If no token, try one more sync attempt
  if (!accessToken && !hasLocalCreds()) {
    await syncTokenFromCloud();
  }
  if (!accessToken) {
    return res.status(401).json({ error: "Access token is not active. Please authenticate via /spotify/login." });
  }
  res.json({ token: accessToken });
});

// 3c. Full Token Set (access + refresh) — used by local FRIDAY to sync from cloud
router.get("/full-token", (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: "No active tokens" });
  }
  res.json({
    token: accessToken,
    refreshToken: refreshToken || null,
    expiresAt: tokenExpirationTime ? new Date(tokenExpirationTime).toISOString() : null
  });
});

// 3d. Proxy Refresh — local FRIDAY sends refresh_token, cloud refreshes using its credentials
router.post("/proxy-refresh", async (req, res) => {
  const { refresh_token } = req.body || {};
  const { clientId, clientSecret } = getSpotifyCreds();
  if (!refresh_token) return res.status(400).json({ error: "refresh_token required" });
  if (!clientId || !clientSecret) return res.status(500).json({ error: "No Spotify credentials on this server" });

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refresh_token);

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error_description || data.error);

    // Also update this server's own tokens
    accessToken = data.access_token;
    tokenExpirationTime = Date.now() + (data.expires_in * 1000);
    if (data.refresh_token) refreshToken = data.refresh_token;
    saveTokensToDisk();

    res.json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      refresh_token: data.refresh_token || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3e. Save Tokens — receives tokens relayed from cloud callback via browser
router.post("/save-tokens", (req, res) => {
  const { access_token, refresh_token, expires_in } = req.body || {};
  if (!access_token) return res.status(400).json({ error: "access_token required" });

  accessToken = access_token;
  if (refresh_token) refreshToken = refresh_token;
  tokenExpirationTime = Date.now() + ((expires_in || 3600) * 1000);
  saveTokensToDisk();

  console.log("[SPOTIFY] ✓ Tokens received from cloud callback and saved to disk!");
  console.log(`[SPOTIFY]   Access token: ${accessToken.substring(0, 10)}...`);
  console.log(`[SPOTIFY]   Refresh token: ${refreshToken ? 'YES (auto-refresh enabled!)' : 'NO'}`);
  console.log(`[SPOTIFY]   Expires in: ${expires_in || 3600} seconds`);
  res.json({ success: true, message: "Tokens saved! FRIDAY is now permanently authenticated." });
});

// 4. Search Spotify Catalog
router.get("/search", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "query parameters missing" });
  if (!accessToken) return res.status(401).json({ error: "Spotify unauthorized" });

  try {
    const response = await fetch(`https://api.spotify.com/v1/search?` + new URLSearchParams({
      q,
      type: "track",
      limit: "5"
    }).toString(), {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    const data = await response.json();

    // If token expired, try to re-sync and retry once
    if (data.error && data.error.status === 401) {
      console.log("[SPOTIFY] Token expired during search. Re-syncing...");
      if (hasLocalCreds()) {
        await refreshSpotifyToken();
      } else {
        await syncTokenFromCloud();
      }
      
      // Retry the search
      const retryRes = await fetch(`https://api.spotify.com/v1/search?` + new URLSearchParams({
        q, type: "track", limit: "5"
      }).toString(), {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      const retryData = await retryRes.json();
      if (!retryData.tracks || !retryData.tracks.items) {
        throw new Error(retryData.error?.message || "Search query returned empty after token refresh.");
      }
      const formatted = retryData.tracks.items.map(t => ({
        name: t.name,
        artist: t.artists.map(a => a.name).join(", "),
        uri: t.uri,
        albumArt: t.album?.images?.[0]?.url || ""
      }));
      return res.json(formatted);
    }

    if (!data.tracks || !data.tracks.items) {
      throw new Error(data.error?.message || "Search query returned empty.");
    }

    const formatted = data.tracks.items.map(t => ({
      name: t.name,
      artist: t.artists.map(a => a.name).join(", "),
      uri: t.uri,
      albumArt: t.album?.images?.[0]?.url || ""
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Trigger Playback — the most critical endpoint
router.post("/play", async (req, res) => {
  const { uri, device_id } = req.body;
  if (!accessToken) return res.status(401).json({ error: "Spotify unauthorized" });

  try {
    let targetDeviceId = device_id;

    // ALWAYS log what we received
    console.log(`[SPOTIFY PLAY] Received request — URI: ${uri}, device_id: ${device_id || 'none'}`);

    // Step 1: Query available devices
    console.log("[SPOTIFY PLAY] Querying Spotify Connect devices...");
    let devicesRes = await fetch("https://api.spotify.com/v1/me/player/devices", {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    let devices = [];
    if (devicesRes.ok) {
      const devicesData = await devicesRes.json().catch(() => ({}));
      devices = devicesData.devices || [];
      console.log(`[SPOTIFY PLAY] Detected ${devices.length} device(s):`, devices.map(d => `"${d.name}" (${d.type}, active=${d.is_active}, id=${d.id.substring(0,8)}...)`));
    } else {
      console.warn(`[SPOTIFY PLAY] Device query failed with status ${devicesRes.status}`);
    }

    // Step 2: Decide which device to target
    if (targetDeviceId) {
      // Frontend provided a device_id (from Web Playback SDK) — verify it exists
      const sdkDeviceExists = devices.some(d => d.id === targetDeviceId);
      if (sdkDeviceExists) {
        console.log(`[SPOTIFY PLAY] ✓ Using provided SDK device_id: ${targetDeviceId.substring(0,8)}...`);
      } else if (devices.length > 0) {
        // The provided device_id isn't in the list — it may have disconnected.
        // Fall back to an available device.
        console.warn(`[SPOTIFY PLAY] Provided device_id not found in device list. Falling back...`);
        const activeDevice = devices.find(d => d.is_active);
        const computerDevice = devices.find(d => d.type.toLowerCase() === "computer");
        const fridayDevice = devices.find(d => d.name === "FRIDAY System" || d.name === "F.R.I.D.A.Y. Player");
        const fallback = activeDevice || computerDevice || fridayDevice || devices[0];
        targetDeviceId = fallback.id;
        console.log(`[SPOTIFY PLAY] Using fallback device: "${fallback.name}" (${fallback.type})`);
      } else {
        // No devices at all but we have a provided ID — try it anyway (SDK may not be listed yet)
        console.log(`[SPOTIFY PLAY] No devices listed, but using provided device_id anyway: ${targetDeviceId.substring(0,8)}...`);
      }
    } else {
      // No device_id provided — need to discover one
      if (devices.length > 0) {
        const activeDevice = devices.find(d => d.is_active);
        if (activeDevice) {
          targetDeviceId = activeDevice.id;
          console.log(`[SPOTIFY PLAY] Using active device: "${activeDevice.name}"`);
        } else {
          const computerDevice = devices.find(d => d.type.toLowerCase() === "computer");
          const fridayDevice = devices.find(d => d.name === "FRIDAY System" || d.name === "F.R.I.D.A.Y. Player");
          const fallback = computerDevice || fridayDevice || devices[0];
          targetDeviceId = fallback.id;
          console.log(`[SPOTIFY PLAY] Transferring to inactive device: "${fallback.name}"`);

          // Transfer playback to this device first
          await fetch("https://api.spotify.com/v1/me/player", {
            method: "PUT",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ device_ids: [targetDeviceId], play: false })
          }).catch(err => console.warn("[SPOTIFY PLAY] Transfer warning:", err.message));
          await new Promise(r => setTimeout(r, 800));
        }
      } else {
        // No devices online AT ALL. Try to launch the Spotify desktop client.
        console.log("[SPOTIFY PLAY] No devices online. Launching Spotify Desktop client...");
        const { exec } = require("child_process");
        exec("start spotify:", { shell: "cmd.exe" }, (err) => {
          if (err) console.error("[SPOTIFY PLAY] Shell launch error:", err.message);
        });

        // Wait for the desktop client to boot and register
        console.log("[SPOTIFY PLAY] Waiting 4 seconds for Spotify Desktop to register...");
        await new Promise(r => setTimeout(r, 4000));

        // Re-query devices
        devicesRes = await fetch("https://api.spotify.com/v1/me/player/devices", {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });

        if (devicesRes.ok) {
          const retryData = await devicesRes.json().catch(() => ({}));
          const retryDevices = retryData.devices || [];
          console.log(`[SPOTIFY PLAY] Post-launch detected ${retryDevices.length} device(s):`, retryDevices.map(d => `"${d.name}" (${d.type})`));

          if (retryDevices.length > 0) {
            const computerDevice = retryDevices.find(d => d.type.toLowerCase() === "computer") || retryDevices[0];
            targetDeviceId = computerDevice.id;
            console.log(`[SPOTIFY PLAY] ✓ Targeted launched client: "${computerDevice.name}"`);

            await fetch("https://api.spotify.com/v1/me/player", {
              method: "PUT",
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ device_ids: [targetDeviceId], play: false })
            }).catch(() => {});
            await new Promise(r => setTimeout(r, 800));
          } else {
            console.error("[SPOTIFY PLAY] ✗ Desktop client launched but no device registered.");
          }
        }
      }
    }

    // Step 3: Execute playback
    const playUrl = `https://api.spotify.com/v1/me/player/play` + (targetDeviceId ? `?device_id=${targetDeviceId}` : "");
    const body = uri ? JSON.stringify({ uris: [uri] }) : null;

    console.log(`[SPOTIFY PLAY] Sending PUT to Spotify API — device: ${targetDeviceId || 'none'}, uri: ${uri || 'resume'}`);
    const response = await fetch(playUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body
    });

    if (response.status === 204 || response.status === 200) {
      console.log("[SPOTIFY PLAY] ✓ Playback started successfully!");
      res.json({ ok: true });
    } else {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || "Failed to trigger playback.";
      console.error(`[SPOTIFY PLAY] ✗ Spotify API error (${response.status}): ${errMsg}`);

      // If the error is about the device, try one more time without device_id
      if (response.status === 404 && targetDeviceId) {
        console.log("[SPOTIFY PLAY] Retrying without device_id...");
        const retryRes = await fetch("https://api.spotify.com/v1/me/player/play", {
          method: "PUT",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body
        });
        if (retryRes.status === 204 || retryRes.status === 200) {
          console.log("[SPOTIFY PLAY] ✓ Retry without device_id succeeded!");
          return res.json({ ok: true });
        }
        const retryErr = await retryRes.json().catch(() => ({}));
        throw new Error(retryErr.error?.message || errMsg);
      }

      throw new Error(errMsg);
    }
  } catch (err) {
    console.error("[SPOTIFY PLAY] ✗ Exception:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 6. Pause playback
router.post("/pause", async (req, res) => {
  if (!accessToken) return res.status(401).json({ error: "Spotify unauthorized" });
  try {
    const response = await fetch("https://api.spotify.com/v1/me/player/pause", {
      method: "PUT",
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    res.json({ ok: response.status === 204 || response.status === 200 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Skip next
router.post("/next", async (req, res) => {
  if (!accessToken) return res.status(401).json({ error: "Spotify unauthorized" });
  try {
    const response = await fetch("https://api.spotify.com/v1/me/player/next", {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    res.json({ ok: response.status === 204 || response.status === 200 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Skip previous
router.post("/previous", async (req, res) => {
  if (!accessToken) return res.status(401).json({ error: "Spotify unauthorized" });
  try {
    const response = await fetch("https://api.spotify.com/v1/me/player/previous", {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    res.json({ ok: response.status === 204 || response.status === 200 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Volume Control (0-100)
router.post("/volume", async (req, res) => {
  const { volume_percent } = req.body;
  if (volume_percent === undefined) return res.status(400).json({ error: "volume_percent required" });
  if (!accessToken) return res.status(401).json({ error: "Spotify unauthorized" });

  try {
    const response = await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${volume_percent}`, {
      method: "PUT",
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    res.json({ ok: response.status === 204 || response.status === 200 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Fetch current state
router.get("/current", async (req, res) => {
  if (!accessToken) return res.status(401).json({ error: "Spotify unauthorized" });
  try {
    const response = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });

    if (response.status === 204) {
      return res.json({ playing: false, message: "No track currently playing." });
    }

    const data = await response.json();
    if (data.item) {
      res.json({
        playing: data.is_playing,
        trackName: data.item.name,
        artistName: data.item.artists.map(a => a.name).join(", "),
        uri: data.item.uri,
        albumArt: data.item.album?.images?.[0]?.url || "",
        progress_ms: data.progress_ms || 0,
        duration_ms: data.item.duration_ms || 0
      });
    } else {
      res.json({ playing: false, message: "No track currently playing." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.hasLocalCreds = hasLocalCreds;
module.exports = router;
