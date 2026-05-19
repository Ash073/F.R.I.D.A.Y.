const { exec } = require("child_process");
const { findContacts } = require("./contacts");
const { findApp }      = require("./apps");

// ── helpers ──────────────────────────────────────────────────────────────────

function one(matches, label, execFn) {
  if (matches.length === 1)  return execFn(matches[0]);
  if (matches.length === 0)  return { ok: false, message: `No ${label} found.` };
  // multiple → return options list
  return {
    ok:      false,
    ambiguous: true,
    message: `Multiple ${label}s found. Which one?`,
    options: matches.map(m => ({ id: m.id ?? m.cmd, label: m.name })),
  };
}

/**
 * Actually run a shell command on Windows
 */
function shellExec(command) {
  return new Promise((resolve) => {
    exec(command, { shell: "cmd.exe" }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[FRIDAY] Shell error: ${error.message}`);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// FOLLOW-UP PROMPTS — Context-aware questions after commands
// ═══════════════════════════════════════════════════════════════

/**
 * Define which apps should trigger follow-up questions.
 * Each entry: app name (lowercase) → { question, handler(answer) }
 */
const APP_FOLLOW_UPS = {
  "chrome": {
    question: "Which profile would you like me to open Chrome with? Say 'default' or a profile name, or 'skip' to open normally.",
    handler: async (answer) => {
      const a = answer.toLowerCase().trim();
      if (a === "skip" || a === "no" || a === "normal" || a === "default" || a === "just open it") {
        await shellExec("start chrome");
        return { ok: true, message: "Opening Chrome with default profile." };
      }
      // Chrome profile directory names are typically "Profile 1", "Profile 2", etc.
      // But users may have named profiles
      await shellExec(`start chrome --profile-directory="${answer.trim()}"`);
      return { ok: true, message: `Opening Chrome with profile "${answer.trim()}".` };
    }
  },
  "whatsapp": {
    question: "Who would you like to chat with on WhatsApp? Say a contact name, or 'skip' to just open WhatsApp.",
    handler: async (answer) => {
      const a = answer.toLowerCase().trim();
      if (a === "skip" || a === "no" || a === "just open it" || a === "nobody") {
        await shellExec("start whatsapp:");
        return { ok: true, message: "Opening WhatsApp." };
      }
      // Open WhatsApp web search for the contact
      const encoded = encodeURIComponent(answer.trim());
      await shellExec(`start "https://web.whatsapp.com/send?text=&phone=&name=${encoded}"`);
      await shellExec("start whatsapp:");
      return { ok: true, message: `Opening WhatsApp. Please search for "${answer.trim()}" in the chat list.` };
    }
  },
  "youtube": {
    question: "What would you like to watch on YouTube? Say a search term, or 'skip' to just open YouTube.",
    handler: async (answer) => {
      const a = answer.toLowerCase().trim();
      if (a === "skip" || a === "no" || a === "just open it" || a === "nothing") {
        await shellExec("start https://youtube.com");
        return { ok: true, message: "Opening YouTube." };
      }
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(answer.trim())}`;
      await shellExec(`start "" "${url}"`);
      return { ok: true, message: `Searching YouTube for "${answer.trim()}".` };
    }
  },
  "spotify": {
    question: "What would you like to play on Spotify? Say a song, artist, or playlist name, or 'skip' to just open Spotify.",
    handler: async (answer) => {
      const a = answer.toLowerCase().trim();
      if (a === "skip" || a === "no" || a === "just open it" || a === "nothing") {
        return { ok: true, message: "Opening Spotify on F.R.I.D.A.Y.", openSpotify: true };
      }
      // Open Spotify search
      const url = `https://open.spotify.com/search/${encodeURIComponent(answer.trim())}`;
      await shellExec(`start "" "${url}"`);
      return { ok: true, message: `Searching Spotify for "${answer.trim()}".` };
    }
  },
  "instagram": {
    question: "Whose profile would you like to visit on Instagram? Say a username, or 'skip' to just open Instagram.",
    handler: async (answer) => {
      const a = answer.toLowerCase().trim();
      if (a === "skip" || a === "no" || a === "just open it" || a === "nobody") {
        await shellExec("start https://instagram.com");
        return { ok: true, message: "Opening Instagram." };
      }
      const username = answer.trim().replace(/^@/, "");
      await shellExec(`start "" "https://instagram.com/${username}"`);
      return { ok: true, message: `Opening Instagram profile: ${username}.` };
    }
  },
  "gmail": {
    question: "Would you like to compose a new email? Say 'yes' or 'compose', or 'skip' to just open Gmail.",
    handler: async (answer) => {
      const a = answer.toLowerCase().trim();
      if (a === "yes" || a === "compose" || a === "new email" || a === "new") {
        await shellExec(`start "" "https://mail.google.com/mail/u/0/#inbox?compose=new"`);
        return { ok: true, message: "Opening Gmail with a new compose window." };
      }
      await shellExec(`start "" "https://mail.google.com"`);
      return { ok: true, message: "Opening Gmail." };
    }
  },
  "discord": {
    question: "Which server or DM would you like to open in Discord? Say 'skip' to just open Discord.",
    handler: async (answer) => {
      const a = answer.toLowerCase().trim();
      await shellExec("start discord:");
      if (a === "skip" || a === "no" || a === "just open it") {
        return { ok: true, message: "Opening Discord." };
      }
      return { ok: true, message: `Opening Discord. Please navigate to "${answer.trim()}" once it loads.` };
    }
  },
};

// ── action handlers ───────────────────────────────────────────────────────────

function handleCall({ contact }) {
  const matches = findContacts(contact);
  return one(matches, "contact", (c) => {
    console.log(`[FRIDAY] CALL → ${c.name} (${c.phone})`);
    return { ok: true, message: `Calling ${c.name} at ${c.phone}…` };
  });
}

async function handleOpenApp({ app }) {
  const matches = findApp(app);
  return one(matches, "app", async (a) => {
    const appKey = a.name.toLowerCase();
    const followUp = APP_FOLLOW_UPS[appKey];

    if (followUp) {
      // Don't open the app yet — ask the follow-up question first
      console.log(`[FRIDAY] OPEN_APP → ${a.name} (has follow-up question)`);
      return {
        ok: true,
        message: `Sure, I can open ${a.name}. ${followUp.question}`,
        followUp: {
          type: "OPEN_APP_FOLLOWUP",
          app: appKey,
          appName: a.name,
          cmd: a.cmd,
        },
      };
    }

    // No follow-up — just open it
    console.log(`[FRIDAY] OPEN_APP → ${a.name} (cmd: ${a.cmd})`);
    if (appKey === "spotify") {
      return { ok: true, message: "Opening Spotify on F.R.I.D.A.Y.", openSpotify: true };
    }
    const success = await shellExec(a.cmd);
    if (success) {
      return { ok: true, message: `Opening ${a.name}.` };
    } else {
      return { ok: false, message: `Failed to open ${a.name}. It may not be installed.` };
    }
  });
}

/**
 * Handle the follow-up answer for an app
 */
async function handleFollowUp(followUpContext, answer) {
  const appKey = followUpContext.app;
  const followUp = APP_FOLLOW_UPS[appKey];

  if (!followUp) {
    // No follow-up handler — just open the app normally
    await shellExec(followUpContext.cmd);
    return { ok: true, message: `Opening ${followUpContext.appName}.` };
  }

  console.log(`[FRIDAY] Follow-up for ${followUpContext.appName}: "${answer}"`);
  return await followUp.handler(answer);
}

async function handleCloseApp({ app }) {
  const PROCESS_MAP = {
    "chrome": "chrome.exe", "browser": "chrome.exe", "google chrome": "chrome.exe",
    "whatsapp": "WhatsApp.exe",
    "spotify": "Spotify.exe",
    "discord": "Discord.exe",
    "edge": "msedge.exe", "microsoft edge": "msedge.exe",
    "code": "Code.exe", "vscode": "Code.exe", "vs code": "Code.exe",
    "notepad": "notepad.exe",
    "slack": "slack.exe",
    "word": "WINWORD.EXE", "microsoft word": "WINWORD.EXE",
    "excel": "EXCEL.EXE",
    "powerpoint": "POWERPNT.EXE",
    "explorer": "explorer.exe", "file explorer": "explorer.exe",
    "task manager": "Taskmgr.exe",
    "calculator": "Calculator.exe",
  };

  const q = app.toLowerCase().trim().replace(/^the\s+/, "").replace(/\s+app$/i, "");
  const processName = PROCESS_MAP[q];

  if (processName) {
    console.log(`[FRIDAY] CLOSE_APP → ${q} (taskkill: ${processName})`);
    await shellExec(`taskkill /IM "${processName}" /F`);
    return { ok: true, message: `Closing ${app}.` };
  }

  console.log(`[FRIDAY] CLOSE_APP → generic: ${q}`);
  await shellExec(`taskkill /IM "${q}.exe" /F`);
  return { ok: true, message: `Closing ${app}.` };
}

async function handleSearch({ query }) {
  console.log(`[FRIDAY] SEARCH → "${query}"`);
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  await shellExec(`start "" "${url}"`);
  return { ok: true, message: `Searching for "${query}".` };
}

async function handleSystem({ action }) {
  console.log(`[FRIDAY] SYSTEM → ${action}`);
  const SYSTEM_CMDS = {
    "shutdown": "shutdown /s /t 5",
    "restart": "shutdown /r /t 5",
    "reboot": "shutdown /r /t 5",
    "sleep": "rundll32.exe powrprof.dll,SetSuspendState 0,1,0",
    "lock": "rundll32.exe user32.dll,LockWorkStation",
  };
  const cmd = SYSTEM_CMDS[action];
  if (cmd) {
    await shellExec(cmd);
    return { ok: true, message: `System ${action} initiated.` };
  }
  return { ok: false, message: `Unknown system action: ${action}` };
}

async function handleScreenshot() {
  console.log("[FRIDAY] SCREENSHOT");
  await shellExec("snippingtool");
  return { ok: true, message: "Screenshot tool opened." };
}

async function handleVolume({ level }) {
  console.log(`[FRIDAY] VOLUME → ${level}`);
  if (level === "mute") {
    await shellExec('powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"');
  } else if (level === "up") {
    await shellExec('powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"');
  } else if (level === "down") {
    await shellExec('powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"');
  }
  return { ok: true, message: `Volume ${level}.` };
}

// ── engine entry point ────────────────────────────────────────────────────────

const ENGINE = {
  CALL:       handleCall,
  OPEN_APP:   handleOpenApp,
  CLOSE_APP:  handleCloseApp,
  SEARCH:     handleSearch,
  SYSTEM:     handleSystem,
  SCREENSHOT: handleScreenshot,
  VOLUME:     handleVolume,
};

async function runAction(intentObj) {
  const handler = ENGINE[intentObj.intent];
  if (!handler) return null;
  return await handler(intentObj.params);
}

module.exports = { runAction, handleFollowUp };
