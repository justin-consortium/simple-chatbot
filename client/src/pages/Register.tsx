import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AxiosError } from 'axios';
import { useAuth } from '../context/AuthContext';
import { useAgentConfig } from '../hooks/useAgentConfig';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const { agentName } = useAgentConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(username, password);
      navigate('/onboarding');
    } catch (err) {
      const axiosError = err as AxiosError<{ error: string }>;
      setError(axiosError.response?.data?.error ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-agent">
          <div className="agent-avatar">{agentName ? agentName[0] : '?'}</div>
          <span className="agent-name">{agentName || ' '}</span>
        </div>
        <h2>Create Account</h2>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="register-username">Username</label>
            <input
              id="register-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              minLength={3}
              maxLength={30}
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label htmlFor="register-password">
              Password <span className="hint">(min. 8 characters)</span>
            </label>
            <input
              id="register-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>
        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
