// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\agentTools.js

require('dotenv').config();
const { askFriday } = require('./aiQuery');

const agentMemory = new Map();

async function fetchWithTimeout(url, options = {}) {
  const timeout = 8000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function webSearch(query) {
  try {
    let resultText = '';
    let sourceURL = '';
    let success = false;

    // TIER 1 — DuckDuckGo
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetchWithTimeout(url);
      const data = await res.json();
      
      let abstract = data.AbstractText || '';
      let sourceUrl = data.AbstractURL || '';
      
      let ddgText = '';
      if (abstract) {
        ddgText += `${abstract}\nSource: ${sourceUrl}\n\n`;
      }
      
      let relatedText = '';
      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        let count = 0;
        data.RelatedTopics.forEach(topic => {
          if (topic.Text && count < 5 && !topic.Name) { // Skip disambiguation topics that have a 'Name' field typically
            relatedText += `${topic.Text}, `;
            count++;
          }
        });
      }
      
      if (data.Results && data.Results.length > 0) {
        let count = 0;
        data.Results.forEach(res => {
          if (res.Text && count < 3) {
            ddgText += `${res.Text}\nSource: ${res.FirstURL}\n\n`;
            count++;
          }
        });
      }
      
      if (ddgText || relatedText) {
        resultText += ddgText;
        if (relatedText) {
          resultText += `Related: ${relatedText.slice(0, -2)}\n\n`;
        }
        sourceURL = sourceUrl || 'https://duckduckgo.com';
        success = true;
      }
    } catch (e) {
      console.warn('[FRIDAY AGENT] Tier 1 search failed:', e.message);
    }

    // TIER 2 — Wikipedia Search API
    if (!success) {
      try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`;
        const res = await fetchWithTimeout(url);
        const data = await res.json();
        
        if (data.query && data.query.search && data.query.search.length > 0) {
          const topResults = data.query.search;
          const topTitle = topResults[0].title;
          
          const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topTitle)}`;
          const sumRes = await fetchWithTimeout(sumUrl);
          const sumData = await sumRes.json();
          
          let wikiText = '';
          if (sumData.extract) {
            wikiText += `${sumData.extract}\nSource: ${sumData.content_urls?.desktop?.page || 'Wikipedia'}\n\n`;
            sourceURL = sumData.content_urls?.desktop?.page;
          }
          
          topResults.slice(1, 3).forEach(res => {
            const cleanSnippet = res.snippet.replace(/<[^>]+>/g, '');
            wikiText += `${res.title}: ${cleanSnippet}\nSource: https://en.wikipedia.org/wiki/${encodeURIComponent(res.title)}\n\n`;
          });
          
          if (wikiText) {
            resultText += wikiText;
            success = true;
          }
        }
      } catch (e) {
        console.warn('[FRIDAY AGENT] Tier 2 search failed:', e.message);
      }
    }

    // TIER 3 — SerpAPI
    if (!success && process.env.SERPAPI_KEY) {
      try {
        const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${process.env.SERPAPI_KEY}&num=5`;
        const res = await fetchWithTimeout(url);
        const data = await res.json();
        
        if (data.organic_results && data.organic_results.length > 0) {
          let serpText = '';
          data.organic_results.forEach((res, index) => {
            serpText += `[${index + 1}] ${res.title}\n${res.snippet || ''}\nSource: ${res.link}\n\n`;
            if (index === 0) sourceURL = res.link;
          });
          resultText += serpText;
          success = true;
        }
      } catch (e) {
        console.warn('[FRIDAY AGENT] Tier 3 search failed:', e.message);
      }
    }

    if (!success || !resultText) {
      return { success: false, result: 'Web search failed — no results found' };
    }

    const formattedString = `── WEB SEARCH: ${query} ──\n\n${resultText}`.trim();
    return { success: true, result: formattedString, source: sourceURL };

  } catch (err) {
    return { success: false, result: 'Web search failed — ' + err.message };
  }
}

async function wikipedia(topic) {
  try {
    // Step 1 - Search
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&format=json&srlimit=1`;
    const searchRes = await fetchWithTimeout(searchUrl);
    const searchData = await searchRes.json();
    
    if (!searchData.query || !searchData.query.search || searchData.query.search.length === 0) {
      return { success: false, result: 'Wikipedia: topic not found — ' + topic };
    }
    
    const title = searchData.query.search[0].title;
    
    // Step 2 - Fetch summary
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const sumRes = await fetchWithTimeout(summaryUrl);
    if (!sumRes.ok) throw new Error('Summary fetch failed');
    const sumData = await sumRes.json();
    
    const description = sumData.description || 'No description available';
    let extract = sumData.extract || 'No extract available';
    if (extract.length > 800) extract = extract.substring(0, 800) + '...';
    
    const pageUrl = sumData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
    
    const formattedString = `── WIKIPEDIA: ${title} ──\n\n${description}\n\n${extract}\n\nRead more: ${pageUrl}`;
    
    return { success: true, result: formattedString, source: pageUrl };
  } catch (err) {
    return { success: false, result: 'Wikipedia: lookup error — ' + err.message };
  }
}

