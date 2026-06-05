import { useState, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AGENT_IMAGE, AGENT_NAME } from '../config/agent';
import api from '../api/client';

interface ChatMessage {
  _id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
}

type SessionState = 'active' | 'sleeping' | 'menu';
type SessionMode = 'vent' | 'reflect' | 'solve' | 'free' | 'continue';

const MENU_HEADINGS = [
  'How would you like to spend this time?',
  'What feels right for this conversation?',
  'What would you like to do with this time?',
  'What would be good for you right now?',
  'What kind of conversation are you in the mood for?',
  'What would you like this time to be?',
];

const MODE_OPTIONS: { mode: SessionMode; label: string; requiresSummary?: boolean }[] = [
  { mode: 'continue', label: 'Continue our last conversation', requiresSummary: true },
  { mode: 'vent',     label: 'Get some feelings out' },
  { mode: 'reflect',  label: 'Make sense of something' },
  { mode: 'solve',    label: 'Figure out what to do' },
];

export default function Chat() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [sessionState, setSessionState] = useState<SessionState>('active');
  const [sessionMode, setSessionMode] = useState<SessionMode>('free');
  const hasPriorSummary = false; // TODO (Layer 1): derive from session summary
  const [menuHeading, setMenuHeading] = useState(MENU_HEADINGS[0]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.get<{ displayName: string }>('/profile')
      .then(res => setDisplayName(res.data.displayName))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get<ChatMessage[]>('/chat/history')
      .then(res => setMessages(res.data))
      .catch(console.error)
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [input]);

  const endSession = () => {
    // TODO (Layer 1): call backend to summarize this session
    setSessionState('sleeping');
  };

  const handleWake = () => {
    setMenuHeading(MENU_HEADINGS[Math.floor(Math.random() * MENU_HEADINGS.length)]);
    setSessionState('menu');
  };

  const handleModeSelect = (mode: SessionMode) => {
    setSessionMode(mode);
    setSessionState('active');
  };

  const handleSkipMenu = () => {
    setSessionMode('free');
    setSessionState('active');
  };

  const handleSend = async (): Promise<void> => {
    const content = input.trim();
    if (!content || isStreaming) return;

    setInput('');
    setIsStreaming(true);

    const userMsg: ChatMessage = { _id: `user-${Date.now()}`, role: 'user', content };
    const assistantMsg: ChatMessage = { _id: 'streaming', role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mode: sessionMode }),
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Request failed');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data) as { token?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.token) {
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant' && last.streaming) {
                  return [...prev.slice(0, -1), { ...last, content: last.content + parsed.token }];
                }
                return prev;
              });
            }
          } catch {
            // skip malformed SSE chunks
          }
        }
      }
    } catch {
      setMessages(prev => {
        const without = prev.filter(m => m._id !== 'streaming');
        return [
          ...without,
          { _id: `err-${Date.now()}`, role: 'assistant', content: 'Something went wrong. Please try again.', error: true },
        ];
      });
    } finally {
      setMessages(prev =>
        prev.map(m =>
          m._id === 'streaming' ? { ...m, _id: `assistant-${Date.now()}`, streaming: false } : m
        )
      );
      setIsStreaming(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate('/login');
  };

  const handleResetOnboarding = async (): Promise<void> => {
    await api.delete('/profile');
    navigate('/onboarding');
  };

  return (
    <div className="chat-layout">

      {sessionState === 'sleeping' && (
        <div
          className="sleep-overlay"
          onClick={handleWake}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleWake(); }}
          role="button"
          tabIndex={0}
          aria-label="Tap to continue"
        >
          <div className="sleep-content">
            <img src={AGENT_IMAGE} alt={AGENT_NAME} className="sleep-avatar" />
            <p className="sleep-label">I'm here whenever you're ready</p>
          <p className="sleep-hint">Tap anywhere to continue</p>
          </div>
        </div>
      )}

      {sessionState === 'menu' && (
        <div className="mode-menu-overlay" onClick={handleSkipMenu}>
          <div className="mode-menu-card" onClick={e => e.stopPropagation()}>
            <img src={AGENT_IMAGE} alt={AGENT_NAME} className="mode-menu-avatar" />
            <h2 className="mode-menu-heading">{menuHeading}</h2>
            <div className="mode-menu-options">
              {MODE_OPTIONS
                .filter(opt => !opt.requiresSummary || hasPriorSummary)
                .map(opt => (
                  <button
                    key={opt.mode}
                    className="ob-option-chip"
                    onClick={() => handleModeSelect(opt.mode)}
                  >
                    {opt.label}
                  </button>
                ))}
            </div>
            <button className="mode-skip-btn" onClick={handleSkipMenu}>
              I don't know — just chat
            </button>
          </div>
        </div>
      )}

      <header className="chat-header">
        <div className="chat-header-inner">
          <div className="chat-header-left">
            <button onClick={endSession} className="btn-dev">
              End session
            </button>
            {import.meta.env.DEV && (
              <button onClick={() => void handleResetOnboarding()} className="btn-dev">
                Redo onboarding
              </button>
            )}
          </div>
          <div className="chat-header-center">
            <img src={AGENT_IMAGE} alt={AGENT_NAME} className="chat-agent-avatar" />
            <span className="chat-title">{AGENT_NAME}</span>
          </div>
          <div className="chat-header-right">
            <span className="chat-username">{displayName || user?.username}</span>
            <button onClick={() => void handleLogout()} className="btn-logout">Sign out</button>
          </div>
        </div>
      </header>

      <main className="message-list">
        {historyLoading ? (
          <div className="chat-empty">Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">Send a message to start the conversation.</div>
        ) : (
          messages.map(msg => (
            <div key={msg._id} className={`message ${msg.role}`}>
              <div className={`bubble${msg.error ? ' bubble-error' : ''}`}>
                {msg.content}
                {msg.streaming && !msg.content && <span className="typing-cursor">▍</span>}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What's on your mind?"
            rows={1}
            disabled={isStreaming}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || isStreaming}
            className="btn-send"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
