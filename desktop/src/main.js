// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\desktop\src\main.js
const { app, BrowserWindow, ipcMain, screen, session, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");

// ── CLEAR SSLKEYLOGFILE TO PREVENT ELECTRON NETWORK SERVICE CRASH ──
// Prevents "Failed opening SSL key log file" error from inaccessible volume paths
delete process.env.SSLKEYLOGFILE;

let win;

// ── BYPASS WINDOWS SYSTEM CACHE PERMISSION CONFLICTS ──
// Assign user-writable profile directory in workspace and disable hard drive disk caches
const customUserDataPath = path.join(__dirname, "electron_user_data");
if (!fs.existsSync(customUserDataPath)) {
  fs.mkdirSync(customUserDataPath, { recursive: true });
}
app.setPath("userData", customUserDataPath);
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3131/health', { timeout: 3000 }, (res) => {
      if (res.statusCode === 200) {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend() {
  for (let i = 1; i <= 10; i++) {
    const isOnline = await checkBackendHealth();
    if (isOnline) {
      console.log('[FRIDAY] Backend ready');
      return;
    }
    console.log(`[FRIDAY] Waiting for backend... (Retry ${i}/10)`);
    if (i < 10) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log('[FRIDAY] Backend not found — continuing anyway');
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width:  width,
    height: height,
    x: 0,
    y: 0,

    frame:           false,
    transparent:     true,
    backgroundMaterial: 'acrylic',
    alwaysOnTop:     true,
    resizable:       false,
    skipTaskbar:     true,
    hasShadow:       false,
    show:            false, // Hidden by default, revealed by wake word

    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false, // Allows file:// page to fetch from http://localhost:3131 CORS-free!
      backgroundThrottling: false, // Keep wake word engine running when window is hidden
    },
  });

  // ── AUTO-GRANT MICROPHONE PERMISSION ──
  // FRIDAY needs always-on mic access — no permission dialogs
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === "media" || permission === "microphone") {
      callback(true); // Always grant mic access
      return;
    }
    callback(true); // Grant other permissions too
  });

  // Also handle permission checks (for SpeechRecognition)
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === "media" || permission === "microphone") {
      return true;
    }
    return true;
  });

  win.loadFile(path.join(__dirname, "../f.r.i.d.a.y.-ai (1)/dist/index.html"));
  // win.webContents.openDevTools(); // Disabled to prevent terminal popup
}

app.whenReady().then(async () => {
  // Auto-start FRIDAY on Windows login (only if packaged)
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: []
    });
  } else {
    app.setLoginItemSettings({
      openAtLogin: false,
      path: process.execPath,
      args: []
    });
  }

  await waitForBackend();
  
  const VOICE_PROFILE_PATH = path.join(app.getPath('userData'), 'friday_voice_profile.json');
  if (!fs.existsSync(VOICE_PROFILE_PATH)) {
    console.log('[FRIDAY] No voice profile found. Opening enrollment wizard...');
    
    const enrollWin = new BrowserWindow({
      width: 480,
      height: 640,
      resizable: false,
      frame: false,
      backgroundColor: '#0d0000',
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false
      }
    });
    
    enrollWin.loadFile(path.join(__dirname, "voiceEnrollment.html"));
    
    enrollWin.on('closed', () => {
      if (fs.existsSync(VOICE_PROFILE_PATH)) {
        console.log('[FRIDAY] Voice profile enrolled successfully');
      } else {
        console.warn('[FRIDAY] Voice profile enrollment was cancelled/incomplete');
      }
      createWindow();
    });
  } else {
    createWindow();
  }
});
app.on("window-all-closed", () => app.quit());

ipcMain.on("friday:minimize", () => {
  // Close and quit the entire F.R.I.D.A.Y. AI system completely
  app.quit();
});

// ── SHOW / HIDE WINDOW IPC ── Wake word reveals, idle hides
ipcMain.on("friday:show-window", () => {
  if (win && !win.isDestroyed()) {
    win.show();
    win.setAlwaysOnTop(true);
    win.focus();
    console.log('[FRIDAY] Window revealed by wake word');
  }
});

ipcMain.on("friday:hide-window", () => {
  if (win && !win.isDestroyed()) {
    win.hide();
    console.log('[FRIDAY] Window hidden — listening in background');
  }
});

// Relay execute request from renderer → backend
ipcMain.handle("friday:execute", async (_e, text) => {
  const ports = ["3131", "8888"];
  for (const port of ports) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://localhost:${port}/execute`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ text }),
        signal:  controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        console.log(`[FRIDAY main.js] Executed locally on port ${port}`);
        return await res.json();
      }
    } catch (err) {
      // Continue to next port / cloud fallback
    }
  }

  console.log("[FRIDAY main.js] Local backend offline. Routing execution to CLOUD...");
  const res = await fetch("https://f-r-i-d-a-y-8ixf.onrender.com/execute", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ text }),
  });
  return res.json();
});

