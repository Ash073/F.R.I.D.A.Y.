// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\server.js
require('dotenv').config()

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

// ── CLEAR SSLKEYLOGFILE TO PREVENT SSL ERRORS ──
// Prevents PermissionError from inaccessible volume paths set by system tools
delete process.env.SSLKEYLOGFILE;

// Load Shared Config
let sharedConfig = { ENABLE_WHISPER: true };
try {
  sharedConfig = require("../config");
} catch (e) {
  console.warn("[SERVER] Shared config.js not found at root, using default settings.");
}

const PORT = process.env.PORT || 8888
const ENABLE_WHISPER = process.env.ENABLE_WHISPER === 'true'

const { parseIntent, stripWakeWords } = require("./intentParser");
const { execute } = require("./executor");
const { handleFollowUp } = require("./actionEngine");
const spotifyRouter = require("./spotify");
const { askFriday, clearHistory, getHistory, getAPIStatus } = require('./aiQuery');
const { runAgent, needsAgentMode } = require('./fridayAgent');

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(require('cors')({
  origin: ['http://localhost:8888', 'http://localhost:3000', 'file://']
}))

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

function startWhisperProcess() {
  if (!ENABLE_WHISPER) {
    console.log("[WHISPER DAEMON] Bypassing startup: Whisper STT is disabled in Cloud deployment.");
    return;
  }

  const TRANSCRIBE_SCRIPT = path.join(__dirname, "transcribe.py");
  if (!fs.existsSync(TRANSCRIBE_SCRIPT)) {
    console.warn(`[WHISPER DAEMON] transcribe.py not found at ${TRANSCRIBE_SCRIPT}. Bypassing local Whisper STT.`);
    whisperReady = false;
    return;
  }

  console.log("[FRIDAY WHISPER] Process started");
  
  // Sanitize env: remove SSLKEYLOGFILE to prevent PermissionError in Python's SSL module
  const cleanEnv = { ...process.env };
  delete cleanEnv.SSLKEYLOGFILE;

  whisperProcess = spawn("python", [TRANSCRIBE_SCRIPT, "--serve"], { env: cleanEnv, windowsHide: true });
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
      console.warn("[FRIDAY WHISPER ERROR]:", errStr);
    }
  });

  whisperProcess.on("error", (err) => {
    console.error("[FRIDAY WHISPER ERROR] Failed to start Python process (Python may not be installed):", err.message);
    whisperReady = false;
    whisperProcess = null;
  });

  whisperProcess.on("close", (code) => {
    console.error(`[FRIDAY WHISPER ERROR] Process exited with code ${code}.`);
    whisperReady = false;
    
    const oldPending = pendingTranscriptions;
    pendingTranscriptions = [];
    oldPending.forEach(p => p.resolve({ text: "", confidence: 0.0, error: "Process terminated unexpectedly" }));
    
    console.log("[FRIDAY WHISPER ERROR] Restarting process in 3 seconds...");
    whisperProcess = null;
    setTimeout(startWhisperProcess, 3000);
  });
}

// Boot daemon
if (ENABLE_WHISPER) startWhisperProcess();


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
  res.json({ status: 'ok', whisper: ENABLE_WHISPER, port: PORT, uptime: process.uptime() })
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

// ── DUAL-AI ROUTE HANDLERS ──

