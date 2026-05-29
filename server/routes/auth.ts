import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import auth from '../middleware/auth';

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

function signToken(user: { _id: unknown; username: string }): string {
  return jwt.sign(
    { id: user._id, username: user.username },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' }
  );
}

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const existing = await User.findOne({ username });
    if (existing) {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, passwordHash });

    res.cookie('token', signToken(user), COOKIE_OPTIONS);
    res.status(201).json({ username: user.username });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    res.cookie('token', signToken(user), COOKIE_OPTIONS);
    res.json({ username: user.username });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });
  res.json({ success: true });
});

// Used by the frontend on load to restore session state
router.get('/me', auth, (req: Request, res: Response): void => {
  res.json({ username: req.user?.username });
});

export default router;
