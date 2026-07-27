// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\fridayAgent.js

require('dotenv').config()
const { askFriday, getAPIStatus } = require('./aiQuery')
const { buildReport, buildQuickSummary, detectReportType } = require('./reportBuilder')
const {
  webSearch,
  wikipedia,
  arxivSearch,
  calculate,
  newsSearch,
  codeAnalyze,
  agentMemory
} = require('./agentTools')

const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS) || 8
const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS) || 120000

const AGENT_SYSTEM_PROMPT = `
You are FRIDAY, an advanced intelligence agent running inside a personal AI
operating system. You operate in a ReAct loop — you Reason about what to do,
then Act using available tools, then Observe the result, then Reason again.

You have access to these tools:
  web_search(query)         — Search the web for current information
  wikipedia(topic)          — Get a Wikipedia summary on any topic
  arxiv_search(query)       — Search academic papers on ArXiv
  calculate(expression)     — Evaluate a mathematical expression
  analyze_text(text, task)  — Analyze provided text for sentiment, summary, keywords
  fetch_url(url)            — Fetch and read the content of a specific URL
  remember(key, value)      — Store a piece of information for this session
  recall(key)               — Retrieve a stored piece of information
  news_search(topic)        — Get latest news on any topic
  code_analyze(code, language) — Analyze code for bugs and improvements

To use a tool, respond with EXACTLY this format and nothing else on that line:
  TOOL: tool_name(argument)

After seeing the tool result, continue reasoning.
When you have a complete answer, respond with:
  FINAL: your complete structured answer here

Rules:
- Always reason before acting
- Never fabricate tool results — wait for actual results
- If a tool fails try an alternative approach
- Maximum ${MAX_ITERATIONS} tool calls per query
- Always cite sources in your final answer
- Structure final answers with clear headings and sections
- You are FRIDAY — never mention Gemini, GPT, or any underlying model
`

// Cache for tools
const toolCache = new Map();
// Session context
const sessionContext = new Map();

async function dispatchTool(toolCall) {
  try {
    const match = toolCall.match(/^([a-zA-Z0-9_]+)\(([\s\S]*)\)$/);
    if (!match) {
      return { success: false, result: 'Invalid tool call format: ' + toolCall };
    }
    
    const toolName = match[1];
    const argsStr = match[2];
    
    const cacheKey = toolName + ':' + argsStr;
    const cached = toolCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 5 * 60 * 1000)) {
      console.log('[FRIDAY AGENT] Cache hit: ' + cacheKey);
      return cached.result;
    }

    console.log('[FRIDAY AGENT] Tool called: ' + toolCall);
    
    let result;
    switch (toolName) {
      case 'web_search':
        result = await webSearch(argsStr); break;
      case 'wikipedia':
        result = await wikipedia(argsStr); break;
      case 'arxiv_search':
        result = await arxivSearch(argsStr); break;
      case 'calculate':
        result = await calculate(argsStr); break;
      case 'news_search':
        result = await newsSearch(argsStr); break;
      case 'code_analyze':
        const caCommaIdx = argsStr.indexOf(',');
        if (caCommaIdx === -1) result = await codeAnalyze(argsStr, 'unknown');
        else result = await codeAnalyze(argsStr.substring(0, caCommaIdx).trim(), argsStr.substring(caCommaIdx + 1).trim());
        break;
      case 'analyze_text':
        const commaIdx = argsStr.indexOf(',');
        if (commaIdx === -1) {
          result = { success: false, result: 'analyze_text requires text, task' };
          break;
        }
        const textArg = argsStr.substring(0, commaIdx).trim();
        const taskArg = argsStr.substring(commaIdx + 1).trim();
        let prompt = '';
        const cleanTask = taskArg.toLowerCase();
        if (cleanTask === 'summarize') prompt = "Summarize this text in 3-5 bullet points:\n\n" + textArg;
        else if (cleanTask === 'sentiment') prompt = "Analyze the sentiment of this text. Return: positive/negative/neutral, confidence %, and key emotional indicators:\n\n" + textArg;
        else if (cleanTask === 'keywords') prompt = "Extract the 10 most important keywords and concepts from this text:\n\n" + textArg;
        else if (cleanTask === 'entities') prompt = "Extract all named entities (people, organizations, places, dates) from:\n\n" + textArg;
        else if (cleanTask === 'critique') prompt = "Provide a critical analysis identifying strengths, weaknesses, and gaps:\n\n" + textArg;
        else prompt = "Analyze this text:\n\n" + textArg;
        
        try {
          const aiRes = await askFriday(prompt, 'auto');
          result = { success: true, result: aiRes };
        } catch (e) {
          result = { success: false, result: 'Text analysis failed: ' + e.message };
        }
        break;
      case 'fetch_url':
        try {
          const cleanUrl = argsStr.trim();
          if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) throw new Error('Invalid URL protocol');
          const parsedUrl = new URL(cleanUrl);
          const hostname = parsedUrl.hostname;
          if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
            throw new Error('Private IP addresses are blocked');
          }
          const res = await fetch(cleanUrl, { timeout: 10000 });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          let text = await res.text();
          text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
          text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
          text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 2000);
          result = { success: true, result: text, source: cleanUrl };
        } catch(e) {
          result = { success: false, result: 'Could not fetch URL: ' + e.message };
        }
        break;
      case 'remember':
        const rCommaIdx = argsStr.indexOf(',');
        if (rCommaIdx === -1) result = { success: false, result: 'remember requires key, value' };
        else {
          agentMemory.set(argsStr.substring(0, rCommaIdx).trim(), argsStr.substring(rCommaIdx + 1).trim());
          result = { success: true, result: `Stored: ${argsStr}` };
        }
        break;
      case 'recall':
        const cleanKey = argsStr.trim();
        if (!agentMemory.has(cleanKey)) result = { success: false, result: 'No memory found for: ' + cleanKey };
        else result = { success: true, result: `Recalled: ${cleanKey} = ${agentMemory.get(cleanKey)}` };
        break;
      default:
        result = { success: false, result: 'Unknown tool: ' + toolName };
    }

    toolCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  } catch (err) {
    console.error('[FRIDAY AGENT] Tool dispatch error:', err);
    return { success: false, result: 'Error executing tool: ' + err.message };
  }
}