// POST /ask — Query the dual-AI system
app.post("/ask", async (req, res) => {
  try {
    const { message, mode } = req.body;

    // Validation
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message too long' });
    }
    const validModes = ['gemini', 'openai', 'groq', 'cohere', 'merged', 'auto'];
    if (mode !== undefined && !validModes.includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    const modeToUse = mode || 'auto';
    const reply = await askFriday(message, modeToUse);
    const modeUsed = askFriday.lastUsedModel || modeToUse;

    return res.status(200).json({
      reply,
      mode: modeUsed,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({
      error: 'AI query failed',
      detail: err.message
    });
  }
});

// POST /ask/clear — Clear conversation history
app.post("/ask/clear", (req, res) => {
  try {
    clearHistory();
    const { sessionContext } = require('./fridayAgent');
    if (sessionContext) sessionContext.clear();
    return res.status(200).json({
      success: true,
      message: 'Conversation history cleared'
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /ask/history — Get current conversation history
app.get("/ask/history", (req, res) => {
  try {
    const history = getHistory();
    return res.status(200).json({
      history,
      count: history.length
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /ask/status — fetch real-time 4-tier waterfall status
app.get("/ask/status", (req, res) => {
  try {
    const status = getAPIStatus();
    return res.status(200).json(status);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────
// POST /agent/run
// ────────────────────────────────────────
app.post("/agent/run", async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { query } = req.body;
  if (!query) {
    res.write(`data: ${JSON.stringify({ type: 'error', text: 'Query is required' })}\n\n`);
    return res.end();
  }

  function sendEvent(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  sendEvent({ type: 'start', query });

  try {
    for await (const update of runAgent(query)) {
      sendEvent(update);
      if (update.type === 'final') break;
    }
    sendEvent({ type: 'done' });
    res.end();
  } catch (err) {
    sendEvent({ type: 'error', text: err.message });
    res.end();
  }
});

// ────────────────────────────────────────
// POST /agent/classify
// ────────────────────────────────────────
app.post("/agent/classify", (req, res) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });
    const needsAgent = needsAgentMode(query);
    res.json({ needsAgent, query });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────
// GET /agent/context
// ────────────────────────────────────────
app.get("/agent/context", (req, res) => {
  try {
    const { sessionContext } = require('./fridayAgent');
    if (!sessionContext) return res.json({});
    
    const context = {
      lastTopic: sessionContext.get('last_research_topic'),
      lastSummary: sessionContext.get('last_research_summary'),
      lastSources: sessionContext.get('last_research_sources'),
      lastTime: sessionContext.get('last_research_time'),
      memoryEntries: []
    };
    
    // Extract any memories from agentTools agentMemory if needed
    const { agentMemory } = require('./agentTools');
    if (agentMemory) {
      for (const [key, value] of agentMemory.entries()) {
        context.memoryEntries.push({ key, value });
      }
    }
    
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /agent/tools
// ────────────────────────────────────────
app.get("/agent/tools", (req, res) => {
  res.json([
    { name: 'web_search', description: 'Search the web', args: 'query' },
    { name: 'wikipedia', description: 'Wikipedia lookup', args: 'topic' },
    { name: 'arxiv_search', description: 'Academic paper search', args: 'query' },
    { name: 'calculate', description: 'Math calculator', args: 'expression' },
    { name: 'analyze_text', description: 'Text analysis', args: 'text, task' },
    { name: 'fetch_url', description: 'Read a webpage', args: 'url' },
    { name: 'remember', description: 'Store information', args: 'key, value' },
    { name: 'recall', description: 'Retrieve information', args: 'key' }
  ]);
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
    const { message, deviceId, attachment } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });
    
    const intent = parseIntent(message.trim());
    intent.params = intent.params || {};
    intent.params.deviceId = deviceId;
    
    const result = await execute(intent, attachment);
    
    const responseText = result.message || result.reply || JSON.stringify(result);
    res.json({ text: responseText, intent, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /followup — context followups
app.post("/followup", async (req, res) => {
  try {
    const { followUpContext, answer, deviceId } = req.body;
    if (!followUpContext || !answer) {
      return res.status(400).json({ error: "followUpContext and answer required" });
    }
    const result = await handleFollowUp(followUpContext, answer, deviceId);
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

if (ENABLE_WHISPER) {
  // POST /transcribe/wake — high-speed wake word transcription
  app.post("/transcribe/wake", upload.single("audio"), async (req, res) => {
    let tempPath = null;
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file provided" });
      }

      const tempDir = path.join(__dirname, "temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      tempPath = path.join(tempDir, "wake_audio.wav");
      
      // Move upload file to target wav file
      fs.renameSync(req.file.path, tempPath);

      // Perform fast request to Python Flask server on port 5002 with 3s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const flaskRes = await fetch("http://localhost:5002/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioPath: tempPath, mode: "wake" }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await flaskRes.json();

      // Clean up temp file immediately after transcription
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      tempPath = null;

      res.json({ transcript: data.transcript || data.text || "" });

    } catch (error) {
      if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      console.error("[FRIDAY WHISPER ERROR] Wake transcription failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /transcribe
  app.post("/transcribe", upload.single("audio"), async (req, res) => {
    if (!whisperReady) {
      return res.status(503).json({ error: 'Whisper not ready' });
    }
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
          const result = await handleFollowUp(followUpContext, text, req.body.deviceId);
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
        /(?:hey|hello|hi|ok|okay|here|if)\s*(?:friday|f\.?r\.?i\.?d\.?a\.?y)/i,
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

// GET /api/api-status — fetch configurations and exhaustion states for slots
app.get("/api/api-status", (req, res) => {
  try {
    const { getExhaustionStatus } = require("./aiQuery");
    const { geminiExhausted, openaiExhausted } = getExhaustionStatus();
    
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    res.json({
      gemini: {
        configured: !!geminiKey,
        exhausted: geminiExhausted,
        masked: geminiKey ? `${geminiKey.substring(0, 7)}...${geminiKey.substring(geminiKey.length - 4)}` : null
      },
      openai: {
        configured: !!openaiKey,
        exhausted: openaiExhausted,
        masked: openaiKey ? `${openaiKey.substring(0, 7)}...${openaiKey.substring(openaiKey.length - 4)}` : null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/save-keys — persistently update slots, write to .env, and update memory
app.post("/api/save-keys", async (req, res) => {
  try {
    const { geminiApiKey, openaiApiKey } = req.body;
    
    if (geminiApiKey !== undefined) {
      process.env.GEMINI_API_KEY = geminiApiKey;
    }
    if (openaiApiKey !== undefined) {
      process.env.OPENAI_API_KEY = openaiApiKey;
    }

    const { resetExhaustion } = require("./aiQuery");
    resetExhaustion();

    const envPath = path.join(__dirname, ".env");
    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf8");
    }

    let lines = envContent.split(/\r?\n/);
    let hasGemini = false;
    let hasOpenai = false;

    lines = lines.map(line => {
      if (line.startsWith("GEMINI_API_KEY=")) {
        hasGemini = true;
        return `GEMINI_API_KEY=${geminiApiKey || ""}`;
      }
      if (line.startsWith("OPENAI_API_KEY=")) {
        hasOpenai = true;
        return `OPENAI_API_KEY=${openaiApiKey || ""}`;
      }
      return line;
    });

    if (!hasGemini && geminiApiKey !== undefined) {
      lines.push(`GEMINI_API_KEY=${geminiApiKey}`);
    }
    if (!hasOpenai && openaiApiKey !== undefined) {
      lines.push(`OPENAI_API_KEY=${openaiApiKey}`);
    }

    fs.writeFileSync(envPath, lines.join("\n"), "utf8");

    res.json({ ok: true, message: "API credentials successfully updated in system." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.use((err, req, res, next) => {
  console.error('[FRIDAY ERROR]', err.message)
  res.status(500).json({ error: err.message })
})

app.listen(PORT, () => {
  console.log(`[FRIDAY] Backend running on port ${PORT}`)
  console.log(`[FRIDAY] Whisper enabled: ${ENABLE_WHISPER}`)
})

process.on('uncaughtException', (err) => {
  console.error('[FRIDAY CRASH]', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[FRIDAY REJECTION]', reason)
})
