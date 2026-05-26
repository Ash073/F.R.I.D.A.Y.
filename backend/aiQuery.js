// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\aiQuery.js

require('dotenv').config()
const { GoogleGenerativeAI } = require('@google/generative-ai')
const OpenAI = require('openai')
const { CohereClient } = require('cohere-ai')

const geminiClient = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null

const groqClient = process.env.GROQ_API_KEY
  ? new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1'
    })
  : null

const cohereClient = process.env.COHERE_API_KEY
  ? new CohereClient({ token: process.env.COHERE_API_KEY })
  : null

const mistralConfig = process.env.MISTRAL_API_KEY
  ? {
      apiKey: process.env.MISTRAL_API_KEY,
      url: 'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3'
    }
  : null

const FRIDAY_SYSTEM_PROMPT = "You are FRIDAY, an advanced AI assistant built into a cinematic personal AI operating system. You are calm, precise, intelligent, and slightly warm in tone. You never say you are ChatGPT, Gemini, or any other AI — you are always FRIDAY. You give accurate, helpful, concise answers. For simple questions answer in 2 to 3 sentences. For complex questions give structured clear answers. You never use excessive filler phrases like 'Great question' or 'As an AI language model'. You speak like a premium intelligent assistant, not a chatbot. When asked who you are, say: I am FRIDAY, your personal AI system.";

const conversationHistory = [];

let geminiExhausted = false;
let openaiExhausted = false;

function getExhaustionStatus() {
  return {
    geminiExhausted,
    openaiExhausted
  };
}

function resetExhaustion() {
  geminiExhausted = false;
  openaiExhausted = false;
}

function isRateLimitError(error) {
  const msg = (error?.message || '').toLowerCase();
  const status = error?.status;
  return (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('quota exceeded') ||
    msg.includes('too many requests') ||
    msg.includes('resource exhausted') ||
    msg.includes('resource_exhausted')
  );
}

function isAPIKeyError(error) {
  const msg = (error?.message || '').toLowerCase();
  const status = error?.status;
  return (
    status === 401 ||
    status === 403 ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('invalid api key') ||
    msg.includes('unauthorized') ||
    msg.includes('api key not valid')
  );
}

const apiCooldowns = {
  gemini:  { exhausted: false, until: null },
  groq:    { exhausted: false, until: null },
  cohere:  { exhausted: false, until: null },
  mistral: { exhausted: false, until: null }
}

function markExhausted(apiName, minutes) {
  apiCooldowns[apiName].exhausted = true;
  apiCooldowns[apiName].until = Date.now() + (minutes * 60 * 1000);
  console.log(`[FRIDAY AI] ${apiName} marked exhausted for ${minutes} minutes`);
}

function isExhausted(apiName) {
  if (!apiCooldowns[apiName].exhausted) return false;
  if (Date.now() > apiCooldowns[apiName].until) {
    apiCooldowns[apiName].exhausted = false;
    apiCooldowns[apiName].until = null;
    console.log(`[FRIDAY AI] ${apiName} cooldown expired — back online`);
    return false;
  }
  return true;
}

const SYSTEM_PROMPT = `You are F.R.I.D.A.Y., an advanced AI assistant inspired by Tony Stark's assistant from the Marvel universe. You are helpful, precise, and slightly formal but warm. Keep responses concise (2-3 sentences max unless asked for detail). You assist with questions, analysis, and information retrieval. Never mention that you are a language model — you are FRIDAY.`;

/**
 * Sleep helper for retry backoff
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Query Gemini API with automatic retry on 429 (Legacy)
 */
