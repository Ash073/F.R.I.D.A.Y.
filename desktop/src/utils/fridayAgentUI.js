// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\desktop\src\utils\fridayAgentUI.js

const AGENT_BACKEND = 'http://localhost:3131';

async function isAgentQuery(query) {
  try {
    const res = await fetch(`${AGENT_BACKEND}/agent/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.needsAgent;
  } catch (err) {
    console.error('[FRIDAY AGENT UI] Error in isAgentQuery:', err);
    return false;
  }
}

function showAgentBanner() {
  let banner = document.querySelector('.agent-mode-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'agent-mode-banner';
    banner.textContent = '◈ DEEP ANALYSIS MODE — FRIDAY INTELLIGENCE ENGINE ACTIVE';
    const screen = document.getElementById('friday-chat-screen');
    if (screen) {
      screen.appendChild(banner);
    } else {
      document.body.appendChild(banner);
    }
  }
  setTimeout(() => banner.classList.add('visible'), 50);
}

function hideAgentBanner() {
  const banner = document.querySelector('.agent-mode-banner');
  if (banner) {
    setTimeout(() => banner.classList.remove('visible'), 1000);
  }
}

async function runAgentQuery(query, messageContainer) {
  showAgentBanner();

  // 1. Create agent progress card
  const card = document.createElement('div');
  card.className = 'agent-progress-card';
  card.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
      <div style="width: 12px; height: 12px; border: 2px solid #ff6a00; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <div style="color: #ff6a00; font-size: 10px; font-family: Orbitron, monospace; letter-spacing: 0.15em;">FRIDAY INTELLIGENCE — ANALYZING</div>
    </div>
    <div class="agent-steps" style="display: flex; flex-direction: column; gap: 4px;"></div>
    <div class="agent-tools" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px;"></div>
    <div class="agent-footer" style="display: none; margin-top: 10px; font-size: 9px; color: #ff6a0066;"></div>
  `;
  
  const typingIndicator = document.getElementById('chat-typing');
  if (typingIndicator) {
    messageContainer.insertBefore(card, typingIndicator);
  } else {
    messageContainer.appendChild(card);
  }

  // Helper for scrolling
  const scrollToBottom = () => {
    messageContainer.scrollTo({ top: messageContainer.scrollHeight, behavior: 'smooth' });
  };
  scrollToBottom();

  const stepsList = card.querySelector('.agent-steps');
  const toolsRow = card.querySelector('.agent-tools');

  // Add keyframes for the spinner if not already present
  if (!document.getElementById('agent-spinner-style')) {
    const style = document.createElement('style');
    style.id = 'agent-spinner-style';
    style.textContent = `@keyframes spin { 100% { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
  }

  // 2. Connect via fetch SSE streaming
  try {
    const response = await fetch(`${AGENT_BACKEND}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    if (!response.ok) throw new Error('Agent run failed');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      let newlinesIndex;
      while ((newlinesIndex = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, newlinesIndex).trim();
        buffer = buffer.slice(newlinesIndex + 2);
        
        if (chunk.startsWith('data: ')) {
          try {
            const dataStr = chunk.slice(6);
            const update = JSON.parse(dataStr);
            
            // Handle update events
            if (update.type === 'start') {
              if (window.fridaySetState) window.fridaySetState('processing');
              if (window.fridaySetStatus) window.fridaySetStatus('ANALYZING', 'Deep research mode');
            }
            else if (update.type === 'thinking') {
              const step = document.createElement('div');
              step.className = 'agent-step agent-step-thinking';
              step.innerHTML = `<span class="step-icon">◈</span><span class="step-text">${update.text}</span>`;
              stepsList.appendChild(step);
              scrollToBottom();
            }
            else if (update.type === 'tool') {
              const step = document.createElement('div');
              step.className = 'agent-step agent-step-tool';
              step.innerHTML = `<span class="step-icon">⚙</span><span class="step-text">${update.text}</span>`;
              stepsList.appendChild(step);
              
              // Extract tool name from update.text (e.g. "Using tool: web_search(query)")
              const toolMatch = update.text.match(/Using tool:\s*([a-zA-Z0-9_]+)\(/);
              if (toolMatch) {
                const badge = document.createElement('span');
                badge.className = 'tool-badge';
                badge.textContent = toolMatch[1];
                toolsRow.appendChild(badge);
              }
              scrollToBottom();
            }
            else if (update.type === 'observation') {
              const step = document.createElement('div');
              step.className = 'agent-step agent-step-obs';
              step.innerHTML = `<span class="step-icon">◉</span><span class="step-text">Data received</span>`;
              stepsList.appendChild(step);
              scrollToBottom();
            }
            else if (update.type === 'final') {
              card.remove();
              hideAgentBanner();
              appendAgentReport(update.text, update.toolsUsed || [], update.sources || [], update.iterations);
              if (window.fridaySetState) window.fridaySetState('speaking');
              setTimeout(() => { if (window.fridaySetState) window.fridaySetState('idle') }, 3000);
            }
            else if (update.type === 'error') {
              card.innerHTML += `<div style="color: #ff4444; font-size: 11px; margin-top: 10px;">Error: ${update.text}</div>`;
              scrollToBottom();
            }
            else if (update.type === 'done') {
              if (window.fridaySetStatus) window.fridaySetStatus('PASSIVE', 'Say "Hey Friday"');
            }
          } catch (e) {
            console.error('[FRIDAY AGENT UI] Error parsing SSE chunk:', e, chunk);
          }
        }
      }
    }
  } catch (err) {
    console.error('[FRIDAY AGENT UI] Streaming error:', err);
    card.innerHTML += `<div style="color: #ff4444; font-size: 11px; margin-top: 10px;">Error: ${err.message}</div>`;
  }
}

function appendAgentReport(text, toolsUsed, sources, iterations) {
  const msgsContainer = document.getElementById('chat-messages');
  if (!msgsContainer) return;
  
  const reportDiv = document.createElement('div');
  reportDiv.className = 'chat-msg chat-msg-ai chat-msg-agent';
  
  // Header
  const headerHtml = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; border-bottom: 0.5px solid #00ffcc33; padding-bottom: 8px;">
      <span style="color: #00ffcc; font-size: 14px;">◈</span>
      <div>
        <div style="font-family: Orbitron, monospace; font-size: 10px; color: #00ffcc; letter-spacing: 0.15em;">INTELLIGENCE REPORT</div>
        <div style="font-family: Orbitron, monospace; font-size: 8px; color: #ff6a0044;">Analysis complete · ${iterations} reasoning steps · ${toolsUsed.length} tools used</div>
      </div>
    </div>
  `;
  
  // Use existing renderMarkdown if available, else plain text with basic line breaks
  let bodyHtml = '';
  if (typeof renderMarkdown === 'function') {
    bodyHtml = `<div class="chat-msg-content">${renderMarkdown(text)}</div>`;
  } else {
    bodyHtml = `<div class="chat-msg-content" style="white-space: pre-wrap;">${text}</div>`;
  }
  
  // Sources Section
  let sourcesHtml = '';
  if (sources && sources.length > 0) {
    sourcesHtml = `
      <div class="agent-sources" style="margin-top: 16px; border-top: 1px dashed #00ffcc22; padding-top: 12px;">
        <div style="font-family: Orbitron, monospace; font-size: 9px; color: #ffaa00; margin-bottom: 6px;">SOURCES</div>
        ${sources.map((src, i) => `<a href="javascript:void(0)" onclick="require('electron').shell.openExternal('${src}')">[${i + 1}] ${src}</a>`).join('')}
      </div>
    `;
  }
  
  // Tools Used Section
  let toolsHtml = '';
  if (toolsUsed && toolsUsed.length > 0) {
    toolsHtml = `
      <div style="margin-top: 12px;">
        <div style="font-family: Orbitron, monospace; font-size: 9px; color: #ffffff44; margin-bottom: 4px;">TOOLS USED</div>
        <div>
          ${toolsUsed.map(t => `<span class="tool-badge" style="border-color: #ffffff22; color: #ffffff88;">${t}</span>`).join('')}
        </div>
      </div>
    `;
  }
  
  reportDiv.innerHTML = headerHtml + bodyHtml + sourcesHtml + toolsHtml;
  
  const typingIndicator = document.getElementById('chat-typing');
  if (typingIndicator) {
    msgsContainer.insertBefore(reportDiv, typingIndicator);
  } else {
    msgsContainer.appendChild(reportDiv);
  }
  
  msgsContainer.scrollTo({ top: msgsContainer.scrollHeight, behavior: 'smooth' });
}

window.fridayAgent = {
  run: runAgentQuery,
  classify: isAgentQuery,
  appendReport: appendAgentReport
};
