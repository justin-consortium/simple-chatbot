import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface JwtPayload {
  id: string;
  username: string;
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
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
