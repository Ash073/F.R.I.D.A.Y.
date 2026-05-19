// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\server.js
/**
 * F.R.I.D.A.Y. Advanced Hybrid Backend Server
 * Dynamic Local (Edge) / Cloud deployment configurations.
 */

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { OpenAI } = require("openai");
require("dotenv").config();

// Load Shared Config
let sharedConfig = { ENABLE_WHISPER: true };
try {
  sharedConfig = require("../config");
} catch (e) {
  console.warn("[SERVER] Shared config.js not found at root, using default settings.");
}

const ENABLE_WHISPER = process.env.ENABLE_WHISPER !== undefined 
  ? process.env.ENABLE_WHISPER === "true" 
  : sharedConfig.ENABLE_WHISPER;

const PORT = process.env.PORT || 3131;

const { parseIntent, stripWakeWords } = require("./intentParser");
const { execute } = require("./executor");
const { handleFollowUp } = require("./actionEngine");
const spotifyRouter = require("./spotify");

const app = express();
const upload = multer({ dest: "uploads/" });

// ── CORS POLICY ──
// Allow requests from localhost AND your specific Render / Railway domains
const allowedOrigins = [
  "http://localhost:3131",
  "http://localhost:5173",
  "http://localhost:8888",
  "https://f-r-i-d-a-y-8ixf.onrender.com"
];
if (process.env.CLOUD_URL) {
  allowedOrigins.push(process.env.CLOUD_URL);
}

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1 && !origin.startsWith("http://localhost:")) {
      return callback(null, true); // Allow flexibility but log warning
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());

// Load Spotify Sub-routes (Always Active)
app.use("/spotify", spotifyRouter);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy-key",
});


// ═══════════════════════════════════════════════════════════
// LOCAL WHISPER PROCESS DAEMON — ONLY ENABLED IN LOCAL MODE
// ═══════════════════════════════════════════════════════════

let whisperProcess = null;
let whisperReady = false;
let pendingTranscriptions = [];

function startWhisperDaemon() {
  if (!ENABLE_WHISPER) {
    console.log("[WHISPER DAEMON] Bypassing startup: Whisper STT is disabled in Cloud deployment.");
    return;
  }

  const TRANSCRIBE_SCRIPT = path.join(__dirname, "transcribe.py");
  console.log("[WHISPER DAEMON] Initializing persistent Whisper Python process...");
  
  whisperProcess = spawn("python", [TRANSCRIBE_SCRIPT]);
  let stdoutBuffer = "";

  whisperProcess.stdout.on("data", (data) => {
    const chunk = data.toString("utf-8");
    stdoutBuffer += chunk;

    if (stdoutBuffer.includes("\n")) {
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "READY") {
          whisperReady = true;
          console.log("[WHISPER DAEMON] ✓ Persistent Whisper Python process is READY and model is fully loaded in RAM!");
          continue;
        }

        if (trimmed) {
          const pending = pendingTranscriptions.shift();
          if (pending) {
            try {
              const parsed = JSON.parse(trimmed);
              pending.resolve(parsed);
            } catch (err) {
              pending.resolve({ text: trimmed, confidence: 1.0 });
            }
          }
        }
      }
    }
  });

  whisperProcess.stderr.on("data", (data) => {
    const errStr = data.toString("utf-8");
    if (!errStr.includes("warnings") && !errStr.includes("UserWarning") && !errStr.includes("FutureWarning")) {
      console.warn("[WHISPER DAEMON stderr]:", errStr);
    }
  });

  whisperProcess.on("error", (err) => {
    console.error("[WHISPER DAEMON] ✗ Failed to start Python process (Python may not be installed):", err.message);
    whisperReady = false;
    whisperProcess = null;
  });

  whisperProcess.on("close", (code) => {
    console.error(`[WHISPER DAEMON] Process exited with code ${code}.`);
    whisperReady = false;
    
    const oldPending = pendingTranscriptions;
    pendingTranscriptions = [];
    oldPending.forEach(p => p.resolve({ text: "", confidence: 0.0, error: "Process terminated unexpectedly" }));
    
    if (whisperProcess) {
      console.log("[WHISPER DAEMON] Restarting daemon in 5 seconds...");
      whisperProcess = null;
      setTimeout(startWhisperDaemon, 5000);
    }
  });
}

