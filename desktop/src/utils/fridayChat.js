// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\desktop\src\utils\fridayChat.js

// ────────────────────────────────────────
// STATE VARIABLES
// ────────────────────────────────────────
const BACKEND = 'http://localhost:8888';
let currentMode = 'auto';
let isProcessing = false;
let attachedFiles = [];
let messageCount = 0;

// ────────────────────────────────────────
// FUNCTION: openChatScreen()
// ────────────────────────────────────────
function openChatScreen() {
  const chatScreen = document.getElementById('friday-chat-screen');
  if (chatScreen) {
    chatScreen.classList.add('chat-active');
  }
  
  if (typeof window.fridaySetState === 'function') {
    window.fridaySetState('processing');
  }
  
  loadAIStatus();
  
  setTimeout(() => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) chatInput.focus();
  }, 450);
  
  console.log('[FRIDAY CHAT] Screen opened');
}

// ────────────────────────────────────────
// FUNCTION: closeChatScreen()
// ────────────────────────────────────────
function closeChatScreen() {
  const chatScreen = document.getElementById('friday-chat-screen');
  if (chatScreen) {
    chatScreen.classList.remove('chat-active');
  }
  
  if (typeof window.fridaySetState === 'function') {
    window.fridaySetState('idle');
  }
  
  if (typeof window.fridaySetStatus === 'function') {
    window.fridaySetStatus('IDLE', 'Standing by');
  }
  
  console.log('[FRIDAY CHAT] Screen closed');
}

// ────────────────────────────────────────
// FUNCTION: loadAIStatus()
// ────────────────────────────────────────
async function loadAIStatus() {
  try {
    const res = await fetch(`${BACKEND}/ask/status`);
    if (!res.ok) throw new Error('Status fetch failed');
    const status = await res.json();
    
    const engines = [];
    if (status.gemini && status.gemini.configured && !status.gemini.exhausted) {
      engines.push('GEMINI');
    }
    if (status.groq && status.groq.configured && !status.groq.exhausted) {
      engines.push('GROQ');
    }
    if (status.cohere && status.cohere.configured && !status.cohere.exhausted) {
      engines.push('COHERE');
    }
    if (status.mistral && status.mistral.configured && !status.mistral.exhausted) {
      engines.push('MISTRAL');
    }
    
    let statusString = 'INTELLIGENCE ONLINE';
    if (engines.length > 0) {
      statusString = engines.map(name => `${name} ●`).join(' ');
    }
    
    const statusEl = document.getElementById('chat-ai-status');
    if (statusEl) {
      statusEl.textContent = statusString;
    }
  } catch (err) {
    console.warn('[FRIDAY CHAT] Failed to load AI status:', err);
    const statusEl = document.getElementById('chat-ai-status');
    if (statusEl) {
      statusEl.textContent = 'INTELLIGENCE ONLINE';
    }
  }
}

