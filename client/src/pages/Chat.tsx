import { useState, useEffect, useRef, useMemo, Children, isValidElement } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { companionAvatar } from '../config/companions';
import { randomId } from '../lib/uuid';
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

type SessionState = 'active' | 'sleeping' | 'menu' | 'welcome';
type SessionMode = 'vent' | 'reflect' | 'solve' | 'free' | 'continue';

const MENU_HEADING = 'Where do you want to start?';

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
  { mode: 'vent',     label: 'Get my feelings out' },
  { mode: 'reflect',  label: 'Make sense of something' },
  { mode: 'solve',    label: 'Figure out what to do' },
];

// How long the app can sit inactive — idle in the foreground, backgrounded, or
// brought back later — before the in-progress conversation is automatically
// wound down (same effect as pressing "End conversation"). Adjust to taste.
const INACTIVITY_LIMIT_MS = 60 * 60 * 1000; // 1 hour

// Durable session keys live in localStorage so they survive a force-quit (unlike
// per-tab sessionStorage), letting the app tell "resume / wind down / welcome"
// apart on reopen.
const ACTIVE_KEY = 'sessionActive';     // an active conversation is in progress
const LAST_ACTIVE_KEY = 'lastActiveAt'; // timestamp (ms) of the last user activity
// sessionStorage flag: survives a refresh but not a tab close / force-quit, so its
// absence at load distinguishes a cold start from a same-process refresh.
const TAB_ALIVE_KEY = 'tabAlive';

// The browser's IANA timezone (e.g. "America/New_York"), sent with requests so the
// server can render the caregiver's local time. Read fresh each call so it follows
// the device if they travel.
function getTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Records "the user just did something". Used to measure inactivity.
function markActive(): void {
  localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
}

// True when the last activity was longer ago than the inactivity limit. False
// when we've never recorded activity, so a brand-new visitor isn't timed out.
function isIdle(): boolean {
  const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
  return last > 0 && Date.now() - last > INACTIVITY_LIMIT_MS;
}

// Evaluated once per real page load (fresh tab / force-quit reopen / in-tab
// refresh), before React mounts — so StrictMode's double-invoked mount effect
// can't set the flag on its first pass and make the second pass look like a
// refresh. sessionStorage is empty on a fresh tab or force-quit reopen but
// survives an in-tab refresh.
const CRISIS_MESSAGE = "That sounds like you're carrying something really heavy right now. I don't want to just skip past what you said, and I want to take it seriously. If you need help, please call or text 988 (Suicide and Crisis Lifeline), or text HOME to 741741 (Crisis Text Line) — both are available anytime, day or night. For an immediate emergency, please call 911. You don't have to carry this alone, and you don't have to have it all figured out to reach out.";