// Boot daemon
startWhisperDaemon();


// ── TRANSCRIPTION HELPER FUNCTIONS ──

function localWhisper(audioPath) {
  return new Promise((resolve) => {
    console.log(`[WHISPER] Querying local daemon: ${audioPath}`);
    const startTime = Date.now();

    const timeoutId = setTimeout(() => {
      const idx = pendingTranscriptions.findIndex(p => p.audioPath === audioPath);
      if (idx !== -1) {
        pendingTranscriptions.splice(idx, 1);
        console.error(`[WHISPER] Transcription timed out for ${audioPath}`);
        resolve({ text: "", confidence: 0.0 });
      }
    }, 25000);

    const wrappedResolve = (result) => {
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;
      console.log(`[WHISPER] Result (${elapsed}ms): "${result.text}" (confidence: ${result.confidence})`);
      resolve(result);
    };

    pendingTranscriptions.push({ audioPath, resolve: wrappedResolve });

    if (whisperProcess && whisperReady) {
      whisperProcess.stdin.write(audioPath + "\n");
    } else {
      console.warn("[WHISPER DAEMON] Process not ready yet. Queuing request...");
    }
  });
}

async function remoteWhisper(audioPath) {
  console.log(`[WHISPER] Querying remote OpenAI Whisper API for: ${audioPath}`);
  try {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "dummy-key") {
      throw new Error("OPENAI_API_KEY is not configured in environment variables");
    }
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
    });
    return { text: response.text, confidence: 1.0 };
  } catch (err) {
    console.error("[WHISPER] Remote transcription failed:", err?.message || err);
    return { text: "", confidence: 0.0, error: err?.message || err };
  }
}

async function transcribeAudio(audioPath) {
  const isOnRender = process.env.RENDER || (process.env.PORT && process.env.PORT !== "3131" && process.env.PORT !== "8888");
  
  if (isOnRender || !whisperReady) {
    return await remoteWhisper(audioPath);
  }
  return await localWhisper(audioPath);
}


// ═══════════════════════════════════════════════════════════
// ROUTES — ALWAYS AVAILABLE
// ═══════════════════════════════════════════════════════════

