// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\spotify.js
/**
 * Spotify Integration Service Router
 * Handles Spotify OAuth 2.0 flow, token state, and playback controls.
 */

const express = require("express");
const router = express.Router();

let accessToken = "";
let refreshToken = "";
let tokenExpirationTime = 0;

// Helper to check if credentials are loaded
function getSpotifyCreds() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  return { clientId, clientSecret, redirectUri };
}

// Automatic token refresh loop
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
  } catch (err) {
    console.error("[SPOTIFY] ✗ Failed to refresh access token:", err.message);
  }
}

// Check and trigger refresh every 40 minutes if active
setInterval(() => {
  if (refreshToken) {
    refreshSpotifyToken();
  }
}, 40 * 60 * 1000);


// ── ROUTE HANDLERS ──

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

  const authUrl = `https://accounts.spotify.com/authorize?` + new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri
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

    console.log("[SPOTIFY] ✓ Client authenticated successfully. Tokens loaded.");
    res.send("<h1>Authentication Successful!</h1><p>You can close this tab and go back to F.R.I.D.A.Y.</p>");
  } catch (err) {
    console.error("[SPOTIFY] Auth exchange failed:", err.message);
    res.status(500).send(`Authentication failed: ${err.message}`);
  }
});

// 3. Retrieve Client Web Access Token
router.get("/token", (req, res) => {
  if (!accessToken) {
    return res.status(401).json({ error: "Access token is not active. Please authenticate via /spotify/login." });
  }
  res.json({ token: accessToken });
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

// 5. Trigger Web Player Device Playback
router.post("/play", async (req, res) => {
  const { uri, device_id } = req.body;
  if (!accessToken) return res.status(401).json({ error: "Spotify unauthorized" });

  try {
    const playUrl = `https://api.spotify.com/v1/me/player/play` + (device_id ? `?device_id=${device_id}` : "");
    const body = uri ? JSON.stringify({ uris: [uri] }) : null;

    const response = await fetch(playUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body
    });

    if (response.status === 204 || response.status === 200) {
      res.json({ ok: true });
    } else {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || "Failed to trigger playback.");
    }
  } catch (err) {
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
        albumArt: data.item.album?.images?.[0]?.url || ""
      });
    } else {
      res.json({ playing: false, message: "No track currently playing." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
