import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Paperclip, Image, Video, Trash2, X, Plus, User, Bot, 
  Sparkles, Send, Mic, MicOff, ChevronRight, Copy, Check, MessageSquare
} from 'lucide-react';
import { smartFetch } from '../hooks/useFridayVoicePipeline';

// Interface definitions
interface Attachment {
  base64: string;
  mimeType: string;
  name: string;
  type: 'image' | 'video';
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  attachment?: Attachment | null;
  modelUsed?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  timestamp: Date;
}

interface InteractiveChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  accentColor: string;
  voiceState: 'idle' | 'listening' | 'processing';
  startRecording: (manual?: boolean) => void;
  stopRecording: () => void;
  onSendMessage: (text: string, attachment?: Attachment | null) => Promise<string | null>;
  initialMessages?: { role: 'user' | 'assistant', text: string }[];
  apiStatus?: any;
}

// Regex-based custom high-performance Markdown parser for bullet points, bolding, and code blocks
const formatMessageText = (text: string, accentColor: string) => {
  if (!text) return '';
  
  // 1. Parse Code Blocks ```code```
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const prevText = text.substring(lastIndex, match.index);
    if (prevText) {
      parts.push(parseInlineText(prevText, accentColor));
    }

    const language = match[1] || 'code';
    const codeContent = match[2];
    
    parts.push(
      <React.Fragment key={`code-${match.index}`}>
        <CodeBlock code={codeContent} language={language} accentColor={accentColor} />
      </React.Fragment>
    );
    lastIndex = codeBlockRegex.lastIndex;
  }

  const remainingText = text.substring(lastIndex);
  if (remainingText) {
    parts.push(parseInlineText(remainingText, accentColor));
  }

  return <div className="space-y-2">{parts}</div>;
};

// Inline parser for bold (**text**), lists, and newlines
const parseInlineText = (text: string, accentColor: string): React.ReactNode => {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, lineIdx) => {
        // Bullet point parsing
        if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
          const content = line.trim().substring(2);
          return (
            <ul key={lineIdx} className="list-disc pl-5 space-y-0.5 my-1 text-white/90">
              <li>{parseBoldText(content, accentColor)}</li>
            </ul>
          );
        }
        // Ordered list parsing
        if (/^\d+\.\s/.test(line.trim())) {
          const content = line.trim().replace(/^\d+\.\s/, '');
          const num = line.trim().match(/^\d+/)?.[0];
          return (
            <ol key={lineIdx} className="list-decimal pl-5 space-y-0.5 my-1 text-white/90">
              <li value={num ? parseInt(num) : undefined}>{parseBoldText(content, accentColor)}</li>
            </ol>
          );
        }
        return (
          <p key={lineIdx} className="leading-relaxed text-white/90 text-sm tracking-wide">
            {parseBoldText(line, accentColor)}
          </p>
        );
      })}
    </div>
  );
};

const parseBoldText = (text: string, accentColor: string) => {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-extrabold" style={{ color: accentColor }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
};