// ────────────────────────────────────────
// FUNCTION: sendMessage()
// ────────────────────────────────────────
async function sendMessage() {
  if (isProcessing) return;
  
  const input = document.getElementById('chat-input');
  const message = input ? input.value.trim() : '';
  
  if (!message && attachedFiles.length === 0) return;
  
  isProcessing = true;
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.disabled = true;
  
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
  
  // Show the user's message in the UI right away
  appendMessage('user', message || '[Attachment]');
  showTyping();
  
  try {
    // Read all attached files asynchronously
    const fileReadPromises = attachedFiles.map(att => {
      return new Promise((resolve) => {
        const name = att.name.toLowerCase();
        const isText = name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv') || name.endsWith('.json');
        const isImage = att.type.startsWith('image/');
        
        if (isText) {
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve(`\n\n[Attached file: ${att.name}]\n${e.target.result}`);
          };
          reader.onerror = () => {
            resolve(`\n\n[Error reading file: ${att.name}]`);
          };
          reader.readAsText(att.file);
        } else if (isImage) {
          resolve(`\n\n[User attached image: ${att.name} — describe or analyze if relevant]`);
        } else {
          resolve(`\n\n[User attached file: ${att.name}]`);
        }
      });
    });
    
    const results = await Promise.all(fileReadPromises);
    let fullMessage = message;
    results.forEach(res => {
      fullMessage += res;
    });
    
    const response = await fetch(`${BACKEND}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: fullMessage, mode: currentMode })
    });
    
    hideTyping();
    
    if (response.ok) {
      const data = await response.json();
      appendMessage('ai', data.reply, data.mode);
      
      if (typeof window.fridaySetState === 'function') {
        window.fridaySetState('speaking');
        setTimeout(() => window.fridaySetState('idle'), 2000);
      }
    } else {
      appendMessage('ai', 'I encountered an issue processing that request. Please try again.', 'error');
    }
  } catch (err) {
    console.error('[FRIDAY CHAT] sendMessage error:', err);
    hideTyping();
    appendMessage('ai', 'I encountered an issue processing that request. Please try again.', 'error');
  } finally {
    attachedFiles = [];
    renderAttachments();
    isProcessing = false;
    if (sendBtn) sendBtn.disabled = false;
    
    // Smooth scroll to bottom
    const msgs = document.getElementById('chat-messages');
    if (msgs) {
      msgs.scrollTo({ top: msgs.scrollHeight, behavior: 'smooth' });
    }
  }
}

// ────────────────────────────────────────
// FUNCTION: appendMessage(role, text, modelName)
// ────────────────────────────────────────
function appendMessage(role, text, modelName) {
  messageCount++;
  
  const msgsContainer = document.getElementById('chat-messages');
  if (!msgsContainer) return;
  
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg chat-msg-${role === 'user' ? 'user' : 'ai'}`;
  
  if (role === 'user') {
    const labelDiv = document.createElement('div');
    labelDiv.className = 'chat-msg-label';
    labelDiv.textContent = 'YOU';
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'chat-msg-bubble';
    bubbleDiv.textContent = text; // Safe text rendering for XSS prevention
    
    msgDiv.appendChild(labelDiv);
    msgDiv.appendChild(bubbleDiv);
  } else {
    const labelRow = document.createElement('div');
    labelRow.className = 'chat-msg-label';
    
    const dotSpan = document.createElement('span');
    dotSpan.className = 'chat-msg-dot';
    
    const fridaySpan = document.createElement('span');
    fridaySpan.className = 'chat-msg-friday';
    fridaySpan.textContent = 'FRIDAY';
    
    const sepSpan = document.createElement('span');
    sepSpan.className = 'chat-msg-sep';
    sepSpan.textContent = '·';
    
    const engineSpan = document.createElement('span');
    engineSpan.className = 'chat-msg-engine';
    engineSpan.textContent = modelName ? `VIA ${modelName.toUpperCase()}` : '';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'chat-msg-time';
    timeSpan.textContent = new Date().toLocaleTimeString();
    
    labelRow.appendChild(dotSpan);
    labelRow.appendChild(fridaySpan);
    labelRow.appendChild(sepSpan);
    labelRow.appendChild(engineSpan);
    labelRow.appendChild(timeSpan);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'chat-msg-content';
    contentDiv.innerHTML = renderMarkdown(text); // Secure markdown conversion
    
    msgDiv.appendChild(labelRow);
    msgDiv.appendChild(contentDiv);
  }
  
  // Insert before the typing indicator
  const typingIndicator = document.getElementById('chat-typing');
  if (typingIndicator) {
    msgsContainer.insertBefore(msgDiv, typingIndicator);
  } else {
    msgsContainer.appendChild(msgDiv);
  }
  
  // Smooth scroll to bottom
  msgsContainer.scrollTo({ top: msgsContainer.scrollHeight, behavior: 'smooth' });
}

// ────────────────────────────────────────
// FUNCTION: renderMarkdown(text)
// ────────────────────────────────────────
function renderMarkdown(text) {
  // 1. Escape existing HTML first
  let escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Fenced code blocks extraction
  const codeBlocks = [];
  escaped = escaped.replace(/```(\w*)\r?\n([\s\S]*?)\r?\n?```/g, (match, lang, code) => {
    const language = lang.trim() || 'CODE';
    const blockHtml = `<div class="code-block-wrap"><div class="code-lang">${language}</div><button class="code-copy-btn" onclick="fridayCopyCode(this)">COPY</button><pre><code>${code}</code></pre></div>`;
    codeBlocks.push(blockHtml);
    return `\n\n__CODE_BLOCK_${codeBlocks.length - 1}__\n\n`;
  });

  // Split into paragraphs/blocks by double newlines
  const blocks = escaped.split(/\n\n+/);
  
  const parsedBlocks = blocks.map(block => {
    let html = block.trim();
    if (!html) return '';

    // Check if it is a code block placeholder
    if (html.startsWith('__CODE_BLOCK_') && html.endsWith('__')) {
      return html;
    }

    // 3. Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');

    // 4. Headings
    let isBlock = false;
    if (html.startsWith('### ')) {
      html = html.replace(/^###\s+(.+)$/gm, '<h3 class="chat-h3">$1</h3>');
      isBlock = true;
    } else if (html.startsWith('## ')) {
      html = html.replace(/^##\s+(.+)$/gm, '<h2 class="chat-h2">$1</h2>');
      isBlock = true;
    } else if (html.startsWith('# ')) {
      html = html.replace(/^#\s+(.+)$/gm, '<h1 class="chat-h1">$1</h1>');
      isBlock = true;
    }

    // 7. Blockquote (check if starting with &gt; )
    if (html.startsWith('&gt;')) {
      html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote class="chat-quote">$1</blockquote>');
      isBlock = true;
    }

    // 8. Unordered lists
    if (html.startsWith('- ') || html.startsWith('* ')) {
      html = html.replace(/^[-\*]\s+(.+)$/gm, '<li><span class="chat-bullet">›</span>$1</li>');
      html = `<ul class="chat-ul">\n${html}\n</ul>`;
      isBlock = true;
    }

    // 9. Ordered lists
    if (/^\d+\.\s+/.test(html)) {
      html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
      html = `<ol class="chat-ol">\n${html}\n</ol>`;
      isBlock = true;
    }

    // 10. Horizontal rule
    if (html === '---') {
      html = '<hr class="chat-hr">';
      isBlock = true;
    }

    // 5. Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 6. Italic
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // 11. Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="chat-link">$1</a>');

    // 13. Single newlines within paragraph → <br>
    if (!isBlock) {
      html = html.replace(/\n/g, '<br>');
      html = `<p class="chat-p">${html}</p>`;
    } else {
      // In block elements, keep standard spacing and only use <br> for multi-line blockquotes
      if (html.startsWith('<blockquote')) {
        html = html.replace(/\n/g, '<br>');
      }
    }

    return html;
  });

  let finalHtml = parsedBlocks.filter(b => b !== '').join('\n');

  // 15. Restore code blocks
  codeBlocks.forEach((block, idx) => {
    finalHtml = finalHtml.replace(`__CODE_BLOCK_${idx}__`, block);
  });

  return finalHtml;
}

// ────────────────────────────────────────
// FUNCTION: fridayCopyCode(button)
// ────────────────────────────────────────
function fridayCopyCode(button) {
  const codeEl = button.nextElementSibling.querySelector('code');
  if (!codeEl) return;
  
  const text = codeEl.textContent;
  navigator.clipboard.writeText(text).then(() => {
    button.textContent = 'COPIED';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = 'COPY';
      button.classList.remove('copied');
    }, 2000);
  }).catch(err => {
    console.error('[FRIDAY CHAT] Failed to copy code:', err);
  });
}

// ────────────────────────────────────────
// FUNCTION: showTyping() and hideTyping()
// ────────────────────────────────────────
function showTyping() {
  const typingEl = document.getElementById('chat-typing');
  if (typingEl) {
    typingEl.style.display = 'flex';
  }
  
  const msgsContainer = document.getElementById('chat-messages');
  if (msgsContainer) {
    msgsContainer.scrollTo({ top: msgsContainer.scrollHeight, behavior: 'smooth' });
  }
}

function hideTyping() {
  const typingEl = document.getElementById('chat-typing');
  if (typingEl) {
    typingEl.style.display = 'none';
  }
}

// ────────────────────────────────────────
// FUNCTION: handleFileAttach(event)
// ────────────────────────────────────────
function handleFileAttach(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.size > 10 * 1024 * 1024) {
      alert('File too large — max 10MB');
      continue;
    }
    
    attachedFiles.push({
      name: file.name,
      type: file.type,
      size: file.size,
      file: file
    });
    
    console.log(`[FRIDAY CHAT] File attached: ${file.name}`);
  }
  
  renderAttachments();
  event.target.value = ''; // Reset file input value
}