async function* runAgentLogic(userQuery) {
  let messages = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    { role: 'user', content: userQuery }
  ];
  let iterations = 0;
  let toolsUsed = [];
  let sources = [];
  const startTime = Date.now();

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    yield { type: 'thinking', text: `Reasoning... (step ${iterations})` };

    let promptText = messages.map(m => {
       if (m.role === 'system') return m.content + "\n";
       if (m.role === 'user') return "USER: " + m.content;
       if (m.role === 'assistant') return "FRIDAY: " + m.content;
       return m.content;
    }).join('\n\n');
    promptText += "\n\nContinue your ReAct reasoning. Use a tool or provide FINAL answer.";

    // RATE LIMIT AWARENESS
    const status = getAPIStatus();
    if (status.gemini && status.gemini.exhausted) {
      console.log('[FRIDAY AGENT] Primary AI exhausted — agent using fallback');
    }

    let agentResponse = "";
    try {
      agentResponse = await askFriday(promptText, 'auto');
    } catch (err) {
      yield { type: 'error', text: 'AI query failed: ' + err.message };
      break;
    }

    if (agentResponse.includes('FINAL:')) {
      const finalAnswer = agentResponse.split('FINAL:')[1].trim();
      
      const reportType = detectReportType(userQuery);
      const duration = Date.now() - startTime;
      const formattedReport = buildReport(finalAnswer, {
        query: userQuery,
        toolsUsed,
        sources,
        iterations,
        duration,
        modelUsed: 'FRIDAY Intelligence Engine'
      });
      
      const quickSummary = buildQuickSummary(finalAnswer);
      sessionContext.set('last_research_topic', userQuery);
      sessionContext.set('last_research_summary', quickSummary);
      sessionContext.set('last_research_sources', sources);
      sessionContext.set('last_research_time', Date.now());

      yield { type: 'final', text: formattedReport, toolsUsed, sources, iterations, reportType };
      return;
    }

    if (agentResponse.includes('TOOL:')) {
      const toolLines = agentResponse.split('\n').filter(line => line.trim().startsWith('TOOL:'));
      
      if (toolLines.length > 0) {
        // PARALLEL TOOL EXECUTION
        const toolCalls = toolLines.map(line => line.replace('TOOL:', '').trim());
        
        for (const tc of toolCalls) {
          yield { type: 'tool', text: 'Using tool: ' + tc };
          const match = tc.match(/^([a-zA-Z0-9_]+)\(/);
          if (match && !toolsUsed.includes(match[1])) {
            toolsUsed.push(match[1]);
          }
        }
        
        const results = await Promise.allSettled(toolCalls.map(tc => dispatchTool(tc)));
        
        let combinedObservation = '';
        results.forEach((res, idx) => {
          if (res.status === 'fulfilled') {
            const tr = res.value;
            if (tr.source && !sources.includes(tr.source)) sources.push(tr.source);
            combinedObservation += `[Result from ${toolCalls[idx]}]:\n${tr.result}\n\n`;
          } else {
            combinedObservation += `[Result from ${toolCalls[idx]}]:\nFailed: ${res.reason}\n\n`;
          }
        });
        
        yield { type: 'observation', text: 'Tool results received' };
        
        messages.push({ role: 'assistant', content: agentResponse });
        messages.push({ role: 'user', content: `OBSERVATION:\n${combinedObservation.trim()}` });
      }
      continue;
    }

    messages.push({ role: 'assistant', content: agentResponse });
  }

  // If exhausted
  const finalAnswer = "I have reached the maximum number of reasoning steps without a final conclusion. Based on my findings:\n\n" + messages[messages.length-1].content;
  const reportType = detectReportType(userQuery);
  const duration = Date.now() - startTime;
  const formattedReport = buildReport(finalAnswer, {
    query: userQuery,
    toolsUsed,
    sources,
    iterations,
    duration,
    modelUsed: 'FRIDAY Intelligence Engine'
  });
  
  const quickSummary = buildQuickSummary(finalAnswer);
  sessionContext.set('last_research_topic', userQuery);
  sessionContext.set('last_research_summary', quickSummary);
  sessionContext.set('last_research_sources', sources);
  sessionContext.set('last_research_time', Date.now());

  yield { type: 'final', text: formattedReport, toolsUsed, sources, iterations, reportType };
}

