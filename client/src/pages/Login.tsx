import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  if (s > 0 || m === 0) parts.push(`${s} ${s === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // When rate-limited, the server returns 429 + retryAfterSeconds; we count down
  // to this timestamp so the user sees exactly how long until they can retry.
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (lockoutUntil === null) return;
    const tick = (): void => {
      const ms = lockoutUntil - Date.now();
      if (ms <= 0) {
        setLockoutUntil(null);
        setRemainingMs(0);
      } else {
        setRemainingMs(ms);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [lockoutUntil]);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      // First-time accounts have no Profile yet → send them through onboarding;
      // returning users go straight to the app. Profile existence is the guard
      // (GET /profile 404s until onboarding is completed).
      try {
        await api.get('/profile');
        navigate('/', { replace: true });
      } catch {
        navigate('/onboarding', { replace: true });
      }
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string; retryAfterSeconds?: number }>;
      const data = axiosError.response?.data;
      if (axiosError.response?.status === 429 && data?.retryAfterSeconds) {
        // Start (or refresh) the countdown; the lockout message renders separately.
        setLockoutUntil(Date.now() + data.retryAfterSeconds * 1000);
        setError('');
      } else {
        setLockoutUntil(null);
        setError(data?.error ?? 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // The lockout is per account, so switching the username clears a stale countdown.
  const handleUsernameChange = (value: string): void => {
    setUsername(value);
    if (lockoutUntil !== null) setLockoutUntil(null);
  };

  const lockedOut = lockoutUntil !== null && remainingMs > 0;

  return (
    <div className="login-page">
      <main className="login-content">
        <header className="login-hero">
          <h1 className="login-hero-title">CareCompanion</h1>
          <p className="login-hero-subtitle">Caring for the Caregiver</p>
        </header>

        <div className="login-form-section">
        {lockedOut ? (
          <div className="error-message">
            Too many attempts. Please try again in:
            <br />
            <span className="countdown-time">{formatCountdown(remainingMs)}</span>
            <br />
            If you have forgotten your username or access code, contact the study team
            at 734-764-0644 or PMR-CODALab@med.umich.edu.
          </div>
        ) : error ? (
          <div className="error-message">{error}</div>
        ) : null}
        <form onSubmit={handleSubmit}>
          <p className="form-hint">
            Enter the username and access code provided to you by the research team.
          </p>
          <div className="form-group">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={e => handleUsernameChange(e.target.value)}
              required
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label htmlFor="login-access-code">Access Code</label>
            <input
              id="login-access-code"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        </div>

        <aside className="login-note">
          <p className="login-note-lead">
            Access is by invitation only. It is not open to the public at this
            time.
          </p>
        </aside>
      </main>
    </div>
  );
}
