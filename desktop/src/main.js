const { app, BrowserWindow, ipcMain, screen, session, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

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

    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
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
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

ipcMain.on("friday:minimize", () => {
  if (win) win.minimize();
});

// Relay execute request from renderer → backend
ipcMain.handle("friday:execute", async (_e, text) => {
  const res = await fetch("http://localhost:3131/execute", {
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