// ────────────────────────────────────────
// FUNCTION: renderAttachments()
// ────────────────────────────────────────
function renderAttachments() {
  const attachmentsArea = document.getElementById('chat-attachments');
  if (!attachmentsArea) return;
  
  if (attachedFiles.length === 0) {
    attachmentsArea.style.display = 'none';
    attachmentsArea.innerHTML = '';
    return;
  }
  
  attachmentsArea.style.display = 'flex';
  attachmentsArea.innerHTML = '';
  
  attachedFiles.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'chat-attachment-chip';
    
    let icon = '📎';
    if (file.type.startsWith('image/')) {
      icon = '🖼';
    } else if (file.name.endsWith('.pdf')) {
      icon = '📄';
    } else if (file.name.endsWith('.csv') || file.name.endsWith('.json')) {
      icon = '📊';
    }
    
    let displayName = file.name;
    if (displayName.length > 20) {
      displayName = displayName.substring(0, 17) + '...';
    }
    
    chip.innerHTML = `
      <span>${icon} ${displayName}</span>
      <button class="attachment-remove" onclick="window.fridayRemoveAttachment(${index})">×</button>
    `;
    
    attachmentsArea.appendChild(chip);
  });
}

// ────────────────────────────────────────
// FUNCTION: removeAttachment(index)
// ────────────────────────────────────────
function removeAttachment(index) {
  attachedFiles.splice(index, 1);
  renderAttachments();
}

