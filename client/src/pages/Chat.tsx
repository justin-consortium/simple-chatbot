import { useState, useEffect, useRef, useMemo, Children, isValidElement } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { companionAvatar } from '../config/companions';
import api from '../api/client';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

const markdownComponents: Components = {
  li({ children, node: _node, ...props }) {
    // react-markdown wraps loose list item text in <p>; unwrap it so the
    // bullet and text stay on the same line.
    const unwrapped = Children.map(children, child =>
      isValidElement(child) && (child as ReactElement<{ children: React.ReactNode }>).type === 'p'
        ? (child as ReactElement<{ children: React.ReactNode }>).props.children
        : child
    );
    return <li {...props}>{unwrapped}</li>;
  },
};

interface ChatMessage {
  _id: string;
  role: 'user' | 'assistant';
  content: string;
  sessionId?: string;
  streaming?: boolean;
  error?: boolean;
}

interface SessionDivider {
  type: 'divider';
  _id: string;
}

type MessageItem = ChatMessage | SessionDivider;

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

// Shown one at a time while the session-end summarize + reconcile finishes, so
// the resting screen feels like the companion is gently getting ready rather
// than frozen. Picked once per wind-down so it doesn't flicker.
const PREPARING_LABELS = [
  'Just putting the kettle on…',
  'Tidying up a little…',
  'Pulling up a chair…',
  'Getting us settled…',
  'Gathering my thoughts…',
  'Making a little space…',
  'Straightening the cushions…',
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
  const [avatarId, setAvatarId] = useState('');
  const [sessionState, setSessionState] = useState<SessionState>('active');
  const [sessionMode, setSessionMode] = useState<SessionMode>(() => {
    const stored = sessionStorage.getItem('sessionMode');
    const valid: SessionMode[] = ['vent', 'reflect', 'solve', 'free', 'continue'];
    return stored && valid.includes(stored as SessionMode) ? (stored as SessionMode) : 'free';
  });
  const [sessionId, setSessionId] = useState<string>(() => {
    const stored = sessionStorage.getItem('sessionId');
    if (stored) return stored;
    const newId = crypto.randomUUID();
    sessionStorage.setItem('sessionId', newId);
    return newId;
  });
  const [hasPriorSummary, setHasPriorSummary] = useState(false);
  // _id of the user's latest summary (candidate to continue from).
  const [latestSummaryId, setLatestSummaryId] = useState<string | null>(null);
  // The summary this session is pinned to continue, persisted so a mid-session
  // reload keeps referencing the same one. Null for non-continue sessions.
  const [continuedSummaryId, setContinuedSummaryId] = useState<string | null>(
    () => sessionStorage.getItem('continuedSummaryId')
  );
  const [menuHeading, setMenuHeading] = useState(MENU_HEADINGS[0]);
  const [sessionEndReady, setSessionEndReady] = useState(false);
  const [preparingLabel, setPreparingLabel] = useState(PREPARING_LABELS[0]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionEndRef = useRef<Promise<void> | null>(null);

  // Inserts a single "New conversation" divider where the current session begins,
  // separating it from the earlier history. Older sessions in the history flow
  // continuously (no dividers between them). No divider on the first-ever
  // conversation (nothing precedes it) or while only history is shown.
  const displayItems = useMemo((): MessageItem[] => {
    const firstCurrentIdx = messages.findIndex(m => m.sessionId === sessionId);
    const items: MessageItem[] = [];
    messages.forEach((msg, i) => {
      if (i === firstCurrentIdx && firstCurrentIdx > 0) {
        items.push({ type: 'divider', _id: 'div-current' });
      }
      items.push(msg);
    });
    return items;
  }, [messages, sessionId]);

  // Streams the agent's opening message for a new session.
  const startSession = async (mode: string, sid: string, continuedId?: string | null) => {
    const openerMsg: ChatMessage = { _id: 'opener', role: 'assistant', content: '', streaming: true, sessionId: sid };
    setMessages(prev => [...prev, openerMsg]);

    try {
      const response = await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, sessionId: sid, continuedSummaryId: continuedId ?? undefined }),
        credentials: 'include',
      });

      if (!response.ok) {
        setMessages([]);
        return;
      }

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
            const parsed = JSON.parse(data) as { token?: string };
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
      setMessages([]);
    } finally {
      setMessages(prev =>
        prev.map(m =>
          m._id === 'opener' ? { ...m, _id: `opener-${Date.now()}`, streaming: false } : m
        )
      );
    }
  };

  // On mount: load profile display name, history, and prior summary in parallel.
  // Trigger first-session opener if the user has no history and no prior summaries.
  useEffect(() => {
    api.get<{ displayName: string; avatarId: string }>('/profile')
      .then(res => {
        setDisplayName(res.data.displayName);
        setAvatarId(res.data.avatarId);
      })
      .catch(() => {});

    const init = async () => {
      const [historyResult, summaryResult] = await Promise.allSettled([
        api.get<ChatMessage[]>('/chat/history'),
        api.get<{ summary: { _id: string } | null }>('/session/latest-summary'),
      ]);

      const msgs = historyResult.status === 'fulfilled' ? historyResult.value.data : [];
      const latest = summaryResult.status === 'fulfilled' ? summaryResult.value.data.summary : null;

      setMessages(msgs);
      setHasPriorSummary(latest !== null);
      setLatestSummaryId(latest?._id ?? null);
      setHistoryLoading(false);

      // Refreshed while between sessions (paused/sleeping or menu): restore the
      // mode menu rather than dropping into a silent new conversation. The
      // summary fetched above already populates the "continue" option.
      if (sessionStorage.getItem('pendingMenu')) {
        setMenuHeading(MENU_HEADINGS[Math.floor(Math.random() * MENU_HEADINGS.length)]);
        setSessionState('menu');
        return;
      }

      if (latest === null && msgs.length === 0) {
        void startSession('free', sessionId);
      }
    };

    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    sessionStorage.removeItem('sessionId');
    sessionStorage.removeItem('sessionMode');
    // Mark that we're between sessions, so a refresh restores the mode menu
    // rather than silently dropping into a new conversation.
    sessionStorage.setItem('pendingMenu', '1');
    setSessionEndReady(false);
    setPreparingLabel(PREPARING_LABELS[Math.floor(Math.random() * PREPARING_LABELS.length)]);
    sessionEndRef.current = fetch('/api/session/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      credentials: 'include',
    })
      .then(() => {})
      .catch(err => console.error('[endSession]', err))
      .finally(() => setSessionEndReady(true));

    setSessionState('sleeping');
  };

  const handleWake = async () => {
    // Wait for the session-end summarization to finish before fetching the
    // latest summary, so the menu reflects the session that just ended.
    if (sessionEndRef.current) {
      await sessionEndRef.current;
      sessionEndRef.current = null;
    }

    setMenuHeading(MENU_HEADINGS[Math.floor(Math.random() * MENU_HEADINGS.length)]);
    try {
      const res = await api.get<{ summary: { _id: string } | null }>('/session/latest-summary');
      setHasPriorSummary(res.data.summary !== null);
      setLatestSummaryId(res.data.summary?._id ?? null);
    } catch {
      // keep existing value if fetch fails
    }
    setSessionState('menu');
  };

  const handleModeSelect = (mode: SessionMode) => {
    const newId = crypto.randomUUID();
    sessionStorage.setItem('sessionId', newId);
    sessionStorage.setItem('sessionMode', mode);
    sessionStorage.removeItem('pendingMenu');
    setSessionId(newId);
    setSessionMode(mode);
    setSessionState('active');

    // Pin the summary being continued so the whole session references the same one,
    // even if another session ends and becomes "latest" in the meantime.
    const pinned = mode === 'continue' ? latestSummaryId : null;
    setContinuedSummaryId(pinned);
    if (pinned) sessionStorage.setItem('continuedSummaryId', pinned);
    else sessionStorage.removeItem('continuedSummaryId');

    void startSession(mode, newId, pinned);
  };

  const handleSkipMenu = () => {
    const newId = crypto.randomUUID();
    sessionStorage.setItem('sessionId', newId);
    sessionStorage.setItem('sessionMode', 'free');
    sessionStorage.removeItem('pendingMenu');
    setSessionId(newId);
    setSessionMode('free');
    setSessionState('active');
    setContinuedSummaryId(null);
    sessionStorage.removeItem('continuedSummaryId');
    void startSession('free', newId, null);
  };

  const handleSend = async (): Promise<void> => {
    const content = input.trim();
    if (!content || isStreaming) return;

    setInput('');
    setIsStreaming(true);

    const userMsg: ChatMessage = { _id: `user-${Date.now()}`, role: 'user', content, sessionId };
    const assistantMsg: ChatMessage = { _id: 'streaming', role: 'assistant', content: '', streaming: true, sessionId };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mode: sessionMode, sessionId, continuedSummaryId: continuedSummaryId ?? undefined }),
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

  return (
    <div className="chat-layout">

      {sessionState === 'sleeping' && (
        <div
          className="sleep-overlay"
          onClick={sessionEndReady ? () => void handleWake() : undefined}
          onKeyDown={sessionEndReady ? e => { if (e.key === 'Enter' || e.key === ' ') void handleWake(); } : undefined}
          role="button"
          tabIndex={sessionEndReady ? 0 : -1}
          aria-label="Tap to continue"
        >
          <div className="sleep-content">
            <img src={companionAvatar(avatarId, 'resting')} alt="Companion" className="sleep-avatar" />
            <p className="sleep-label">I'm here whenever you need me</p>
            {sessionEndReady ? (
              <p className="sleep-hint">Tap anywhere to continue</p>
            ) : (
              <p className="sleep-preparing">{preparingLabel}</p>
            )}
          </div>
        </div>
      )}

      {sessionState === 'menu' && (
        <div className="mode-menu-overlay" onClick={handleSkipMenu}>
          <div className="mode-menu-card" onClick={e => e.stopPropagation()}>
            <img src={companionAvatar(avatarId, 'waving')} alt="Companion" className="mode-menu-avatar" />
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
              <button className="ob-option-chip" onClick={handleSkipMenu}>
                I don't know — just chat
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="chat-header">
        <div className="chat-header-inner">
          <div className="chat-header-left">
            <button onClick={endSession} className="btn-logout">
              End conversation
            </button>
          </div>
          <div className="chat-header-center">
            <img src={companionAvatar(avatarId, 'standing')} alt="Companion" className="chat-agent-avatar" />
          </div>
          <div className="chat-header-right">
            <span className="chat-username">{displayName || user?.username}</span>
            <button onClick={() => void handleLogout()} className="btn-logout">Sign out</button>
          </div>
        </div>
      </header>

      <main className="message-list">
        {historyLoading ? null : messages.length === 0 ? (
          <div className="chat-empty">Send a message to start the conversation.</div>
        ) : (
          displayItems.map(item =>
            'type' in item && item.type === 'divider' ? (
              <div key={item._id} className="session-divider">
                <span>New conversation</span>
              </div>
            ) : (
              <div key={item._id} className={`message ${(item as ChatMessage).role}`}>
                <div className={`bubble${(item as ChatMessage).error ? ' bubble-error' : ''}`}>
                  {(item as ChatMessage).role === 'assistant' ? (
                    <ReactMarkdown components={markdownComponents}>{(item as ChatMessage).content}</ReactMarkdown>
                  ) : (
                    (item as ChatMessage).content
                  )}
                  {(item as ChatMessage).streaming && !(item as ChatMessage).content && (
                    <span className="typing-cursor">▍</span>
                  )}
                </div>
              </div>
            )
          )
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