async function* runAgent(userQuery) {
  // TIMEOUT PROTECTION
  let isDone = false;
  let timeoutId;
  const generator = runAgentLogic(userQuery);
  
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({ type: 'timeout' });
    }, AGENT_TIMEOUT_MS);
  });

  try {
    while (!isDone) {
      const nextPromise = generator.next();
      const raceResult = await Promise.race([nextPromise, timeoutPromise]);
      
      if (raceResult && raceResult.type === 'timeout') {
        clearTimeout(timeoutId);
        yield { type: 'timeout', text: 'Analysis taking longer than expected' };
        
        // Force yield partial answer as final
        const formattedReport = buildReport("Analysis timed out. The operation was too complex to complete within the time limit.", {
          query: userQuery,
          toolsUsed: [],
          sources: [],
          iterations: 0,
          duration: AGENT_TIMEOUT_MS,
          modelUsed: 'FRIDAY Intelligence Engine'
        });
        yield { type: 'final', text: formattedReport, toolsUsed: [], sources: [], iterations: 0, reportType: 'general' };
        return;
      }
      
      if (raceResult.done) {
        isDone = true;
      } else {
        yield raceResult.value;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function needsAgentMode(query) {
  const lowercaseQuery = query.toLowerCase();
  const triggers = [
    'research', 'analyze', 'analysis', 'investigate', 'find out',
    'what are the latest', 'recent developments', 'compare', 'explain in detail',
    'give me a report', 'deep dive', 'summarize', 'what is happening with',
    'how does', 'why does', 'calculate', 'compute', 'how many', 'statistics',
    'papers on', 'studies about', 'news about', 'current state of',
    'pros and cons', 'advantages and disadvantages', 'step by step'
  ];
  
  if (triggers.some(trigger => lowercaseQuery.includes(trigger))) return true;
  if (query.length > 80) return true;
  if (lowercaseQuery.includes('http://') || lowercaseQuery.includes('https://')) return true;
  
  return false;
}

module.exports = {
  runAgent,
  needsAgentMode,
  dispatchTool,
  sessionContext
}