async function arxivSearch(query) {
  try {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=4&sortBy=submittedDate&sortOrder=descending`;
    const res = await fetchWithTimeout(url);
    const xml = await res.text();
    
    const entries = xml.split('<entry>').slice(1);
    if (entries.length === 0) return { success: false, result: 'ArXiv search failed — no papers found' };
    
    let formattedString = `── ARXIV PAPERS: ${query} ──\n\n`;
    
    entries.forEach((entry, idx) => {
      let title = (entry.match(/<title>([\s\S]*?)<\/title>/) || ['', 'Unknown Title'])[1].replace(/\n/g, ' ').trim();
      let summary = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || ['', 'No summary'])[1].replace(/\n/g, ' ').trim();
      if (summary.length > 200) summary = summary.substring(0, 200) + '...';
      
      let author = (entry.match(/<author>\s*<name>([\s\S]*?)<\/name>/) || ['', 'Unknown Author'])[1].trim();
      let published = (entry.match(/<published>([\s\S]*?)<\/published>/) || ['', 'Unknown Date'])[1].split('T')[0];
      let idUrl = (entry.match(/<id>([\s\S]*?)<\/id>/) || ['', ''])[1].trim();
      
      formattedString += `[${idx + 1}] ${title} (${published})\n    By: ${author}\n    ${summary}\n    Link: ${idUrl}\n\n`;
    });
    
    return { success: true, result: formattedString.trim(), source: 'https://arxiv.org' };
  } catch (err) {
    return { success: false, result: 'ArXiv search failed — ' + err.message };
  }
}

async function calculate(expression) {
  try {
    // Step 1 - Sanitize
    let sanitized = expression.replace(/[^0-9.\+\-\*\/\(\)\%\^\s\e\E]/g, '');
    if (sanitized !== expression.trim()) {
      return { success: false, result: 'Invalid characters in expression' };
    }
    
    // Step 2 - Pre-process
    let evalStr = sanitized.replace(/\^/g, '**');
    // Basic implicit multiplication 2(3) -> 2*(3)
    evalStr = evalStr.replace(/(\d)\s*\(/g, '$1*(');
    
    // Step 3 - Evaluate safely
    const result = new Function('return (' + evalStr + ')')();
    
    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Not a finite number');
    }
    
    // Step 4 - Format result
    let finalResult = result;
    if (!Number.isInteger(result)) {
      finalResult = Number(result.toPrecision(6));
    }
    
    return { success: true, result: `${expression} = ${finalResult}` };
  } catch (err) {
    return { success: false, result: 'Failed to calculate expression' };
  }
}

async function newsSearch(topic) {
  try {
    if (process.env.NEWS_API_KEY) {
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&sortBy=publishedAt&pageSize=5&apiKey=${process.env.NEWS_API_KEY}`;
      const res = await fetchWithTimeout(url);
      const data = await res.json();
      
      if (data.articles && data.articles.length > 0) {
        let formattedString = `── NEWS: ${topic} ──\n\n`;
        data.articles.forEach((article, idx) => {
          const date = article.publishedAt ? article.publishedAt.split('T')[0] : '';
          formattedString += `[${idx + 1}] ${article.title || 'No Title'} — ${article.source?.name || 'Unknown'} (${date})\n    ${article.description || ''}\n    Link: ${article.url}\n\n`;
        });
        return { success: true, result: formattedString.trim() };
      }
    }
    
    // Fallback to webSearch
    const fallbackRes = await webSearch("latest news " + topic);
    if (fallbackRes.success) {
      let formattedString = fallbackRes.result.replace(/^── WEB SEARCH: .* ──/, `── NEWS: ${topic} ──`);
      return { success: true, result: formattedString, source: fallbackRes.source };
    }
    
    return { success: false, result: 'News search failed' };
  } catch (err) {
    return { success: false, result: 'News search error: ' + err.message };
  }
}

async function codeAnalyze(code, language) {
  try {
    const prompt = `Analyze this ${language || 'code'} code:\n\n${code}\n\nProvide:\n1. What it does (2-3 sentences)\n2. Potential bugs or issues\n3. Performance considerations\n4. Security concerns if any\n5. Suggested improvements\nFormat as structured sections.`;
    const response = await askFriday(prompt, 'gemini');
    return { success: true, result: response };
  } catch (err) {
    return { success: false, result: 'Code analysis failed: ' + err.message };
  }
}

module.exports = {
  webSearch,
  wikipedia,
  arxivSearch,
  calculate,
  newsSearch,
  codeAnalyze,
  agentMemory
};
