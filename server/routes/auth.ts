import { Router } from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { RateLimitInfo } from 'express-rate-limit';
import User from '../models/User';
import auth, { setAuthCookie } from '../middleware/auth';

const router = Router();

// A precomputed hash to compare against when the username doesn't exist, so an
// unknown account costs roughly the same time/CPU as a real one (no cheap
// "instant reject" that would let someone enumerate valid usernames by timing).
const DUMMY_HASH = bcrypt.hashSync('unused-account-placeholder', 12);

// The rate-limit key: one bucket per (IP, account). Kept as a named helper so
// the login handler can reset the exact same key on a successful login.
// ipKeyGenerator normalizes the IP (incl. IPv6); the username is normalized
// (trim + lowercase) so the key can't be bypassed by changing case or padding.
const loginRateKey = (req: Request): string =>
  `${ipKeyGenerator(req.ip ?? '')}:${(req.body?.username ?? '').trim().toLowerCase()}`;

// Brute-force protection (Layer 1): cap failed login attempts, keyed on
// IP + username so a burst of failures against one account can't lock out other
// accounts behind the same IP (a shared clinic / household / campus network, or
// one machine testing many accounts). Each account still gets its own capped
// budget, so brute-forcing a single account stays throttled. A successful login
// resets that key (see the handler), so a user who fumbles then gets in isn't
// left penalized; the cap also shields CPU from bcrypt spam. Requires
// `trust proxy` (server.ts) so the key uses the real client IP. See
// login-precreated-accounts-spec.md §8-9.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // failed attempts per account, per IP, per window (locks on the 6th)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: loginRateKey,
  // Include the seconds until the window resets so the client can show a live
  // countdown. Sent in the body (not just headers) so it's readable regardless
  // of CORS header exposure.
  handler: (req, res) => {
    const resetTime = (req as Request & { rateLimit?: RateLimitInfo }).rateLimit?.resetTime;
    const retryAfterSeconds = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : 15 * 60;
    res.status(429).json({
      error:
        'Too many attempts. If you have forgotten your username or access code, ' +
        'contact the study team at 734-764-0644 or PMR-CODALab@med.umich.edu.',
      retryAfterSeconds,
    });
  },
});

router.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string };

  const name = username?.trim();
  const code = password?.trim();
  if (!name || !code) {
    res.status(400).json({ error: 'Username and access code required' });
    return;
  }

  try {
    // Case-insensitive username match (collation strength 2) so CCT07/cct07 and
    // existing mixed-case dev usernames all resolve to the same account.
    const user = await User.findOne({ username: name }).collation({ locale: 'en', strength: 2 });

    if (!user) {
      await bcrypt.compare(code, DUMMY_HASH); // equalize timing; result ignored
      res.status(401).json({ error: 'Invalid username or access code' });
      return;
    }

    // Case-insensitive access code via a two-step compare: try the code exactly
    // as typed first (so existing dev accounts' mixed-case passwords still
    // match), then its uppercased form (so participants can type their all-caps
    // code in any case). Skip the second compare when the input is already
    // uppercase — it would be identical work. See spec §6.
    const valid =
      (await bcrypt.compare(code, user.passwordHash)) ||
      (code !== code.toUpperCase() && (await bcrypt.compare(code.toUpperCase(), user.passwordHash)));
    if (!valid) {
      res.status(401).json({ error: 'Invalid username or access code' });
      return;
    }

    setAuthCookie(res, user);
    // A correct login clears this account's accumulated failed-attempt count, so
    // the next genuine mistake starts from a full budget again.
    loginLimiter.resetKey(loginRateKey(req));
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