// Select app executable from filesystem
ipcMain.handle("friday:select-app", async () => {
  if (!win) return null;

  const wasAlwaysOnTop = win.isAlwaysOnTop();

  // Suspend alwaysOnTop and skipTaskbar so the system file explorer doesn't get hidden behind the HUD overlay
  if (wasAlwaysOnTop) win.setAlwaysOnTop(false);
  win.setSkipTaskbar(false);

  try {
    const result = await dialog.showOpenDialog(win, {
      title: "Select System Application Executable",
      properties: ["openFile"],
      filters: [
        { name: "Applications & Shortcuts", extensions: ["exe", "lnk", "bat", "cmd"] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  } catch (error) {
    console.error("[FRIDAY] File selection dialog failed:", error);
    return null;
  } finally {
    // Explicitly bring the frameless window back to the absolute front, focus it, and restore window parameters
    if (win && !win.isDestroyed()) {
      if (wasAlwaysOnTop) win.setAlwaysOnTop(true);
      win.setSkipTaskbar(true);
      win.show();
      win.focus();
    }
  }
});


// Launch custom app executable
ipcMain.handle("friday:launch-app", async (_e, appPath) => {
  return new Promise((resolve) => {
    const { exec } = require("child_process");
    exec(`start "" "${appPath}"`, { shell: "cmd.exe" }, (error) => {
      if (error) {
        console.error(`[FRIDAY] Failed to launch ${appPath}:`, error);
        resolve({ ok: false, error: error.message });
      } else {
        resolve({ ok: true });
      }
    });
  });
});

// Get native app icon as Base64 Data URL
ipcMain.handle("friday:get-app-icon", async (_e, appPath) => {
  try {
    let targetPath = appPath;

    // Resolve target path if the selected file is a Windows Shortcut (.lnk)
    if (appPath.toLowerCase().endsWith(".lnk")) {
      try {
        const shortcut = shell.readShortcutLink(appPath);
        if (shortcut && shortcut.target) {
          targetPath = shortcut.target;
        }
      } catch (lnkError) {
        console.error("[FRIDAY] Failed to resolve shortcut target path:", lnkError);
      }
    }

    const icon = await app.getFileIcon(targetPath, { size: "normal" });
    return icon.toDataURL();
  } catch (error) {
    console.error(`[FRIDAY] Failed to extract icon for ${appPath}:`, error);
    return null;
  }
});

// Persistent storage for custom apps using direct filesystem access
ipcMain.handle("friday:save-custom-apps", async (_e, apps) => {
  try {
    const filePath = path.join(app.getPath("userData"), "friday_custom_apps.json");
    fs.writeFileSync(filePath, JSON.stringify(apps, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error("[FRIDAY] Failed to save custom apps to filesystem:", err);
    return false;
  }
});

ipcMain.handle("friday:get-custom-apps", async () => {
  try {
    const filePath = path.join(app.getPath("userData"), "friday_custom_apps.json");
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("[FRIDAY] Failed to read custom apps from filesystem:", err);
  }
  return [];
});

let spotifyWindow = null;
ipcMain.on("friday:open-spotify", () => {
  if (spotifyWindow && !spotifyWindow.isDestroyed()) {
    // Window already exists — don't bring it to front, just ensure it's running
    return;
  }

  spotifyWindow = new BrowserWindow({
    width: 900,
    height: 650,
    title: "Spotify - F.R.I.D.A.Y. Player",
    autoHideMenuBar: true,
    alwaysOnTop: false,       // Don't pop up over FRIDAY
    show: false,              // Open silently in background
    webPreferences: {
      partition: "persist:spotify_session" // Persists Spotify logins!
    }
  });

  spotifyWindow.loadURL("https://open.spotify.com");

  // Show minimized once loaded — keeps it in taskbar but doesn't steal focus
  spotifyWindow.once('ready-to-show', () => {
    spotifyWindow.showInactive();
  });

  spotifyWindow.on("closed", () => {
    spotifyWindow = null;
  });
});

ipcMain.on("friday:open-external", (_e, url) => {
  shell.openExternal(url);
});

// ── VOICE PROFILE IPC DAEMON ──
const VOICE_PROFILE_PATH = path.join(app.getPath('userData'), 'friday_voice_profile.json');

ipcMain.handle('save-voice-profile', async (event, profileJSON) => {
  fs.writeFileSync(VOICE_PROFILE_PATH, profileJSON, 'utf8');
  return { success: true };
});

ipcMain.handle('load-voice-profile', async () => {
  if (!fs.existsSync(VOICE_PROFILE_PATH)) return null;
  return fs.readFileSync(VOICE_PROFILE_PATH, 'utf8');
});

ipcMain.handle('clear-voice-profile', async () => {
  if (fs.existsSync(VOICE_PROFILE_PATH)) fs.unlinkSync(VOICE_PROFILE_PATH);
  return { success: true };
});


