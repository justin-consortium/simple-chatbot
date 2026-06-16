import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import api from '../api/client';

interface User {
  username: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Conversation/continuity state that Chat persists in localStorage. Cleared
// whenever the signed-in identity changes, so one user's in-progress session
// never bleeds into another account's (or a brand-new user's first) session.
// Keep in sync with the keys used in pages/Chat.tsx.
const SESSION_KEYS = ['sessionId', 'sessionMode', 'continuedSummaryId', 'pendingMenu', 'sessionActive', 'lastActiveAt'];
function clearSessionState(): void {
  SESSION_KEYS.forEach(k => localStorage.removeItem(k));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<User>('/auth/me')
      .then(res => setUser(res.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string): Promise<void> => {
    const res = await api.post<User>('/auth/login', { username, password });
    clearSessionState();
    setUser(res.data);
  };

  const register = async (username: string, password: string): Promise<void> => {
    const res = await api.post<User>('/auth/register', { username, password });
    clearSessionState();
    setUser(res.data);
  };

  const logout = async (): Promise<void> => {
    await api.post('/auth/logout');
    clearSessionState();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
