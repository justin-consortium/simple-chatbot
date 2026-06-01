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

export default function Chat() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
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
        body: JSON.stringify({ content }),
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
      <header className="chat-header">
        <div className="chat-header-inner">
          <div className="chat-header-left">
            {import.meta.env.DEV && (
              <button onClick={() => void handleResetOnboarding()} className="btn-dev">
                Redo Onboarding
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
