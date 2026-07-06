import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

// Deterministic tests for the login/session middleware — no DB, no network.
// Run with: node --import tsx --test server/middleware/auth.test.ts

// JWT_SECRET is only read inside signToken/verify at call time (not at module
// load), so setting it here — before any test body runs — is sufficient.
process.env.JWT_SECRET = 'test-secret';

import auth, { signToken, setAuthCookie, COOKIE_OPTIONS } from './auth';

const SECRET = process.env.JWT_SECRET;
const DAY = 24 * 60 * 60 * 1000;
const USER = { _id: 'u123', username: 'alice' };

// --- Minimal Express req/res/next fakes -----------------------------------
function makeRes() {
  const res: any = { statusCode: 200, body: undefined, cookies: [] as any[] };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.cookie = (name: string, val: string, opts: unknown) => {
    res.cookies.push({ name, val, opts });
    return res;
  };
  return res;
}
function runAuth(token: string | undefined) {
  const req: any = { cookies: token === undefined ? {} : { token } };
  const res = makeRes();
  let nextCalled = false;
  auth(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}
// Craft a token whose iat is `ageMs` in the past (no exp unless given).
function tokenIssuedAgo(ageMs: number) {
  const iat = Math.floor((Date.now() - ageMs) / 1000);
  return jwt.sign({ id: USER._id, username: USER.username, iat }, SECRET as string);
}

// --- signToken / cookie config --------------------------------------------
test('signToken sets a ~6-month (180d) expiry', () => {
  const decoded = jwt.verify(signToken(USER), SECRET as string) as jwt.JwtPayload;
  const ttl = (decoded.exp as number) - (decoded.iat as number);
  assert.equal(ttl, 180 * 24 * 60 * 60); // exactly 180 days in seconds
  assert.equal(decoded.id, 'u123');
  assert.equal(decoded.username, 'alice');
});

test('cookie maxAge matches the 180-day token TTL and is httpOnly', () => {
  assert.equal(COOKIE_OPTIONS.maxAge, 180 * DAY);
  assert.equal(COOKIE_OPTIONS.httpOnly, true);
  assert.equal(COOKIE_OPTIONS.sameSite, 'strict');
});

test('setAuthCookie writes a verifiable token cookie', () => {
  const res = makeRes();
  setAuthCookie(res, USER);
  assert.equal(res.cookies.length, 1);
  const { name, val, opts } = res.cookies[0];
  assert.equal(name, 'token');
  assert.equal((opts as any).maxAge, 180 * DAY);
  const decoded = jwt.verify(val, SECRET as string) as jwt.JwtPayload;
  assert.equal(decoded.username, 'alice');
});

// --- middleware: authentication gate --------------------------------------
test('rejects request with no token (401, next not called)', () => {
  const { res, nextCalled } = runAuth(undefined);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Not authenticated');
});

test('rejects a garbage/invalid token (401)', () => {
  const { res, nextCalled } = runAuth('not-a-real-jwt');
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Invalid or expired token');
});

test('rejects a token signed with the wrong secret (401)', () => {
  const forged = jwt.sign({ id: 'x', username: 'mallory' }, 'wrong-secret');
  const { res, nextCalled } = runAuth(forged);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('rejects an expired token (401) — simulates 6 months of inactivity', () => {
  const expired = jwt.sign({ id: USER._id, username: USER.username }, SECRET as string, {
    expiresIn: '-1s', // already expired
  });
  const { res, nextCalled } = runAuth(expired);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('accepts a valid token and populates req.user', () => {
  const { req, res, nextCalled } = runAuth(signToken(USER));
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(req.user, { id: 'u123', username: 'alice' });
});

// --- sliding renewal -------------------------------------------------------
test('fresh token (issued just now) is NOT re-issued', () => {
  const { res, nextCalled } = runAuth(signToken(USER));
  assert.equal(nextCalled, true);
  assert.equal(res.cookies.length, 0, 'should not set a new cookie for a fresh token');
});

test('token issued <1 day ago is NOT re-issued', () => {
  const { res } = runAuth(tokenIssuedAgo(12 * 60 * 60 * 1000)); // 12h old
  assert.equal(res.cookies.length, 0);
});

test('token issued >1 day ago IS re-issued, sliding the window forward', () => {
  const { res, nextCalled } = runAuth(tokenIssuedAgo(2 * DAY)); // 2 days old
  assert.equal(nextCalled, true);
  assert.equal(res.cookies.length, 1, 'active use should refresh the cookie');

  const { val, opts } = res.cookies[0];
  assert.equal((opts as any).maxAge, 180 * DAY);
  // The re-issued token is fresh: its expiry is ~180 days out from NOW, not from
  // the old iat — proving the window actually slid forward.
  const decoded = jwt.verify(val, SECRET as string) as jwt.JwtPayload;
  const secondsUntilExp = (decoded.exp as number) - Math.floor(Date.now() / 1000);
  assert.ok(secondsUntilExp > 179 * 24 * 60 * 60, 'renewed token should expire ~180d from now');
  assert.equal(decoded.username, 'alice');
});