async function queryGeminiLegacy(text, retries = 2) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.warn("[FRIDAY] No GEMINI_API_KEY configured — skipping Gemini");
    return null;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
      
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
        geminiExhausted = true;
        let retryDelay = (attempt + 1) * 5000;
        try {
          const errData = await response.json();
          const retryInfo = errData?.error?.details?.find(
            d => d["@type"]?.includes("RetryInfo")
          );
          if (retryInfo?.retryDelay) {
            const secs = parseFloat(retryInfo.retryDelay.replace("s", ""));
            if (!isNaN(secs)) retryDelay = Math.ceil(secs * 1000) + 500;
          }
          console.warn(`[FRIDAY] Gemini 429 — attempt ${attempt + 1}/${retries + 1}, retrying in ${retryDelay}ms`);
        } catch {
          console.warn(`[FRIDAY] Gemini 429 — attempt ${attempt + 1}/${retries + 1}, retrying in ${retryDelay}ms`);
        }

        if (attempt < retries) {
          await sleep(retryDelay);
          continue;
        }
        console.error("[FRIDAY] Gemini: exhausted retries on 429");
        return null;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error("[FRIDAY] Gemini API error:", response.status, errText);
        if (response.status === 400 || response.status === 403 || response.status === 401) {
          geminiExhausted = true;
        }
        return null;
      }

      const data = await response.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) {
        geminiExhausted = false;
      }
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
 * Query OpenAI ChatGPT API with automatic retry on 429 (Legacy)
 */
