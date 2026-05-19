// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\desktop\src\utils\fridayFetch.js
/**
 * F.R.I.D.A.Y. Hybrid Smart Routing Fetch Utility
 * Dual-route client pipeline with automatic failure recovery fallbacks.
 */

const LOCAL = 'http://localhost:8888';
// Read from configured environment variable, custom window tags, or the Render production endpoint
const CLOUD = window.FRIDAY_CLOUD_URL || 'https://f-r-i-d-a-y-8ixf.onrender.com';
const cloudOnlyFeatures = ['spotify', 'mobile'];

/**
 * Fetch wrapper with built-in millisecond timeout limit
 */
async function fetchWithTimeout(resource, options = {}, timeoutMs = 2000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

/**
 * Smart router executing local-first fallback queries
 */
async function fridayFetch(feature, path, options = {}) {
  const isCloudOnly = cloudOnlyFeatures.includes(feature);
  const targetPath = path.startsWith('/') ? path : `/${path}`;

  if (isCloudOnly) {
    const url = `${CLOUD}${targetPath}`;
    console.log(`[FRIDAY-ROUTER] Cloud-Only Route: ${url}`);
    return await fetch(url, options);
  }

  // Try LOCAL first with 2000ms timeout
  try {
    const url = `${LOCAL}${targetPath}`;
    console.log(`[FRIDAY-ROUTER] Routing local (2s limit): ${url}`);
    const response = await fetchWithTimeout(url, options, 2000);
    console.log(`[FRIDAY-ROUTER] ✓ Local backend responded successfully.`);
    return response;
  } catch (err) {
    console.warn(`[FRIDAY-ROUTER] Local backend unavailable or timed out. Falling back to CLOUD...`, err.message);
    const url = `${CLOUD}${targetPath}`;
    console.log(`[FRIDAY-ROUTER] Fallback cloud routing: ${url}`);
    return await fetch(url, options);
  }
}

/**
 * Verifies local server edge state status
 */
async function checkLocalHealth() {
  try {
    const response = await fetchWithTimeout(`${LOCAL}/health`, { method: 'GET' }, 1500);
    const data = await response.json();
    const isOnline = data && data.status === 'ok';
    window.FRIDAY_LOCAL_ONLINE = isOnline;
    console.log(`[FRIDAY-HEALTH] Local Edge Status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
    return isOnline;
  } catch (err) {
    window.FRIDAY_LOCAL_ONLINE = false;
    console.warn(`[FRIDAY-HEALTH] Local Edge Edge is OFFLINE:`, err.message);
    return false;
  }
}

// Bind to window for global script accessibility in desktop overlay
window.fridayFetch = fridayFetch;
window.checkLocalHealth = checkLocalHealth;

// Export for ESM systems (Vite dashboard components)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fridayFetch, checkLocalHealth };
} else if (typeof exports !== 'undefined') {
  exports.fridayFetch = fridayFetch;
  exports.checkLocalHealth = checkLocalHealth;
}
