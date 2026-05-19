/**
 * FRIDAY — Intent Classifier + Parser
 * 
 * Classifies text into:
 *   "command" → local execution (open app, call, search, etc.)
 *   "query"   → forward to AI API for intelligent response
 */

// ── COMMAND PATTERNS ────────────────────────────────────────────────────────
// These are matched in order. First match wins.
const COMMAND_PATTERNS = [
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

  // 2. Remove wake words: "Hey Friday", "Friday", "FRIDAY", "F.R.I.D.A.Y."
  cleaned = cleaned
    .replace(/^(?:hey\s+)?(?:friday|f\.?r\.?i\.?d\.?a\.?y\.?)\s*[,.]?\s*/i, "")
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
  
  // If classified as query, or no pattern matched
  return { intent: "QUERY", type: "query", params: { question: text }, raw: text };
}

module.exports = { parseIntent, classifyIntent, stripWakeWords };