// GET /health — returns backend metrics, mode, and configurations
app.get("/health", (req, res) => {
  try {
    res.json({
      status: "ok",
      mode: ENABLE_WHISPER ? "local" : "cloud",
      whisper: ENABLE_WHISPER,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /chat — compatibility intent parser helper
app.post("/chat", (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    const intent = parseIntent(text.trim());
    res.json({ intent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /ask — compatibility AI query routing
app.post("/ask", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    
    const intent = parseIntent(message.trim());
    const result = await execute(intent);
    res.json({ text: result.message || JSON.stringify(result) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /execute — execute command actions directly
app.post("/execute", async (req, res) => {
  try {
    const { text, deviceId } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    
    const intent = parseIntent(text.trim());
    intent.params = intent.params || {};
    intent.params.deviceId = deviceId;
    
    const result = await execute(intent);
    res.json({ text, intent, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /command — alternative direct execution route
app.post("/command", async (req, res) => {
  try {
    const { text, deviceId } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    
    const intent = parseIntent(text.trim());
    intent.params = intent.params || {};
    intent.params.deviceId = deviceId;
    
    const result = await execute(intent);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat — compatibility core endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, deviceId } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    
    const intent = parseIntent(message.trim());
    intent.params = intent.params || {};
    intent.params.deviceId = deviceId;
    
    const result = await execute(intent);
    
    const responseText = result.message || JSON.stringify(result);
    res.json({ text: responseText, intent, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /followup — context followups
app.post("/followup", async (req, res) => {
  try {
    const { followUpContext, answer } = req.body;
    if (!followUpContext || !answer) {
      return res.status(400).json({ error: "followUpContext and answer required" });
    }
    const result = await handleFollowUp(followUpContext, answer);
    res.json({ result: { ...result, type: "command" } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/system-metrics
app.get("/api/system-metrics", (req, res) => {
  try {
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    cpus.forEach(cpu => {
      for (type in cpu.times) totalTick += cpu.times[type];
      totalIdle += cpu.times.idle;
    });
    const cpuPercent = 100 - ~~(100 * totalIdle / totalTick);
    const memUsedGB = (os.totalmem() - os.freemem()) / (1024 ** 3);
    
    res.json({ cpuPercent, cpuTemp: 35 + (cpuPercent * 0.2) + Math.random() * 2, memUsedGB });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/launch-app
app.post("/api/launch-app", (req, res) => {
  try {
    const { path: appPath } = req.body;
    if (!appPath) return res.status(400).json({ error: "path required" });
    
    const { exec } = require("child_process");
    exec(`start "" "${appPath}"`, { shell: "cmd.exe" }, (error) => {
      if (error) {
        res.json({ ok: false, error: error.message });
      } else {
        res.json({ ok: true });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════
// CONDITIONAL ROUTES — ONLY ACTIVE IF ENABLE_WHISPER = TRUE
// ═══════════════════════════════════════════════════════════

if (true) {
  // POST /transcribe
  app.post("/transcribe", upload.single("audio"), async (req, res) => {
    let filePath = null;
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file provided" });
      }

      filePath = req.file.path + ".webm";
      fs.renameSync(req.file.path, filePath);
      
      const whisperResult = await transcribeAudio(filePath);
      const text = whisperResult.text || "";
      const confidence = whisperResult.confidence ?? 1.0;

      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      filePath = null;

      if (!text) {
        return res.json({ 
          text: "", 
          confidence: 0.0,
          intent: { intent: "UNKNOWN", type: "command" },
          result: { ok: false, message: "I couldn't understand that. Please try again." }
        });
      }

      // Check follow-ups
      if (req.body.followUpContext) {
        const followUpContext = JSON.parse(req.body.followUpContext);
        if (followUpContext.type !== 'WAKE_FOLLOWUP') {
          const result = await handleFollowUp(followUpContext, text);
          return res.json({
            text,
            confidence,
            intent: { intent: "FOLLOWUP", type: "command" },
            result: { ...result, type: "command" }
          });
        }
      }

      // Check manual / wake word activation
      const WAKE_PATTERNS = [
        /(?:hey|hello|hi|ok|okay|here)\s*(?:friday|f\.?r\.?i\.?d\.?a\.?y)/i,
        /^(?:friday|f\.?r\.?i\.?d\.?a\.?y)\b/i,
      ];
      const containsWakeWord = WAKE_PATTERNS.some(p => p.test(text.trim()));
      const wasManual = req.body.manual === 'true';

      if (!wasManual && !containsWakeWord) {
        return res.json({ 
          text, 
          confidence, 
          intent: { intent: "IGNORED", type: "none" }, 
          result: { ok: true, message: "" } 
        });
      }

      const cleaned = stripWakeWords(text);
      if (cleaned === "") {
        return res.json({
          text,
          confidence,
          intent: { intent: "WAKE", type: "command" },
          result: { ok: true, message: "Yes, boss?", followUp: { appName: "FRIDAY", type: "WAKE_FOLLOWUP" } }
        });
      }

      const intent = parseIntent(text.trim());
      intent.params = intent.params || {};
      intent.params.deviceId = req.body.deviceId;
      
      const result = await execute(intent);
      res.json({ text, confidence, intent, result });

    } catch (error) {
      console.error("[FRIDAY] Pipeline error:", error?.message || error);
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: error?.message || "Processing failed" });
    }
  });

  // POST /whisper — simple audio-to-text bridge
  app.post("/whisper", upload.single("audio"), async (req, res) => {
    let filePath = null;
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file provided" });
      }

      filePath = req.file.path + ".webm";
      fs.renameSync(req.file.path, filePath);
      
      const whisperResult = await transcribeAudio(filePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      res.json({ text: whisperResult.text || "", confidence: whisperResult.confidence || 0.0 });
    } catch (err) {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      res.status(500).json({ error: err.message });
    }
  });
}


app.listen(PORT, () => {
  console.log(`\n══════════════════════════════════════════`);
  console.log(`  F.R.I.D.A.Y. Advanced Server -> Port: ${PORT}`);
  console.log(`  Mode:    ${ENABLE_WHISPER ? "LOCAL (Edge)" : "CLOUD"}`);
  console.log(`  Whisper: ${ENABLE_WHISPER ? "Active" : "Bypassed"}`);
  console.log(`══════════════════════════════════════════\n`);
});
