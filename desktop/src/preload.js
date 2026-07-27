const { contextBridge, ipcRenderer } = require("electron");

// Standalone smart-routing VAD local-first fetch client to bypass sandbox require restrictions
let LOCAL = 'http://localhost:3131';
const CLOUD = 'https://f-r-i-d-a-y-8ixf.onrender.com';
const cloudOnlyFeatures = ['mobile'];

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

async function fridayFetch(feature, path, options = {}) {
  const isCloudOnly = cloudOnlyFeatures.includes(feature);
  const targetPath = path.startsWith('/') ? path : `/${path}`;

  if (isCloudOnly) {
    const url = `${CLOUD}${targetPath}`;
    console.log(`[FRIDAY-PRELOAD-ROUTER] Cloud-Only Route: ${url}`);
    return await fetch(url, options);
  }

  // Try LOCAL first with 2000ms timeout
  try {
    const url = `${LOCAL}${targetPath}`;
    console.log(`[FRIDAY-PRELOAD-ROUTER] Routing local (2s limit): ${url}`);
    const response = await fetchWithTimeout(url, options, 2000);
    return response;
  } catch (err) {
    console.warn(`[FRIDAY-PRELOAD-ROUTER] Local backend unavailable on ${LOCAL}. Falling back to CLOUD...`);
    const url = `${CLOUD}${targetPath}`;
    return await fetch(url, options);
  }
}

async function checkLocalHealth() {
  const ports = ['3131', '8888'];
  for (const port of ports) {
    const testUrl = `http://localhost:${port}`;
    try {
      const response = await fetchWithTimeout(`${testUrl}/health`, { method: 'GET' }, 1000);
      const data = await response.json();
      if (data && data.status === 'ok') {
        LOCAL = testUrl;
        console.log(`[FRIDAY-PRELOAD-HEALTH] Dynamic local edge detected ONLINE on port ${port}!`);
        return true;
      }
    } catch (err) {
      // Continue to next port
    }
  }
  console.warn(`[FRIDAY-PRELOAD-HEALTH] Local Edge is OFFLINE (checked 3131 and 8888)`);
  return false;
}

contextBridge.exposeInMainWorld("friday", {
  execute: (text) => ipcRenderer.invoke("friday:execute", text),
  minimize: () => ipcRenderer.send("friday:minimize"),
  selectApp: () => ipcRenderer.invoke("friday:select-app"),
  launchApp: (path) => ipcRenderer.invoke("friday:launch-app", path),
  getAppIcon: (path) => ipcRenderer.invoke("friday:get-app-icon", path),
  saveCustomApps: (apps) => ipcRenderer.invoke("friday:save-custom-apps", apps),
  getCustomApps: () => ipcRenderer.invoke("friday:get-custom-apps"),
  openSpotify: () => ipcRenderer.send("friday:open-spotify"),
  openExternal: (url) => ipcRenderer.send("friday:open-external", url),

  // Window visibility controls — wake word shows, idle hides
  showWindow: () => ipcRenderer.send("friday:show-window"),
  hideWindow: () => ipcRenderer.send("friday:hide-window"),
  
  // Smart-routing fetch clients exposed directly to the React window context
  fridayFetch: (feature, path, options) => fridayFetch(feature, path, options),
  checkLocalHealth: () => checkLocalHealth(),
});

contextBridge.exposeInMainWorld("electronAPI", {
  saveVoiceProfile: (profileJSON) => ipcRenderer.invoke('save-voice-profile', profileJSON),
  loadVoiceProfile: () => ipcRenderer.invoke('load-voice-profile'),
  clearVoiceProfile: () => ipcRenderer.invoke('clear-voice-profile')
});