async function queryOpenAILegacy(text, retries = 1) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.warn("[FRIDAY] No OPENAI_API_KEY configured — skipping OpenAI");
    return null;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openaiKey}`
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
        openaiExhausted = true;
        const errText = await response.text();
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
        if (response.status === 401 || response.status === 403) {
          openaiExhausted = true;
        }
        return null;
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (reply) {
        openaiExhausted = false;
      }
      return reply || null;

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
 * Query AI with automatic fallback (Legacy)
 */
async function queryAI(text) {
  console.log(`[FRIDAY] AI Query: "${text}"`);

  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const apis = [];
  if (geminiKey) apis.push("Gemini");
  if (openaiKey) apis.push("OpenAI");
  if (apis.length === 0) {
    console.error("[FRIDAY] No API keys configured!");
    return {
      ok: false,
      source: "none",
      message: "No AI services are configured. Please add API keys to settings."
    };
  }
  console.log(`[FRIDAY] Available APIs: ${apis.join(" → ")}`);

  // Try Gemini first
  let reply = await queryGeminiLegacy(text);
  if (reply) {
    console.log("[FRIDAY] Gemini responded ✓");
    return { ok: true, source: "gemini", message: reply };
  }

  // Fallback to OpenAI
  reply = await queryOpenAILegacy(text);
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

/**
 * SECTION B — async function queryGemini(userMessage, attachment = null) {
  if (!geminiClient) throw new Error('Gemini not configured');
  if (isExhausted('gemini')) throw new Error('Gemini is on cooldown');
  try {
    const model = geminiClient.getGenerativeModel({
      model: 'gemini-1.5-pro',
      systemInstruction: FRIDAY_SYSTEM_PROMPT
    });

    const history = conversationHistory.map(entry => ({
      role: entry.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: entry.content }]
    }));

    const chat = model.startChat({
      history: history
    });

    let messageContent;
    if (attachment) {
      messageContent = [
        { text: userMessage },
        {
          inlineData: {
            data: attachment.base64.split(',')[1] || attachment.base64,
            mimeType: attachment.mimeType
          }
        }
      ];
    } else {
      messageContent = userMessage;
    }

    const result = await chat.sendMessage(messageContent);
    return result.response.text();
  } catch (err) {
    if (isRateLimitError(err)) {
      markExhausted('gemini', 60);
    }
    if (err.message.includes('not found') || err.message.includes('404')) {
      console.warn('[FRIDAY AI] gemini-1.5-pro not found or retired. Retrying with gemini-2.0-flash fallback...');
      try {
        const fallbackModel = geminiClient.getGenerativeModel({
          model: 'gemini-2.0-flash',
          systemInstruction: FRIDAY_SYSTEM_PROMPT
        });
        const history = conversationHistory.map(entry => ({
          role: entry.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: entry.content }]
        }));
        const chat = fallbackModel.startChat({ history });
        
        let messageContent;
        if (attachment) {
          messageContent = [
            { text: userMessage },
            {
              inlineData: {
                data: attachment.base64.split(',')[1] || attachment.base64,
                mimeType: attachment.mimeType
              }
            }
          ];
        } else {
          messageContent = userMessage;
        }

        const result = await chat.sendMessage(messageContent);
        return result.response.text();
      } catch (fallbackErr) {
        if (isRateLimitError(fallbackErr)) {
          markExhausted('gemini', 60);
        }
        throw new Error('Gemini failed: ' + fallbackErr.message);
      }
    }
    throw new Error('Gemini failed: ' + err.message);
  }
}

/**
 * SECTION C — OpenAI Query Function
 */
async function queryOpenAI(userMessage, attachment = null) {
  try {
    const messages = [
      { role: 'system', content: FRIDAY_SYSTEM_PROMPT },
      ...conversationHistory,
    ];

    if (attachment && attachment.mimeType.startsWith('image/')) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userMessage },
          {
            type: 'image_url',
            image_url: {
              url: attachment.base64
            }
          }
        ]
      });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o',
      messages: messages,
      max_tokens: 1000,
      temperature: 0.7
    });

    return response.choices[0].message.content;
  } catch (err) {
    throw new Error('OpenAI failed: ' + err.message);
  }
}

async function queryGroq(userMessage) {
  if (!groqClient) throw new Error('Groq not configured');
  if (isExhausted('groq')) throw new Error('Groq is on cooldown');
  try {
    const messages = [
      { role: 'system', content: FRIDAY_SYSTEM_PROMPT },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    const response = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      max_tokens: 1000,
      temperature: 0.7
    });

    return response.choices[0].message.content;
  } catch (err) {
    if (isRateLimitError(err)) {
      markExhausted('groq', 60);
    }
    throw err;
  }
}

async function queryCohere(userMessage) {
  if (!cohereClient) throw new Error('Cohere not configured');
  if (isExhausted('cohere')) throw new Error('Cohere is on cooldown');
  try {
    const chatHistory = conversationHistory.map(entry => ({
      role: entry.role === 'assistant' ? 'CHATBOT' : 'USER',
      message: entry.content
    }));

    const response = await cohereClient.chat({
      model: 'command-r-plus-08-2024',
      chatHistory: chatHistory,
      message: userMessage,
      preamble: FRIDAY_SYSTEM_PROMPT,
      maxTokens: 1000,
      temperature: 0.7
    });

    return response.text;
  } catch (err) {
    if (isRateLimitError(err)) {
      markExhausted('cohere', 60);
    }
    throw err;
  }
}

async function queryMistral(userMessage) {
  if (!mistralConfig) throw new Error('Mistral not configured');
  if (isExhausted('mistral')) throw new Error('Mistral is on cooldown');
  try {
    const prompt = `<s>[INST] ${FRIDAY_SYSTEM_PROMPT}\n\nUser: ${userMessage} [/INST]`;
    const response = await fetch(mistralConfig.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mistralConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 500,
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Mistral API returned ${response.status}: ${errText}`);
    }

    const data = await response.json();
    let generatedText = data[0]?.generated_text || '';
    if (generatedText.startsWith(prompt)) {
      generatedText = generatedText.substring(prompt.length).trim();
    }
    return generatedText;
  } catch (err) {
    if (isRateLimitError(err)) {
      markExhausted('mistral', 30);
    }
    throw err;
  }
}

/**
 * SECTION D — Merged Query Function
 */
