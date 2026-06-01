import { useState, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.get<ChatMessage[]>('/chat/history')
      .then(res => setMessages(res.data))
      .catch(console.error)
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea as content grows
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
        buffer = lines.pop() ?? ''; // hold back potentially incomplete last line

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
        <span className="chat-title">ChatBot</span>
        <div className="chat-header-right">
          <span className="chat-username">{user?.username}</span>
          <button onClick={() => void handleResetOnboarding()} className="btn-logout">Redo onboarding</button>
          <button onClick={() => void handleLogout()} className="btn-logout">Sign out</button>
        </div>
      </header>

      <main className="message-list">
        {historyLoading ? (
          <div className="chat-status">Loading conversation...</div>
        ) : messages.length === 0 ? (
          <div className="chat-status">Send a message to start the conversation.</div>
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
            placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
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
