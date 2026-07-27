// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\intentParser.js
/**
 * FRIDAY — Intent Classifier + Parser
 * 
 * Classifies text into:
 *   "command" → local execution (open app, call, search, etc.)
 *   "query"   → forward to AI API for intelligent response
 */

let currentMode = 'auto';

function getAIMode() {
  return currentMode;
}

function setAIMode(mode) {
  currentMode = mode;
}

// ── COMMAND PATTERNS ────────────────────────────────────────────────────────
// These are matched in order. First match wins.
const COMMAND_PATTERNS = [
  // ── SPOTIFY INTENTS ──
  { pattern: /^play\s+(.+)/i,                               intent: "SPOTIFY",    extract: m => ({ action: 'spotify_play', query: m[1].trim() }) },
  { pattern: /^(?:pause|stop\s+music|stop)$/i,              intent: "SPOTIFY",    extract: () => ({ action: 'spotify_pause' }) },
  { pattern: /^(?:next|skip)$/i,                            intent: "SPOTIFY",    extract: () => ({ action: 'spotify_next' }) },
  { pattern: /^(?:previous|go\s+back)$/i,                   intent: "SPOTIFY",    extract: () => ({ action: 'spotify_previous' }) },
  { pattern: /^(?:volume\s+up|louder)$/i,                   intent: "SPOTIFY",    extract: () => ({ action: 'spotify_volume', direction: 'up' }) },
  { pattern: /^(?:volume\s+down|quieter)$/i,                 intent: "SPOTIFY",    extract: () => ({ action: 'spotify_volume', direction: 'down' }) },
  { pattern: /^(?:what's\s+playing|current\s+song|what\s+song\s+is\s+this)$/i, intent: "SPOTIFY", extract: () => ({ action: 'spotify_current' }) },

  { pattern: /^(?:open|launch|start|run)\s+(.+)/i,          intent: "OPEN_APP",   extract: m => ({ app: m[1].trim() }) },
  { pattern: /^(?:close|quit|exit|kill)\s+(.+)/i,           intent: "CLOSE_APP",  extract: m => ({ app: m[1].trim() }) },
  { pattern: /^call\s+(.+)/i,                               intent: "CALL",       extract: m => ({ contact: m[1].trim() }) },
  { pattern: /^(?:text|message|sms|send message to)\s+(.+)/i, intent: "MESSAGE",  extract: m => ({ contact: m[1].trim() }) },
  { pattern: /^search\s+(?:for\s+)?(.+)/i,                  intent: "SEARCH",     extract: m => ({ query: m[1].trim() }) },
  { pattern: /^(?:google|look up|find)\s+(.+)/i,            intent: "SEARCH",     extract: m => ({ query: m[1].trim() }) },
  { pattern: /^remind(?:er)?\s*(?:me)?\s+(?:to\s+)?(.+)/i,  intent: "REMINDER",   extract: m => ({ task: m[1].trim() }) },
  { pattern: /^(?:set\s+)?(?:a\s+)?timer\s+(?:for\s+)?(.+)/i, intent: "TIMER",    extract: m => ({ duration: m[1].trim() }) },
  { pattern: /^(?:set\s+)?(?:an?\s+)?alarm\s+(?:for\s+)?(.+)/i, intent: "ALARM",  extract: m => ({ time: m[1].trim() }) },
  { pattern: /^(?:play|pause|stop|next|previous|skip)\s*(.*)/i, intent: "MEDIA",  extract: m => ({ action: m[0].split(/\s/)[0].toLowerCase(), target: (m[1] || "").trim() }) },
  { pattern: /^(?:volume)\s+(up|down|mute|unmute|\d+)/i,    intent: "VOLUME",     extract: m => ({ level: m[1].trim() }) },
  { pattern: /^(?:brightness)\s+(up|down|\d+)/i,            intent: "BRIGHTNESS", extract: m => ({ level: m[1].trim() }) },
  { pattern: /^(?:screenshot|screen\s*shot|capture\s*screen)/i, intent: "SCREENSHOT", extract: () => ({}) },
  { pattern: /^(?:shut\s*down|restart|reboot|sleep|lock)/i, intent: "SYSTEM",     extract: m => ({ action: m[0].toLowerCase().replace(/\s+/g, '') }) },
  { pattern: /weather\s*(?:in\s+(.+))?/i,                   intent: "WEATHER",    extract: m => ({ location: (m[1] || "current").trim() }) },
  { pattern: /^(?:what(?:'s| is) the )?time|clock/i,        intent: "GET_TIME",   extract: () => ({}) },
  { pattern: /^(?:what(?:'s| is) the )?date|today/i,        intent: "GET_DATE",   extract: () => ({}) },
];

// ── COMMAND KEYWORDS ────────────────────────────────────────────────────────
// Fast pre-check: if the text starts with any of these, it's likely a command
const COMMAND_KEYWORDS = [
  "open", "launch", "start", "run", "close", "quit", "exit", "kill",
  "call", "text", "message", "sms", "send",
  "search", "google", "look", "find",
  "remind", "timer", "alarm",
  "play", "pause", "stop", "next", "previous", "skip",
  "volume", "brightness", "screenshot",
  "shutdown", "shut", "restart", "reboot", "sleep", "lock",
  "weather", "time", "date", "clock"
];

/**
 * Clean up raw text from Whisper and strip wake words.
 * Handles: punctuation, wake words, filler words.
 * 
 * Examples:
 *   ", hey Friday, please open Spotify." → "open Spotify"
 *   "Hey Friday can you open Chrome?"    → "open Chrome"
 *   "Friday, close the browser."         → "close the browser"
 *   "please search for cats"             → "search for cats"
 */
function stripWakeWords(text) {
  let cleaned = text
    // 1. Remove leading/trailing punctuation and whitespace (Whisper artifacts)
    .replace(/^[\s,.\-!?;:'"]+/, "")
    .replace(/[\s,.\-!?;:'"]+$/, "")
    .trim();

  // 2. Remove wake words: "Hey Friday", "if Friday", "Friday", "FRIDAY", "F.R.I.D.A.Y."
  cleaned = cleaned
    .replace(/^(?:(?:hey|if)\s+)?(?:friday|f\.?r\.?i\.?d\.?a\.?y\.?)\s*[,.]?\s*/i, "")
    .trim();

  // 3. Remove greetings: "okay", "ok", "hey", "hi", "hello", "yo"
  cleaned = cleaned
    .replace(/^(?:okay|ok|hey|hi|hello|yo)\s*[,.]?\s*/i, "")
    .trim();

  // 4. Remove filler/polite words: "please", "can you", "could you", "would you", "just", "kindly"
  cleaned = cleaned
    .replace(/^(?:please|pls|kindly)\s*[,.]?\s*/i, "")
    .replace(/^(?:can|could|would|will)\s+you\s+(?:please\s+)?/i, "")
    .replace(/^(?:i\s+want\s+(?:you\s+)?to|i\s+need\s+you\s+to)\s+/i, "")
    .replace(/^just\s+/i, "")
    .trim();

  // 5. Final cleanup: remove any remaining leading punctuation
  cleaned = cleaned.replace(/^[\s,.\-!?;:'"]+/, "").trim();

  return cleaned;
}

/**
 * Classify whether the input is a local command or an AI query.
 * @param {string} text - The user's spoken/typed text
 * @returns {"command" | "query"}
 */
function classifyIntent(text) {
  const lower = stripWakeWords(text).toLowerCase().trim();
  
  // 1. Check if it matches any command pattern
  for (const { pattern } of COMMAND_PATTERNS) {
    if (pattern.test(lower)) return "command";
  }
  
  // 2. Check if it starts with a command keyword
  const firstWord = lower.split(/\s+/)[0];
  if (COMMAND_KEYWORDS.includes(firstWord)) return "command";
  
  // 3. Everything else → AI query
  return "query";
}

/**
 * Parse text into a structured intent object.
 * @param {string} text - The user's spoken/typed text
 * @returns {{ intent: string, type: "command"|"query", params: object, raw: string }}
 */
function parseIntent(text) {
  const transcript = stripWakeWords(text);
  const lower = transcript.toLowerCase().trim();

  // Priority Spotify Voice Intent Detection
  if (lower.startsWith('play ') || lower.includes('play me ') || lower.includes('put on ')) {
    const query = lower.replace(/^play me|^play|put on/i, '').trim();
    return { intent: "SPOTIFY", type: "command", params: { action: 'spotify_play', query }, raw: text };
  }
  if (lower.includes('pause') || lower.includes('stop the music') || lower.includes('stop music')) {
    return { intent: "SPOTIFY", type: "command", params: { action: 'spotify_pause' }, raw: text };
  }
  if (lower.includes('next song') || lower.includes('skip') || lower.includes('next track')) {
    return { intent: "SPOTIFY", type: "command", params: { action: 'spotify_next' }, raw: text };
  }
  if (lower.includes('previous') || lower.includes('go back') || lower.includes('last song')) {
    return { intent: "SPOTIFY", type: "command", params: { action: 'spotify_previous' }, raw: text };
  }
  if (lower.includes('volume up') || lower.includes('louder') || lower.includes('turn it up')) {
    return { intent: "SPOTIFY", type: "command", params: { action: 'spotify_volume', direction: 'up' }, raw: text };
  }
  if (lower.includes('volume down') || lower.includes('quieter') || lower.includes('turn it down')) {
    return { intent: "SPOTIFY", type: "command", params: { action: 'spotify_volume', direction: 'down' }, raw: text };
  }
  if (lower.includes("what's playing") || lower.includes('what is playing') || lower.includes('current song')) {
    return { intent: "SPOTIFY", type: "command", params: { action: 'spotify_current' }, raw: text };
  }

  // ── DUAL-AI VOICE INTENT DETECTION ──
  if (lower.includes('clear history') || lower.includes('forget conversation') || lower.includes('start over')) {
    return { action: 'ai_clear_history', intent: 'AI_CLEAR_HISTORY', type: 'command', raw: text };
  }
  if (lower.includes('switch to gemini') || lower.includes('use gemini')) {
    return { action: 'ai_set_mode', mode: 'gemini', intent: 'AI_SET_MODE', type: 'command', raw: text };
  }
  if (lower.includes('switch to openai') || lower.includes('use chatgpt') || lower.includes('use openai')) {
    return { action: 'ai_set_mode', mode: 'openai', intent: 'AI_SET_MODE', type: 'command', raw: text };
  }
  if (lower.includes('use both') || lower.includes('merged mode') || lower.includes('best answer')) {
    return { action: 'ai_set_mode', mode: 'merged', intent: 'AI_SET_MODE', type: 'command', raw: text };
  }
  if (lower.includes('use auto') || lower.includes('automatic mode')) {
    return { action: 'ai_set_mode', mode: 'auto', intent: 'AI_SET_MODE', type: 'command', raw: text };
  }

  const type = classifyIntent(text);
  const cleaned = stripWakeWords(text);
  
  if (type === "command") {
    for (const { pattern, intent, extract } of COMMAND_PATTERNS) {
      const match = cleaned.match(pattern);
      if (match) {
        return { intent, type: "command", params: extract(match), raw: text };
      }
    }
  }
  
  // ── AGENT VOICE TRIGGERS ──
  const agentTriggers = [
    'research for me', 'deep dive into', 'investigate',
    'give me a full report on', 'analyze in detail',
    'what are the latest papers on', 'summarize everything about',
    'compare and contrast', 'find everything about',
    'intelligence report on', 'run analysis on'
  ];
  if (agentTriggers.some(t => lower.includes(t))) {
    return { action: 'agent_query', query: transcript, forceAgent: true, intent: 'AGENT_QUERY', type: 'command', raw: text };
  }

  const agentFollowupTriggers = [
    'go deeper', 'tell me more about that', 'expand on',
    'what else did you find'
  ];
  if (agentFollowupTriggers.some(t => lower.includes(t))) {
    return { action: 'agent_followup', query: transcript, intent: 'AGENT_FOLLOWUP', type: 'command', raw: text };
  }

  // If classified as query, or no pattern matched
  return { action: 'ai_query', query: transcript, mode: currentMode, intent: 'AI_QUERY', type: 'query', raw: text };
}

module.exports = { parseIntent, classifyIntent, stripWakeWords, getAIMode, setAIMode };