async function queryMerged(userMessage, attachment = null) {
  try {
    const promises = [];
    
    // Check Gemini
    if (geminiClient && !isExhausted('gemini')) {
      promises.push(
        queryGemini(userMessage, attachment)
          .then(val => ({ status: 'fulfilled', value: val }))
          .catch(err => {
            console.warn('[FRIDAY AI] Merged: Gemini call failed:', err.message);
            return { status: 'rejected', reason: err };
          })
      );
    } else {
      promises.push(Promise.resolve({ status: 'rejected', reason: new Error('Gemini not configured or exhausted') }));
    }

    // Check OpenAI
    if (openaiClient && !openaiExhausted) {
      promises.push(
        queryOpenAI(userMessage, attachment)
          .then(val => ({ status: 'fulfilled', value: val }))
          .catch(err => {
            console.warn('[FRIDAY AI] Merged: OpenAI call failed:', err.message);
            return { status: 'rejected', reason: err };
          })
      );
    } else {
      promises.push(Promise.resolve({ status: 'rejected', reason: new Error('OpenAI not configured or exhausted') }));
    }

    const [geminiResult, openaiResult] = await Promise.all(promises);

    const geminiText = geminiResult.status === 'fulfilled' ? geminiResult.value : null;
    const openaiText = openaiResult.status === 'fulfilled' ? openaiResult.value : null;

    if (!geminiText && !openaiText) {
      throw new Error('Both models failed or were skipped');
    }

    if (geminiText && !openaiText) {
      return geminiText;
    }
    if (!geminiText && openaiText) {
      return openaiText;
    }

    // Both succeeded, merge them using gemini-1.5-flash
    const mergePrompt = `Two AI responses have been generated for this user question: ${userMessage}

Response A: ${geminiText}
Response B: ${openaiText}

Your task: Combine the best parts of both responses into one single superior answer. Remove any redundancy. Keep it concise and accurate. Do not mention that you are merging responses. Just give the final answer as FRIDAY would — calm, precise, intelligent.`;

    let result;
    try {
      const model = geminiClient.getGenerativeModel({ model: 'gemini-1.5-flash' });
      result = await model.generateContent(mergePrompt);
    } catch (mergeErr) {
      if (mergeErr.message.includes('not found') || mergeErr.message.includes('404')) {
        console.warn('[FRIDAY AI] gemini-1.5-flash not found or retired. Retrying merge with gemini-2.0-flash...');
        const model = geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash' });
        result = await model.generateContent(mergePrompt);
      } else {
        throw mergeErr;
      }
    }
    return result.response.text();
  } catch (err) {
    throw new Error('Merged query failed: ' + err.message);
  }
}

/**
 * Smart AI Waterfall Query Function
 * Executes queries in strict priority order (Gemini → Groq → Cohere → Mistral).
 * Skips models that are unconfigured or on cooldown.
 */
async function waterfallQuery(userMessage, attachment = null) {
  const pipeline = [
    { name: 'gemini', label: 'Gemini', client: geminiClient, fn: (msg) => queryGemini(msg, attachment) },
    { name: 'groq', label: 'Groq', client: groqClient, fn: queryGroq },
    { name: 'cohere', label: 'Cohere', client: cohereClient, fn: queryCohere },
    { name: 'mistral', label: 'Mistral', client: mistralConfig, fn: queryMistral }
  ];

  for (const step of pipeline) {
    if (!step.client) {
      console.log(`[FRIDAY AI] Skipping ${step.label} (unconfigured)`);
      continue;
    }
    if (isExhausted(step.name)) {
      console.log(`[FRIDAY AI] Skipping ${step.label} (exhausted / on cooldown)`);
      continue;
    }

    try {
      console.log(`[FRIDAY AI] Trying ${step.label}...`);
      const response = await step.fn(userMessage);
      if (response) {
        console.log(`[FRIDAY AI] ${step.label} responded successfully.`);
        askFriday.lastUsedModel = step.label; // Store last used model
        return response;
      }
    } catch (err) {
      console.warn(`[FRIDAY AI] ${step.label} failed:`, err.message);
      if (isRateLimitError(err)) {
        markExhausted(step.name, step.name === 'mistral' ? 30 : 60);
      }
    }
  }

  throw new Error('All AI models in waterfall failed or were skipped.');
}

