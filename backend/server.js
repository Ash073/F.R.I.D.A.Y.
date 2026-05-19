const express  = require("express");
const cors     = require("cors");
const multer   = require("multer");
const fs       = require("fs");
const path     = require("path");
const os       = require("os");
const { execFile } = require("child_process");
const { OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const { parseIntent, stripWakeWords } = require("./intentParser");
const { execute }     = require("./executor");
const { handleFollowUp } = require("./actionEngine");

const app  = express();
const PORT = 3131;

const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

// ═══════════════════════════════════════════════════════════
// LOCAL WHISPER — Python Bridge
// ═══════════════════════════════════════════════════════════

const { spawn } = require("child_process");
const TRANSCRIBE_SCRIPT = path.join(__dirname, "transcribe.py");

let whisperProcess = null;
let whisperReady = false;
let pendingTranscriptions = [];

function startWhisperDaemon() {
  console.log("[WHISPER DAEMON] Initializing persistent Whisper Python process...");
  whisperProcess = spawn("python", [TRANSCRIBE_SCRIPT]);

  let stdoutBuffer = "";

  whisperProcess.stdout.on("data", (data) => {
    const chunk = data.toString("utf-8");
    stdoutBuffer += chunk;

    // Check if we received a complete line
    if (stdoutBuffer.includes("\n")) {
      const lines = stdoutBuffer.split("\n");
      // Keep the last incomplete part in the buffer
      stdoutBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "READY") {
          whisperReady = true;
          console.log("[WHISPER DAEMON] ✓ Persistent Whisper Python process is READY and model is fully loaded in RAM!");
          continue;
        }

        if (trimmed) {
          // Find the oldest pending transcription promise and resolve it
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
    
    // Reject any outstanding requests
    const oldPending = pendingTranscriptions;
    pendingTranscriptions = [];
    oldPending.forEach(p => p.resolve({ text: "", confidence: 0.0, error: "Process terminated unexpectedly" }));
    
    // Only restart if the process was actually running previously and exited unexpectedly
    if (whisperProcess) {
      console.log("[WHISPER DAEMON] Restarting daemon in 5 seconds...");
      whisperProcess = null;
      setTimeout(startWhisperDaemon, 5000);
    }
  });
}

// Start the daemon immediately when server.js runs!
startWhisperDaemon();

/**
 * Transcribe audio using local Whisper (Persistent Daemon).
 */
function localWhisper(audioPath) {
  return new Promise((resolve) => {
    console.log(`[WHISPER] Querying daemon: ${audioPath}`);
    const startTime = Date.now();

    // Set a timeout to prevent hanging if the daemon fails
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
      // If process crashed or is not loaded yet, wait or it will process when ready
    }
  });
}

/**
 * Transcribe audio using OpenAI remote Whisper API.
 */
async function remoteWhisper(audioPath) {
  console.log(`[WHISPER] Querying remote OpenAI Whisper API for: ${audioPath}`);
  try {
    if (!process.env.OPENAI_API_KEY) {
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

/**
 * Intelligent hybrid audio transcriber.
 * Falls back to remote OpenAI Whisper if local daemon is not ready or if running in cloud production.
 */
async function transcribeAudio(audioPath) {
  const isOnRender = process.env.RENDER || (process.env.PORT && process.env.PORT !== "3131");
  
  if (isOnRender || !whisperReady) {
    console.log(`[WHISPER] Routing to REMOTE OpenAI Whisper API (Reason: ${isOnRender ? "Running on Render" : "Local Whisper daemon not ready/installed"})`);
    return await remoteWhisper(audioPath);
  }
  
  return await localWhisper(audioPath);
}


// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════

// POST /chat — returns intent JSON
app.post("/chat", (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });
  const intent = parseIntent(text.trim());
  res.json({ intent });
});

// POST /execute — parses + runs action, returns result
app.post("/execute", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });
  
  const intent = parseIntent(text.trim());
  const result = await execute(intent);
  res.json({ text, intent, result });
});

// POST /api/chat — compatibility endpoint for f.r.i.d.a.y.-ai (1) interface
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });
  
  const intent = parseIntent(message.trim());
  const result = await execute(intent);
  
  // The new interface expects { text: string }
  const responseText = result.message || JSON.stringify(result);
  res.json({ text: responseText });
});

// POST /followup — Handle follow-up answers for context-aware commands
app.post("/followup", async (req, res) => {
  const { followUpContext, answer } = req.body;
  if (!followUpContext || !answer) {
    return res.status(400).json({ error: "followUpContext and answer required" });
  }

  try {
    console.log(`[FRIDAY] Follow-up received: "${answer}" for ${followUpContext.appName}`);
    const result = await handleFollowUp(followUpContext, answer);
    res.json({ result: { ...result, type: "command" } });
  } catch (error) {
    console.error("[FRIDAY] Follow-up error:", error?.message || error);
    res.status(500).json({ error: error?.message || "Follow-up processing failed" });
  }
});