// ────────────────────────────────────────
// FUNCTION: clearChat()
// ────────────────────────────────────────
async function clearChat() {
  try {
    const res = await fetch(`${BACKEND}/ask/clear`, { method: 'POST' });
    if (!res.ok) throw new Error('Clear endpoint failed');
    
    const msgsContainer = document.getElementById('chat-messages');
    if (msgsContainer) {
      // Keep only typing indicator
      const typingEl = document.getElementById('chat-typing');
      msgsContainer.innerHTML = '';
      if (typingEl) {
        typingEl.style.display = 'none';
        msgsContainer.appendChild(typingEl);
      }
    }
    
    messageCount = 0;
    attachedFiles = [];
    renderAttachments();
    
    // Send welcome message
    appendMessage('ai', 'Systems online. How can I assist you today?', 'FRIDAY');
  } catch (err) {
    console.error('[FRIDAY CHAT] Failed to clear conversation history:', err);
  }
}

// ────────────────────────────────────────
// EVENT WIRING — DOMContentLoaded
// ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const backBtn = document.getElementById('chat-back-btn');
  if (backBtn) backBtn.onclick = closeChatScreen;

  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.onclick = sendMessage;

  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      const newHeight = Math.min(chatInput.scrollHeight, 160);
      chatInput.style.height = newHeight + 'px';
    });
  }

  const modeSelect = document.getElementById('chat-mode-select');
  if (modeSelect) {
    modeSelect.addEventListener('change', (e) => {
      currentMode = e.target.value.toLowerCase();
      loadAIStatus();
      console.log('[FRIDAY CHAT] Mode changed to: ' + currentMode);
    });
  }

  const clearBtn = document.getElementById('chat-clear-btn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      if (confirm('Clear conversation history?')) {
        clearChat();
      }
    };
  }

  const attachBtn = document.getElementById('chat-attach-btn');
  if (attachBtn) {
    attachBtn.onclick = () => {
      const fileInput = document.getElementById('chat-file-input');
      if (fileInput) {
        fileInput.removeAttribute('accept');
        fileInput.click();
      }
    };
  }

  const imageBtn = document.getElementById('chat-image-btn');
  if (imageBtn) {
    imageBtn.onclick = () => {
      const fileInput = document.getElementById('chat-file-input');
      if (fileInput) {
        fileInput.setAttribute('accept', 'image/*');
        fileInput.click();
      }
    };
  }

  const fileInput = document.getElementById('chat-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', handleFileAttach);
  }
});

// ────────────────────────────────────────
// WINDOW EXPOSURES
// ────────────────────────────────────────
window.fridayOpenChat = openChatScreen;
window.fridayCloseChat = closeChatScreen;
window.fridayCopyCode = fridayCopyCode;
window.fridayRemoveAttachment = removeAttachment;