const COLD_START = !sessionStorage.getItem(TAB_ALIVE_KEY);
sessionStorage.setItem(TAB_ALIVE_KEY, '1');

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
    const stored = localStorage.getItem('sessionMode');
    const valid: SessionMode[] = ['vent', 'reflect', 'solve', 'free', 'continue'];
    return stored && valid.includes(stored as SessionMode) ? (stored as SessionMode) : 'free';
  });
  const [sessionId, setSessionId] = useState<string>(() => {
    const stored = localStorage.getItem('sessionId');
    if (stored) return stored;
    const newId = randomId();
    localStorage.setItem('sessionId', newId);
    return newId;
  });
  const [hasPriorSummary, setHasPriorSummary] = useState(false);
  // _id of the user's latest summary (candidate to continue from).
  const [latestSummaryId, setLatestSummaryId] = useState<string | null>(null);
  // The summary this session is pinned to continue, persisted so a mid-session
  // reload keeps referencing the same one. Null for non-continue sessions.
  const [continuedSummaryId, setContinuedSummaryId] = useState<string | null>(
    () => localStorage.getItem('continuedSummaryId')
  );
  const [sessionEndReady, setSessionEndReady] = useState(false);
  const [preparingLabel, setPreparingLabel] = useState(PREPARING_LABELS[0]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionEndRef = useRef<Promise<void> | null>(null);
  // Guards the one-time mount bootstrap so StrictMode's double-invoked effect
  // (dev only) doesn't run it twice. Resets on a real unmount/remount.
  const didInit = useRef(false);

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
    localStorage.setItem(ACTIVE_KEY, '1');
    markActive();
    const openerMsg: ChatMessage = { _id: 'opener', role: 'assistant', content: '', streaming: true, sessionId: sid };
    setMessages(prev => [...prev, openerMsg]);

    // Turn the streaming opener into a visible error bubble rather than leaving
    // a blank screen when the session can't be started.
    const failOpener = () => {
      setMessages(prev =>
        prev.map(m =>
          m._id === 'opener'
            ? { ...m, content: "I'm having trouble connecting right now. Please refresh to try again.", streaming: false, error: true }
            : m
        )
      );
    };

    try {
      const response = await fetch('/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, sessionId: sid, continuedSummaryId: continuedId ?? undefined, timeZone: getTimeZone() }),
        credentials: 'include',
      });

      if (!response.ok) {
        failOpener();
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
      failOpener();
    } finally {
      setMessages(prev =>
        prev.map(m =>
          m._id === 'opener' ? { ...m, _id: `opener-${Date.now()}`, streaming: false } : m
        )
      );
    }
  };

  // Runs the session-end summarize + reconcile for a given session and remembers
  // the promise so the menu can wait for it. Flips the persisted flags to
  // "between sessions" so a refresh restores the menu rather than the session.
  const runSessionEnd = (sid: string): void => {
    localStorage.removeItem('sessionId');
    localStorage.removeItem('sessionMode');
    localStorage.removeItem(ACTIVE_KEY);
    // Mark that we're between sessions, so a refresh restores the mode menu
    // rather than silently dropping into a new conversation.
    localStorage.setItem('pendingMenu', '1');
    sessionEndRef.current = fetch('/api/session/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid, timeZone: getTimeZone() }),
      credentials: 'include',
    })
      .then(() => {})
      .catch(err => console.error('[endSession]', err))
      .finally(() => setSessionEndReady(true));
  };

  const endSession = (): void => {
    setSessionEndReady(false);
    setPreparingLabel(PREPARING_LABELS[Math.floor(Math.random() * PREPARING_LABELS.length)]);
    runSessionEnd(sessionId);
    setSessionState('sleeping');
  };

  // On mount: gate on onboarding (a missing Profile → onboarding), then load
  // history and prior summary and decide what to show. A cold start (force-quit
  // reopen or fresh tab) is distinguished from a same-process refresh by the
  // sessionStorage tabAlive flag.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

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

      const hasActive = localStorage.getItem(ACTIVE_KEY) !== null;
      const pendingMenu = localStorage.getItem('pendingMenu') !== null;
      const returning = hasActive || pendingMenu || msgs.length > 0 || latest !== null;

      if (COLD_START) {
        // Brand-new visitor with nothing to return to: begin the first session
        // directly (the agent streams its first-time opener — no welcome screen).
        if (!returning) {
          void startSession('free', sessionId);
          return;
        }
        // Returning user reopening the app. If a conversation was still open when
        // they quit, it never got an explicit end — summarize it now so the menu's
        // "continue" option works. The welcome screen covers the wait (its tap is
        // gated on the summarize finishing, same as the resting screen).
        if (hasActive) {
          setSessionEndReady(false);
          setPreparingLabel(PREPARING_LABELS[Math.floor(Math.random() * PREPARING_LABELS.length)]);
          runSessionEnd(localStorage.getItem('sessionId') ?? sessionId);
        } else {
          setSessionEndReady(true);
        }
        setSessionState('welcome');
        return;
      }

      // Same-process refresh from here on.
      // Refreshed while between sessions (paused/sleeping or menu): restore the
      // mode menu rather than dropping into a silent new conversation.
      if (pendingMenu) {
        setSessionState('menu');
        return;
      }

      if (hasActive) {
        // Tab stayed open: wind down if it sat idle past the limit, otherwise
        // resume the conversation in place (same sessionId keeps the divider right).
        if (isIdle()) endSession();
        return;
      }

      // No active session and not between sessions: first-ever start if truly
      // empty, otherwise fall back to the menu rather than a silent new session.
      if (!returning) {
        void startSession('free', sessionId);
      } else {
        setSessionState('menu');
      }
    };

    // Onboarding gate: a missing Profile (404) means this account hasn't
    // onboarded — route to onboarding instead of the resting/chat screen. Any
    // other (transient) error falls through into the app, preserving prior UX.
    api.get<{ displayName: string; avatarId: string }>('/profile')
      .then(res => {
        setDisplayName(res.data.displayName);
        setAvatarId(res.data.avatarId);
        void init();
      })
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          navigate('/onboarding', { replace: true });
          return;
        }
        void init();
      });
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

  // Wind the conversation down after a stretch of inactivity — whether the tab
  // sat idle in the foreground or was backgrounded and brought back. Background
  // timers are throttled/frozen, so we also re-check whenever the page becomes
  // visible again rather than trusting the interval alone. Active sessions only.
  useEffect(() => {
    if (sessionState !== 'active') return;
    // Each keystroke calls markActive(), so active typing keeps resetting the
    // clock. An abandoned half-typed draft (no keystrokes for the whole window)
    // still winds down — the draft text is kept in state, so it's there when the
    // user returns and starts again.
    const check = (): void => { if (isIdle()) endSession(); };
    const onVisible = (): void => { if (document.visibilityState === 'visible') check(); };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState, sessionId]);

  const handleWake = async () => {
    // Wait for the session-end summarization to finish before fetching the
    // latest summary, so the menu reflects the session that just ended.
    if (sessionEndRef.current) {
      await sessionEndRef.current;
      sessionEndRef.current = null;
    }

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
    const newId = randomId();
    localStorage.setItem('sessionId', newId);
    localStorage.setItem('sessionMode', mode);
    localStorage.removeItem('pendingMenu');
    setSessionId(newId);
    setSessionMode(mode);
    setSessionState('active');

    // Pin the summary being continued so the whole session references the same one,
    // even if another session ends and becomes "latest" in the meantime.
    const pinned = mode === 'continue' ? latestSummaryId : null;
    setContinuedSummaryId(pinned);
    if (pinned) localStorage.setItem('continuedSummaryId', pinned);
    else localStorage.removeItem('continuedSummaryId');

    void startSession(mode, newId, pinned);
  };

  const handleSkipMenu = () => {
    const newId = randomId();
    localStorage.setItem('sessionId', newId);
    localStorage.setItem('sessionMode', 'free');
    localStorage.removeItem('pendingMenu');
    setSessionId(newId);
    setSessionMode('free');
    setSessionState('active');
    setContinuedSummaryId(null);
    localStorage.removeItem('continuedSummaryId');
    void startSession('free', newId, null);
  };

  const handleSend = async (): Promise<void> => {
    const content = input.trim();
    if (!content || isStreaming) return;

    markActive();
    setInput('');
    setIsStreaming(true);

    const userMsg: ChatMessage = { _id: `user-${Date.now()}`, role: 'user', content, sessionId };
    const assistantMsg: ChatMessage = { _id: 'streaming', role: 'assistant', content: '', streaming: true, sessionId };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, mode: sessionMode, sessionId, continuedSummaryId: continuedSummaryId ?? undefined, timeZone: getTimeZone() }),
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
            const parsed = JSON.parse(data) as { token?: string; error?: string; filtered?: boolean };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.filtered) {
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant' && last.streaming) {
                  return [...prev.slice(0, -1), { ...last, content: CRISIS_MESSAGE }];
                }
                return prev;
              });
            }
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
        prev.map(m => {
          if (m._id !== 'streaming') return m;
          return {
            ...m,
            _id: `assistant-${Date.now()}`,
            streaming: false,
            content: m.content || "Something got in the way on my end. I'm still here — could you try again?",
          };
        })
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

  // Hold back the chat shell until init has decided what to show (it flips
  // historyLoading off and sets the right state in the same batch). Otherwise a
  // cold-start welcome flashes the chat interface for a moment beforehand.
  if (historyLoading) {
    return <div className="chat-layout" aria-busy="true" />;
  }

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
            {/* curious (busy/alert) while the summary is being prepared, resting once it's done */}
            <img src={companionAvatar(avatarId, sessionEndReady ? 'resting' : 'curious')} alt="Companion" className="sleep-avatar" />
            <p className="sleep-label">I'm here whenever you need me</p>
            {sessionEndReady ? (
              <p className="sleep-hint">Tap anywhere to continue</p>
            ) : (
              <p className="sleep-preparing">{preparingLabel}</p>
            )}
          </div>
        </div>
      )}

      {sessionState === 'welcome' && (
        <div
          className="sleep-overlay"
          onClick={sessionEndReady ? () => void handleWake() : undefined}
          onKeyDown={sessionEndReady ? e => { if (e.key === 'Enter' || e.key === ' ') void handleWake(); } : undefined}
          role="button"
          tabIndex={sessionEndReady ? 0 : -1}
          aria-label="Tap to start"
        >
          <div className="sleep-content">
            {/* curious (busy/alert) while the prior session is being summarized, waving once it's ready */}
            <img src={companionAvatar(avatarId, sessionEndReady ? 'waving' : 'curious')} alt="Companion" className="sleep-avatar" />
            <p className="sleep-label">Welcome back</p>
            {sessionEndReady ? (
              <p className="sleep-hint">Tap anywhere to start</p>
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
            <h2 className="mode-menu-heading">{MENU_HEADING}</h2>
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
            onChange={e => { markActive(); setInput(e.target.value); }}
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
