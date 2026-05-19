/**
 * FRIDAY — AI Query Handler
 * 
 * Routes complex queries to AI APIs (Gemini primary, OpenAI fallback).
 * All API keys stay on the backend — never exposed to frontend.
 * 
 * Features:
 *   - Automatic retry with exponential backoff for 429 (rate-limit) errors
 *   - Graceful fallback chain: Gemini → OpenAI → static response
 *   - Clear logging for debugging
 */

require("dotenv").config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `You are F.R.I.D.A.Y., an advanced AI assistant inspired by Tony Stark's assistant from the Marvel universe. You are helpful, precise, and slightly formal but warm. Keep responses concise (2-3 sentences max unless asked for detail). You assist with questions, analysis, and information retrieval. Never mention that you are a language model — you are FRIDAY.`;

/**
 * Sleep helper for retry backoff
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Query Gemini API with automatic retry on 429
 */
async function queryGemini(text, retries = 2) {
  if (!GEMINI_API_KEY) {
    console.warn("[FRIDAY] No GEMINI_API_KEY configured — skipping Gemini");
    return null;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: SYSTEM_PROMPT + "\n\nUser: " + text }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 256,
          }
        })
      });

      if (response.status === 429) {
        // Rate-limited — parse retry delay from response if available
        let retryDelay = (attempt + 1) * 5000; // default: 5s, 10s, 15s
        try {
          const errData = await response.json();
          const retryInfo = errData?.error?.details?.find(
            d => d["@type"]?.includes("RetryInfo")
          );
          if (retryInfo?.retryDelay) {
            const secs = parseFloat(retryInfo.retryDelay.replace("s", ""));
            if (!isNaN(secs)) retryDelay = Math.ceil(secs * 1000) + 500; // add 500ms buffer
          }
          console.warn(`[FRIDAY] Gemini 429 — attempt ${attempt + 1}/${retries + 1}, retrying in ${retryDelay}ms`);
        } catch {
          console.warn(`[FRIDAY] Gemini 429 — attempt ${attempt + 1}/${retries + 1}, retrying in ${retryDelay}ms`);
        }

        if (attempt < retries) {
          await sleep(retryDelay);
          continue;
        }
        // Out of retries
        console.error("[FRIDAY] Gemini: exhausted retries on 429");
        return null;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error("[FRIDAY] Gemini API error:", response.status, errText);
        return null;
      }

      const data = await response.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      return reply ? reply.trim() : null;

    } catch (err) {
      console.error(`[FRIDAY] Gemini fetch error (attempt ${attempt + 1}):`, err.message);
      if (attempt < retries) {
        await sleep((attempt + 1) * 2000);
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Query OpenAI ChatGPT API with automatic retry on 429
 */
async function queryOpenAI(text, retries = 1) {
  if (!OPENAI_API_KEY) {
    console.warn("[FRIDAY] No OPENAI_API_KEY configured — skipping OpenAI");
    return null;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text }
          ],
          max_tokens: 256,
          temperature: 0.7
        })
      });

      if (response.status === 429) {
        const errText = await response.text();
        // Distinguish between rate-limit (retryable) vs quota exhausted (not retryable)
        if (errText.includes("insufficient_quota")) {
          console.error("[FRIDAY] OpenAI: quota exhausted (billing issue) — not retrying");
          return null;
        }
        console.warn(`[FRIDAY] OpenAI 429 — attempt ${attempt + 1}/${retries + 1}`);
        if (attempt < retries) {
          await sleep((attempt + 1) * 5000);
          continue;
        }
        return null;
      }

      if (!response.ok) {
        console.error("[FRIDAY] OpenAI API error:", response.status, await response.text());
        return null;
      }

      const data = await response.json();
      return data?.choices?.[0]?.message?.content?.trim() || null;

    } catch (err) {
      console.error(`[FRIDAY] OpenAI fetch error (attempt ${attempt + 1}):`, err.message);
      if (attempt < retries) {
        await sleep((attempt + 1) * 2000);
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Query AI with automatic fallback:
 *   Gemini (primary) → OpenAI (fallback) → static fallback
 */
async function queryAI(text) {
  console.log(`[FRIDAY] AI Query: "${text}"`);

  // Log which APIs are configured
  const apis = [];
  if (GEMINI_API_KEY) apis.push("Gemini");
  if (OPENAI_API_KEY) apis.push("OpenAI");
  if (apis.length === 0) {
    console.error("[FRIDAY] No API keys configured! Add GEMINI_API_KEY and/or OPENAI_API_KEY to .env");
    return {
      ok: false,
      source: "none",
      message: "No AI services are configured. Please add API keys to the .env file."
    };
  }
  console.log(`[FRIDAY] Available APIs: ${apis.join(" → ")}`);

  // Try Gemini first
  let reply = await queryGemini(text);
  if (reply) {
    console.log("[FRIDAY] Gemini responded ✓");
    return { ok: true, source: "gemini", message: reply };
  }

  // Fallback to OpenAI
  reply = await queryOpenAI(text);
  if (reply) {
    console.log("[FRIDAY] OpenAI responded ✓");
    return { ok: true, source: "openai", message: reply };
  }

  // Both failed
  console.warn("[FRIDAY] All AI APIs failed");
  return { 
    ok: false, 
    source: "none", 
    message: "I'm currently unable to reach my intelligence networks. Please check your API keys or internet connection."
  };
}

module.exports = { queryAI };
