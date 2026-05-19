const { runAction } = require("./actionEngine");
const { queryAI }   = require("./aiQuery");

// Fallback handlers for command intents not in the action engine
const FALLBACK = {
  SEARCH:      ({ query })    => ({ ok: true,  message: `Searching for "${query}"…`, url: `https://google.com/search?q=${encodeURIComponent(query)}` }),
  REMINDER:    ({ task })     => ({ ok: true,  message: `Reminder set: "${task}"` }),
  TIMER:       ({ duration }) => ({ ok: true,  message: `Timer set for ${duration}` }),
  ALARM:       ({ time })     => ({ ok: true,  message: `Alarm set for ${time}` }),
  WEATHER:     ({ location }) => ({ ok: true,  message: `Fetching weather for ${location}… (mock: 22°C, sunny)` }),
  GET_TIME:    ()             => ({ ok: true,  message: `Current time: ${new Date().toLocaleTimeString()}` }),
  GET_DATE:    ()             => ({ ok: true,  message: `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}` }),
  MEDIA:       ({ action, target }) => ({ ok: true, message: `${action}${target ? ' ' + target : ''}` }),
  VOLUME:      ({ level })    => ({ ok: true,  message: `Volume ${level}` }),
  BRIGHTNESS:  ({ level })    => ({ ok: true,  message: `Brightness ${level}` }),
  SCREENSHOT:  ()             => ({ ok: true,  message: `Screenshot captured` }),
  SYSTEM:      ({ action })   => ({ ok: true,  message: `System ${action} initiated` }),
  CLOSE_APP:   ({ app })      => ({ ok: true,  message: `Closing ${app}…` }),
  MESSAGE:     ({ contact })  => ({ ok: true,  message: `Preparing message to ${contact}…` }),
};

/**
 * Execute an intent — handles both commands and AI queries.
 * @param {object} intentObj - Parsed intent from intentParser
 * @returns {Promise<object>} - Result with { ok, message, type }
 */
async function execute(intentObj) {
  // ── AI QUERY PATH ─────────────────────────────────────────
  if (intentObj.type === "query") {
    console.log(`[FRIDAY] Routing to AI: "${intentObj.raw}"`);
    const aiResult = await queryAI(intentObj.raw);
    return { ...aiResult, type: "query" };
  }

  // ── COMMAND PATH ──────────────────────────────────────────
  console.log(`[FRIDAY] Executing command: ${intentObj.intent}`);

  // 1. Try action engine first (CALL, OPEN_APP, CLOSE_APP, SEARCH, …)
  const result = await runAction(intentObj);
  if (result) return { ...result, type: "command" };

  // 2. Fall back to simple handlers
  const handler = FALLBACK[intentObj.intent];
  if (handler) return { ...handler(intentObj.params, intentObj.raw), type: "command" };

  // 3. Nothing matched — send to AI as last resort
  console.log(`[FRIDAY] Unknown command, falling back to AI`);
  const aiResult = await queryAI(intentObj.raw);
  return { ...aiResult, type: "query" };
}

module.exports = { execute };