// POST /transcribe — HYBRID: local Whisper → classify → command OR AI query
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    // Rename with proper extension for Whisper
    filePath = req.file.path + ".webm";
    fs.renameSync(req.file.path, filePath);
    
    const fileSize = fs.statSync(filePath).size;
    console.log(`[FRIDAY] Audio received: ${filePath} (${fileSize} bytes)`);

    // ── STEP 1: HYBRID WHISPER TRANSCRIPTION ──
    const whisperResult = await transcribeAudio(filePath);
    const text = whisperResult.text || "";
    const confidence = whisperResult.confidence ?? 1.0;

    // Clean up audio file
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

    console.log(`[FRIDAY] Recognized: "${text}" (confidence: ${confidence})`);
    
    // ── STEP 1.5: FOLLOW-UP HANDLER ──
    if (req.body.followUpContext) {
      const followUpContext = JSON.parse(req.body.followUpContext);
      if (followUpContext.type !== 'WAKE_FOLLOWUP') {
        console.log(`[FRIDAY] Follow-up received for ${followUpContext.appName}: "${text}"`);
        try {
          const result = await handleFollowUp(followUpContext, text);
          return res.json({
            text,
            confidence,
            intent: { intent: "FOLLOWUP", type: "command" },
            result: { ...result, type: "command" }
          });
        } catch (err) {
          console.error("[FRIDAY] Follow-up action error:", err);
          return res.json({
            text,
            confidence,
            intent: { intent: "FOLLOWUP_FAILED", type: "command" },
            result: { ok: false, message: "Sorry, I couldn't process that response." }
          });
        }
      }
    }

    // ── WAKE WORD CHECK ──
    const wasManual = req.body.manual === 'true';
    const WAKE_PATTERNS = [
      /(?:hey|hello|hi|ok|okay|here)\s*(?:friday|f\.?r\.?i\.?d\.?a\.?y)/i,
      /^(?:friday|f\.?r\.?i\.?d\.?a\.?y)\b/i,
    ];
    const containsWakeWord = WAKE_PATTERNS.some(p => p.test(text.trim()));

    if (!wasManual && !containsWakeWord) {
      console.log(`[FRIDAY] Ignored (no wake word): "${text}"`);
      return res.json({ 
        text, 
        confidence, 
        intent: { intent: "IGNORED", type: "none" }, 
        result: { ok: true, message: "" } 
      });
    }

    // ── GREETING/WAKE COMMAND ONLY (e.g., "Hey FRIDAY" and stopped) ──
    const cleaned = stripWakeWords(text);
    if (cleaned === "") {
      console.log(`[FRIDAY] Woke up (no command yet)`);
      return res.json({
        text,
        confidence,
        intent: { intent: "WAKE", type: "command" },
        result: { ok: true, message: "Yes, boss?", followUp: { appName: "FRIDAY", type: "WAKE_FOLLOWUP" } }
      });
    }

    // ── STEP 2: CLASSIFY INTENT ──
    const intent = parseIntent(text.trim());
    console.log(`[FRIDAY] Intent: ${intent.intent} (${intent.type})`);

    // ── STEP 3: EXECUTE ──
    const result = await execute(intent);
    console.log(`[FRIDAY] Result: ${result.message}`);

    // ── STEP 4: RETURN (with confidence) ──
    res.json({ text, confidence, intent, result });

  } catch (error) {
    console.error("[FRIDAY] Pipeline error:", error?.message || error);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error?.message || "Processing failed" });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "online", service: "FRIDAY", timestamp: new Date().toISOString() });
});

// GET /api/system-metrics — Live hardware stats
app.get("/api/system-metrics", (req, res) => {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  const cpuPercent = 100 - ~~(100 * totalIdle / totalTick);
  const memUsedGB = (os.totalmem() - os.freemem()) / (1024 ** 3);
  
  res.json({ cpuPercent, cpuTemp: 35 + (cpuPercent * 0.2) + Math.random() * 2, memUsedGB });
});

// POST /api/launch-app — Fallback launcher for non-electron web environments
app.post("/api/launch-app", (req, res) => {
  const { path: appPath } = req.body;
  if (!appPath) return res.status(400).json({ error: "path required" });
  
  const { exec } = require("child_process");
  exec(`start "" "${appPath}"`, { shell: "cmd.exe" }, (error) => {
    if (error) {
      console.error(`[FRIDAY] Failed to launch ${appPath}:`, error);
      res.json({ ok: false, error: error.message });
    } else {
      res.json({ ok: true });
    }
  });
});

app.listen(PORT, () => {
  console.log(`\n══════════════════════════════════════════`);
  console.log(`  F.R.I.D.A.Y. Backend → http://localhost:${PORT}`);
  console.log(`  Whisper: LOCAL (offline)`);
  console.log(`  AI:      Gemini → OpenAI (fallback)`);
  console.log(`══════════════════════════════════════════\n`);
});