/**
 * SECTION E — Main Export Function
 */
async function askFriday(userMessage, mode = 'auto', attachment = null) {
  try {
    let response;
    let modelUsed = mode;

    if (mode === 'gemini') {
      try {
        response = await queryGemini(userMessage, attachment);
        modelUsed = 'Gemini';
      } catch (err) {
        console.warn('[FRIDAY AI] Gemini mode failed or rate-limited. Falling back to waterfall query...');
        response = await waterfallQuery(userMessage, attachment);
        modelUsed = askFriday.lastUsedModel || 'Waterfall';
      }
    } else if (mode === 'openai') {
      try {
        response = await queryOpenAI(userMessage, attachment);
        modelUsed = 'OpenAI';
      } catch (err) {
        console.warn('[FRIDAY AI] OpenAI mode failed or rate-limited. Falling back to waterfall query...');
        response = await waterfallQuery(userMessage, attachment);
        modelUsed = askFriday.lastUsedModel || 'Waterfall';
      }
    } else if (mode === 'groq') {
      try {
        response = await queryGroq(userMessage);
        modelUsed = 'Groq';
      } catch (err) {
        console.warn('[FRIDAY AI] Groq mode failed or rate-limited. Falling back to waterfall query...');
        response = await waterfallQuery(userMessage, attachment);
        modelUsed = askFriday.lastUsedModel || 'Waterfall';
      }
    } else if (mode === 'cohere') {
      try {
        response = await queryCohere(userMessage);
        modelUsed = 'Cohere';
      } catch (err) {
        console.warn('[FRIDAY AI] Cohere mode failed or rate-limited. Falling back to waterfall query...');
        response = await waterfallQuery(userMessage, attachment);
        modelUsed = askFriday.lastUsedModel || 'Waterfall';
      }
    } else if (mode === 'merged') {
      response = await queryMerged(userMessage, attachment);
      modelUsed = 'Merged';
    } else { // 'auto' (directly uses the waterfall)
      response = await waterfallQuery(userMessage, attachment);
      modelUsed = askFriday.lastUsedModel || 'Waterfall';
    }

    conversationHistory.push({ role: 'user', content: userMessage });
    conversationHistory.push({ role: 'assistant', content: response });
    if (conversationHistory.length > 20) {
      conversationHistory.splice(0, conversationHistory.length - 20);
    }

    console.log('[FRIDAY AI] Used:', modelUsed);
    askFriday.lastUsedModel = modelUsed;
    return response;
  } catch (err) {
    console.error('[FRIDAY AI] askFriday final error:', err.message);
    const gracefulError = "I'm currently unable to reach my intelligence networks. Please check your API keys or internet connection.";
    
    conversationHistory.push({ role: 'user', content: userMessage });
    conversationHistory.push({ role: 'assistant', content: gracefulError });
    if (conversationHistory.length > 20) {
      conversationHistory.splice(0, conversationHistory.length - 20);
    }
    
    askFriday.lastUsedModel = 'None';
    return gracefulError;
  }
}

function getAPIStatus() {
  return {
    gemini: {
      configured: !!geminiClient,
      exhausted: isExhausted('gemini')
    },
    groq: {
      configured: !!groqClient,
      exhausted: isExhausted('groq')
    },
    cohere: {
      configured: !!cohereClient,
      exhausted: isExhausted('cohere')
    },
    mistral: {
      configured: !!mistralConfig,
      exhausted: isExhausted('mistral')
    },
    openai: {
      configured: !!openaiClient,
      exhausted: openaiExhausted
    },
    lastUsedModel: askFriday.lastUsedModel || 'None'
  };
}

function clearHistory() {
  conversationHistory.length = 0;
}

function getHistory() {
  return [...conversationHistory];
}

module.exports = {
  queryAI,
  getExhaustionStatus,
  resetExhaustion,
  askFriday,
  clearHistory,
  getHistory,
  getAPIStatus
};