// Sub-component for code rendering with a copy button
const CodeBlock = ({ code, language, accentColor }: { code: string, language: string, accentColor: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-3 rounded-lg overflow-hidden border border-white/10 bg-black/60 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-1.5 bg-white/5 border-b border-white/10 text-[9px] uppercase tracking-widest font-mono text-white/40">
        <span>{language}</span>
        <button onClick={handleCopy} className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer">
          {copied ? <Check size={10} style={{ color: accentColor }} /> : <Copy size={10} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-4 overflow-x-auto font-mono text-xs text-orange-200/90 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export default function InteractiveChatPanel({
  isOpen,
  onClose,
  accentColor,
  voiceState,
  startRecording,
  stopRecording,
  onSendMessage,
  initialMessages = [],
  apiStatus
}: InteractiveChatPanelProps) {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('friday_chat_sessions');
      if (saved) {
        return JSON.parse(saved).map((s: any) => ({
          ...s,
          timestamp: new Date(s.timestamp),
          messages: s.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
        }));
      }
    } catch {}
    return [];
  });

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [currentMessages, setCurrentMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages, isSending]);

  // Synchronize state when external initialMessages array updates (e.g. from the main reactor core)
  useEffect(() => {
    if (initialMessages.length > 0 && currentMessages.length === 0) {
      const formatted = initialMessages.map((m, idx) => ({
        id: `init-${idx}-${Date.now()}`,
        role: m.role,
        text: m.text,
        timestamp: new Date()
      }));
      setCurrentMessages(formatted);
      
      // Start a new session automatically
      const newSessionId = `session-${Date.now()}`;
      const newSession: ChatSession = {
        id: newSessionId,
        title: formatted[0]?.text.slice(0, 30) || 'New Conversation',
        messages: formatted,
        timestamp: new Date()
      };
      setSessions([newSession]);
      setActiveSessionId(newSessionId);
    }
  }, [initialMessages]);

  // Persistent storage hooks
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('friday_chat_sessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  // Update current session's messages
  useEffect(() => {
    if (activeSessionId) {
      setSessions(prev => prev.map(s => 
        s.id === activeSessionId ? { ...s, messages: currentMessages } : s
      ));
    }
  }, [currentMessages, activeSessionId]);

  const handleNewThread = () => {
    if (currentMessages.length > 0) {
      const newSessionId = `session-${Date.now()}`;
      const title = currentMessages[0]?.text.slice(0, 30) || 'Conversation Thread';
      
      // Save the old one if it doesn't already exist
      if (!sessions.some(s => s.id === activeSessionId)) {
        const archivedSession: ChatSession = {
          id: activeSessionId || `session-${Date.now() - 1}`,
          title: title,
          messages: currentMessages,
          timestamp: new Date()
        };
        setSessions(prev => [archivedSession, ...prev]);
      }
    }

    // Reset current workspace
    const freshSessionId = `session-${Date.now()}`;
    setActiveSessionId(freshSessionId);
    setCurrentMessages([]);
    setAttachment(null);
    setInputText('');

    // Clear backend context logs
    smartFetch('/ask/clear', { method: 'POST' }).catch(err => console.warn(err));
  };

  const loadSession = (session: ChatSession) => {
    setActiveSessionId(session.id);
    setCurrentMessages(session.messages);
    setAttachment(null);
    setInputText('');
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setCurrentMessages([]);
      setActiveSessionId(null);
    }
  };

  // Attachment Handler
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const type = file.type.startsWith('video/') ? 'video' : 'image';
      setAttachment({
        base64: reader.result as string,
        mimeType: file.type,
        name: file.name,
        type: type as 'image' | 'video'
      });
    };
    reader.readAsDataURL(file);
  };

  const removeAttachment = () => {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Send Chat Message
  const handleSend = async () => {
    if (!inputText.trim() && !attachment) return;

    const userText = inputText;
    const userAttach = attachment;

    setInputText('');
    setAttachment(null);
    setIsSending(true);

    const userMsg: Message = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      text: userText,
      timestamp: new Date(),
      attachment: userAttach
    };

    setCurrentMessages(prev => [...prev, userMsg]);

    // Ensure session exists
    if (!activeSessionId) {
      const freshSessionId = `session-${Date.now()}`;
      setActiveSessionId(freshSessionId);
      const newSession: ChatSession = {
        id: freshSessionId,
        title: userText.slice(0, 30) || 'Image Query',
        messages: [userMsg],
        timestamp: new Date()
      };
      setSessions(prev => [newSession, ...prev]);
    } else {
      setSessions(prev => prev.map(s => {
        if (s.id === activeSessionId) {
          const updatedMsgs = [...s.messages, userMsg];
          const title = s.title === 'New Conversation' || s.title === 'Conversation Thread'
            ? userText.slice(0, 30)
            : s.title;
          return { ...s, title, messages: updatedMsgs };
        }
        return s;
      }));
    }

    try {
      const activeModel = apiStatus?.lastUsedModel || 'F.R.I.D.A.Y.';
      const response = await onSendMessage(userText, userAttach);
      
      const assistantMsg: Message = {
        id: `msg-${Date.now()}-friday`,
        role: 'assistant',
        text: response || "I'm currently having trouble processing this query. Please check my status feed.",
        timestamp: new Date(),
        modelUsed: activeModel
      };

      setCurrentMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  // Mic Toggle Bridge
  const handleMicClick = () => {
    if (voiceState === 'listening') {
      stopRecording();
    } else {
      startRecording(true);
    }
  };

  // Fast-fill input when voice transcription changes
  // (We'll listen to window custom transcription event in case user speaks)
  useEffect(() => {
    const handleVoiceText = (e: CustomEvent<{ text: string }>) => {
      if (isOpen) {
        setInputText(prev => (prev + ' ' + e.detail.text).trim());
      }
    };
    window.addEventListener('friday-voice-transcription' as any, handleVoiceText as any);
    return () => window.removeEventListener('friday-voice-transcription' as any, handleVoiceText as any);
  }, [isOpen]);

  const activeModelDisplay = apiStatus ? (apiStatus.lastUsedModel || 'Waterfall') : 'F.R.I.D.A.Y.';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 26, stiffness: 170 }}
          className="absolute right-0 top-0 bottom-0 z-[100] w-full md:w-[50vw] lg:w-[45vw] bg-black/85 backdrop-blur-3xl border-l border-orange-500/20 shadow-2xl flex text-orange-500 select-text select-none"
          style={{ '--accent': accentColor } as any}
        >
          {/* Neon Glow Trim Edge */}
          <div className="w-[1px] h-full bg-gradient-to-b from-transparent via-[var(--accent)] to-transparent opacity-40 absolute left-0 top-0 bottom-0" />

          {/* Left Column: Thread Log Sidebar */}
          <div className="w-1/3 border-r border-white/5 bg-black/40 flex flex-col font-mono text-[9px] uppercase tracking-widest hidden sm:flex">
            {/* New Thread Control */}
            <div className="p-4 border-b border-white/5">
              <button 
                onClick={handleNewThread}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 border border-orange-500/20 hover:border-orange-500/50 rounded bg-orange-950/10 hover:bg-orange-500/10 text-white font-bold transition-all uppercase cursor-pointer"
                style={{ borderColor: accentColor + '33', color: accentColor }}
              >
                <Plus size={12} />
                <span>New Session</span>
              </button>
            </div>

            {/* Conversation Log Thread List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-thin">
              <div className="px-2 py-1 text-[8px] text-white/30 font-bold tracking-widest">Active Feeds</div>
              {sessions.map(s => {
                const isActive = s.id === activeSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => loadSession(s)}
                    className={`group w-full flex items-center justify-between p-2.5 rounded cursor-pointer transition-all border ${
                      isActive 
                        ? 'bg-orange-950/20 text-white border-orange-500/30' 
                        : 'bg-transparent text-white/60 border-transparent hover:bg-white/5 hover:text-white'
                    }`}
                    style={isActive ? { borderColor: accentColor + '40', backgroundColor: accentColor + '0d' } : {}}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <MessageSquare size={10} style={{ color: isActive ? accentColor : 'inherit' }} />
                      <span className="truncate max-w-[120px]">{s.title || 'Untitled Session'}</span>
                    </div>
                    <button 
                      onClick={(e) => deleteSession(e, s.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                );
              })}
              {sessions.length === 0 && (
                <div className="text-center py-8 text-white/20">No archived chats</div>
              )}
            </div>

            {/* Hardware Encryption Footer */}
            <div className="p-3 border-t border-white/5 text-[7px] text-white/30 flex flex-col gap-0.5 bg-black/20">
              <span>SEC_LOGS: AES-256-GCM</span>
              <span>DYNAMIC WATERFALL ENCODED</span>
            </div>
          </div>

          {/* Right Column: Active Interactive Chat Frame */}
          <div className="flex-1 flex flex-col bg-transparent relative">
            
            {/* Upper Control Bar */}
            <div className="h-16 border-b border-white/5 px-6 flex items-center justify-between bg-black/20 font-mono text-[9px] uppercase tracking-widest">
              <div className="flex items-center gap-2">
                <Sparkles size={12} className="animate-pulse" style={{ color: accentColor }} />
                <div>
                  <span className="font-extrabold text-white">FRIDAY INTELLIGENCE DECK</span>
                  <div className="text-[7px] text-white/40 mt-0.5">ACTIVE NETWORK: <span style={{ color: accentColor }}>{activeModelDisplay}</span></div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {/* Visual New Session button for mobile */}
                <button 
                  onClick={handleNewThread}
                  className="sm:hidden p-2 hover:bg-white/5 rounded cursor-pointer border border-white/5"
                  title="New Thread"
                >
                  <Plus size={14} />
                </button>

                <button 
                  onClick={onClose}
                  className="p-2 hover:bg-white/5 rounded cursor-pointer border border-white/5 text-white/60 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Chat Bubble Thread logs */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scroll-smooth select-text bg-[#0d0000]/10">
              
              {currentMessages.map(msg => {
                const isUser = msg.role === 'user';
                return (
                  <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] flex flex-col gap-1.5`}>
                      
                      {/* Bubble Header */}
                      <div className={`flex items-center gap-1.5 font-mono text-[7px] tracking-wider uppercase opacity-40 ${isUser ? 'justify-end' : 'justify-start'}`}>
                        {isUser ? (
                          <>
                            <span>OPERATOR</span>
                            <User size={8} />
                          </>
                        ) : (
                          <>
                            <Bot size={8} style={{ color: accentColor }} />
                            <span style={{ color: accentColor }}>FRIDAY // {msg.modelUsed || 'AI'}</span>
                          </>
                        )}
                      </div>

                      {/* Bubble Frame */}
                      <div 
                        className={`p-4 rounded-xl shadow-lg border relative group/bubble ${
                          isUser 
                            ? 'bg-orange-500/10 border-orange-500/20 text-white rounded-tr-none' 
                            : 'bg-black/45 border-white/5 text-white rounded-tl-none backdrop-blur-sm'
                        }`}
                        style={isUser ? { borderColor: accentColor + '33', backgroundColor: accentColor + '0f' } : {}}
                      >
                        {/* Bubble Content file attachment (Images / Videos) */}
                        {msg.attachment && (
                          <div className="mb-3 rounded-lg overflow-hidden border border-white/10 max-w-[280px]">
                            {msg.attachment.type === 'video' ? (
                              <video src={msg.attachment.base64} controls className="w-full aspect-video rounded-lg" />
                            ) : (
                              <img 
                                src={msg.attachment.base64} 
                                alt={msg.attachment.name} 
                                onClick={() => setZoomedImage(msg.attachment?.base64 || null)}
                                className="w-full h-auto rounded-lg cursor-zoom-in hover:opacity-90 transition-opacity" 
                              />
                            )}
                          </div>
                        )}

                        {/* Text formatting */}
                        <div className="font-mono text-xs tracking-wider leading-relaxed">
                          {formatMessageText(msg.text, accentColor)}
                        </div>
                      </div>

                      {/* Timestamp Footer */}
                      <div className={`text-[6px] opacity-35 font-mono ${isUser ? 'text-right' : 'text-left'}`}>
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>

                    </div>
                  </div>
                );
              })}

              {/* Dynamic Thinking/Processing Indicator */}
              {isSending && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5 font-mono text-[7px] tracking-wider uppercase opacity-40">
                      <Bot size={8} style={{ color: accentColor }} />
                      <span style={{ color: accentColor }}>FRIDAY SYSTEM THINKING...</span>
                    </div>
                    <div className="p-4 rounded-xl rounded-tl-none bg-black/45 border border-white/5 backdrop-blur-sm shadow-lg flex items-center gap-3">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '0ms', backgroundColor: accentColor }} />
                        <span className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '150ms', backgroundColor: accentColor }} />
                        <span className="w-2 h-2 rounded-full bg-orange-500 animate-bounce" style={{ animationDelay: '300ms', backgroundColor: accentColor }} />
                      </div>
                      <span className="font-mono text-[8px] uppercase tracking-widest text-white/40">Accessing cybernetic nodes...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Input & Upload Dock area */}
            <div className="p-4 md:p-6 border-t border-white/5 bg-black/35 backdrop-blur-lg flex flex-col gap-3">
              
              {/* Selected File Previews */}
              {attachment && (
                <div className="flex items-center gap-2 p-2 bg-black/40 border border-white/10 rounded-lg max-w-sm animate-[fadeIn_0.2s_ease-out]">
                  {attachment.type === 'video' ? (
                    <div className="w-12 h-12 bg-white/5 flex items-center justify-center rounded border border-white/10 relative">
                      <Video size={16} />
                    </div>
                  ) : (
                    <img src={attachment.base64} alt="preview" className="w-12 h-12 object-cover rounded border border-white/10" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[8px] font-mono text-white truncate">{attachment.name}</div>
                    <div className="text-[6px] font-mono text-white/30 uppercase mt-0.5">{attachment.type} attachment</div>
                  </div>
                  <button 
                    onClick={removeAttachment}
                    className="p-1 hover:bg-white/10 rounded-full text-white/40 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {/* Controls and fields */}
              <div 
                className="flex items-center gap-2 md:gap-3 bg-orange-950/20 border border-orange-500/20 p-1 md:p-1.5 rounded-full backdrop-blur-sm group focus-within:border-orange-500/50 shadow-inner"
                style={{ borderColor: accentColor + '33' }}
              >
                {/* Paperclip attachments button */}
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 md:p-2.5 rounded-full text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                  title="Upload Image/Video"
                >
                  <Paperclip size={14} style={{ color: accentColor }} />
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/*,video/*"
                  style={{ display: 'none' }}
                />

                {/* Input text */}
                <input 
                  type="text" 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={voiceState === 'listening' ? "Listening..." : "Query FRIDAY network..."}
                  disabled={isSending}
                  className="flex-1 bg-transparent border-none outline-none text-xs text-white placeholder:text-orange-950/50 placeholder:uppercase tracking-widest font-mono py-1 select-text"
                  style={{ color: accentColor }}
                />

                {/* Voice dictation button */}
                <button 
                  onClick={handleMicClick}
                  className={`p-2 rounded-full transition-all cursor-pointer ${
                    voiceState === 'listening' 
                      ? 'bg-orange-500 text-black' 
                      : 'bg-transparent text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                  style={voiceState === 'listening' ? { backgroundColor: accentColor, color: '#000' } : {}}
                  title={voiceState === 'listening' ? "Stop Dictation" : "Dictate Prompt"}
                >
                  {voiceState === 'listening' ? <Mic size={14} /> : <MicOff size={14} style={{ color: accentColor + 'b3' }} />}
                </button>

                {/* Send action */}
                <button 
                  onClick={handleSend}
                  disabled={isSending || (!inputText.trim() && !attachment)}
                  className="p-2.5 bg-orange-500 text-black rounded-full hover:bg-orange-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                  style={{ backgroundColor: accentColor }}
                >
                  <Send size={14} />
                </button>

              </div>
              
              <div className="text-center text-[6px] font-mono tracking-widest text-white/20 uppercase">
                FRIDAY neural interface fully operating
              </div>

            </div>

          </div>

          {/* Zoom Image Overlay Modal */}
          {zoomedImage && (
            <div 
              className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-8 animate-[fadeIn_0.15s_ease-out] cursor-zoom-out"
              onClick={() => setZoomedImage(null)}
            >
              <button className="absolute top-6 right-6 p-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-white">
                <X size={20} />
              </button>
              <img src={zoomedImage} alt="zoomed preview" className="max-w-full max-h-full object-contain rounded-lg border border-white/5 shadow-2xl" />
            </div>
          )}

        </motion.div>
      )}
    </AnimatePresence>
  );
}
