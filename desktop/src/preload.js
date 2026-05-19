const { contextBridge, ipcRenderer } = require("electron");
const { fridayFetch, checkLocalHealth } = require("./utils/fridayFetch");

contextBridge.exposeInMainWorld("friday", {
  execute: (text) => ipcRenderer.invoke("friday:execute", text),
  minimize: () => ipcRenderer.send("friday:minimize"),
  selectApp: () => ipcRenderer.invoke("friday:select-app"),
  launchApp: (path) => ipcRenderer.invoke("friday:launch-app", path),
  getAppIcon: (path) => ipcRenderer.invoke("friday:get-app-icon", path),
  saveCustomApps: (apps) => ipcRenderer.invoke("friday:save-custom-apps", apps),
  getCustomApps: () => ipcRenderer.invoke("friday:get-custom-apps"),
  openSpotify: () => ipcRenderer.send("friday:open-spotify"),
  
  // Expose smart-routing network clients directly to React frontend
  fridayFetch: (feature, path, options) => fridayFetch(feature, path, options),
  checkLocalHealth: () => checkLocalHealth(),
});
