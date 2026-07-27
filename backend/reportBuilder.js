// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\backend\reportBuilder.js

function buildReport(rawAnswer, metadata) {
  const { query, toolsUsed, sources, iterations, duration, modelUsed } = metadata;
  
  let processedAnswer = rawAnswer;
  if (!rawAnswer.includes('#')) {
    // Very basic auto-detection of sections for plain paragraphs could go here
    // For now, if it's completely plain, we just use it as is
    const paragraphs = rawAnswer.split('\n\n').filter(p => p.trim() !== '');
    if (paragraphs.length > 2) {
      processedAnswer = `### Summary\n\n${paragraphs[0]}\n\n### Details\n\n${paragraphs.slice(1).join('\n\n')}`;
    }
  }

  const header = `## ◈ INTELLIGENCE REPORT\n**Query:** ${query}\n**Analysis depth:** ${iterations} reasoning steps\n**Duration:** ${duration}ms\n**Sources consulted:** ${sources ? sources.length : 0}\n\n---\n\n`;
  
  let sourcesBlock = '';
  if (sources && sources.length > 0) {
    const dedupedSources = [...new Set(sources)];
    const sourceList = dedupedSources.map((s, i) => `${i + 1}. [${s}](${s})`).join('\n');
    sourcesBlock = `\n\n---\n## ◈ SOURCES\n${sourceList}\n`;
  }
  
  let toolsBlock = '';
  if (toolsUsed && toolsUsed.length > 0) {
    const dedupedTools = [...new Set(toolsUsed)];
    toolsBlock = `\n## ◈ TOOLS USED\n${dedupedTools.join(', ')}\n`;
  }
  
  return header + processedAnswer + sourcesBlock + toolsBlock;
}

function buildQuickSummary(rawAnswer) {
  const sentences = rawAnswer.replace(/#/g, '').split(/[.!?]+/).filter(s => s.trim().length > 0);
  const summarySentences = sentences.slice(0, 3).map(s => s.trim() + '.');
  return "**TL;DR:** " + summarySentences.join(' ');
}

function detectReportType(query) {
  const q = query.toLowerCase();
  if (/(research|papers|studies|literature|history)/.test(q)) return 'research';
  if (/(analyze|compare|pros cons|evaluate|assess)/.test(q)) return 'analysis';
  if (/(calculate|compute|how much|how many|percentage)/.test(q)) return 'calculation';
  if (/(latest|recent|today|current|happening)/.test(q)) return 'news';
  if (/(code|function|bug|error|programming|debug)/.test(q)) return 'code';
  return 'general';
}

module.exports = { buildReport, buildQuickSummary, detectReportType };
