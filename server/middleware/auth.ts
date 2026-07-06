import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface JwtPayload {
  id: string;
  username: string;
  iat?: number;
  exp?: number;
}

// Sliding-session window: from any activity, the user stays logged in for this
// long. Using the app at least once every 6 months keeps them logged in forever;
// only an explicit sign out or 6 months of inactivity ends the session.
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // ~6 months
const TOKEN_TTL_SECONDS = TOKEN_TTL_MS / 1000;

// Re-issue the token at most once per day so we slide the window forward on
// activity without setting a fresh cookie on every single request.
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000; // 1 day

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: TOKEN_TTL_MS,
};

export function signToken(user: { _id?: unknown; id?: unknown; username: string }): string {
  return jwt.sign(
    { id: user._id ?? user.id, username: user.username },
    process.env.JWT_SECRET as string,
    { expiresIn: TOKEN_TTL_SECONDS }
  );
}

export function setAuthCookie(res: Response, user: { _id?: unknown; id?: unknown; username: string }): void {
  res.cookie('token', signToken(user), COOKIE_OPTIONS);
}

// Augment Express's Request type globally so all routes can access req.user
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; username: string };
    }
  }
}

export default function auth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    req.user = { id: payload.id, username: payload.username };

    // Sliding renewal: if the token was issued more than a day ago, re-issue it
    // so continued activity keeps pushing the 6-month expiry forward.
    const issuedAtMs = (payload.iat ?? 0) * 1000;
    if (Date.now() - issuedAtMs > REFRESH_AFTER_MS) {
      setAuthCookie(res, { id: payload.id, username: payload.username });
    }

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
