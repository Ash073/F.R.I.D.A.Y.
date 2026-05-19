/**
 * F.R.I.D.A.Y. Hybrid Smart Routing Fetch Utility
 * Dual-route client pipeline with automatic failure recovery fallbacks.
 */

let LOCAL = 'http://localhost:3131'; // Defaults to 3131, dynamically scans 8888 too
const CLOUD = (typeof window !== 'undefined' && window.FRIDAY_CLOUD_URL) || 'https://f-r-i-d-a-y-8ixf.onrender.com';
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
    console.log(`[FRIDAY-ROUTER] ✓ Local backend responded successfully on ${LOCAL}.`);
    return response;
  } catch (err) {
    console.warn(`[FRIDAY-ROUTER] Local backend unavailable on ${LOCAL}. Falling back to CLOUD...`, err.message);
    const url = `${CLOUD}${targetPath}`;
    console.log(`[FRIDAY-ROUTER] Fallback cloud routing: ${url}`);
    return await fetch(url, options);
  }
}

/**
 * Verifies local server edge state status with dynamic port discovery (scans 3131 & 8888)
 */
async function checkLocalHealth() {
  const ports = ['3131', '8888'];
  for (const port of ports) {
    const testUrl = `http://localhost:${port}`;
    try {
      const response = await fetchWithTimeout(`${testUrl}/health`, { method: 'GET' }, 1000);
      const data = await response.json();
      if (data && data.status === 'ok') {
        LOCAL = testUrl;
        if (typeof window !== 'undefined') {
          window.FRIDAY_LOCAL_ONLINE = true;
        }
        console.log(`[FRIDAY-HEALTH] Dynamic local edge detected ONLINE on port ${port}!`);
        return true;
      }
    } catch (err) {
      // Continue to next port
    }
  }
  
  // If offline on both, default back to 3131 but flag local as offline
  if (typeof window !== 'undefined') {
    window.FRIDAY_LOCAL_ONLINE = false;
  }
  console.warn(`[FRIDAY-HEALTH] Local Edge is OFFLINE (checked 3131 and 8888)`);
  return false;
}

// Bind to window for global script accessibility in desktop overlay
if (typeof window !== 'undefined') {
  window.fridayFetch = fridayFetch;
  window.checkLocalHealth = checkLocalHealth;
}

// Export for ESM systems (Vite dashboard components)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fridayFetch, checkLocalHealth };
} else if (typeof exports !== 'undefined') {
  exports.fridayFetch = fridayFetch;
  exports.checkLocalHealth = checkLocalHealth;
}
