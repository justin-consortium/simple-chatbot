import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTimeContext, localDateLabel } from './timeService';

// Deterministic tests for the date math — no API, no DB. Run with:
//   node --import tsx --test server/services/timeService.test.ts

const NOW = new Date('2026-06-20T23:42:00Z'); // NY: Sat Jun 20, 7:42 PM (EDT); Tokyo: Sun Jun 21, 8:42 AM
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const NY = 'America/New_York';

function render(timeZone: string, lastSessionAt: Date | null): string {
  return renderTimeContext({ now: NOW, timeZone, lastSessionAt });
}
// The "Last conversation: X." phrase, or null when the line is absent.
function gap(timeZone: string, lastSessionAt: Date | null): string | null {
  const m = render(timeZone, lastSessionAt).match(/Last conversation: ([^.]+)\./);
  return m ? m[1] : null;
}

test('gap: omitted on first session and on quick (<1h) resume', () => {
  assert.equal(gap(NY, null), null);
  assert.equal(gap(NY, ago(30 * 60 * 1000)), null);
  assert.equal(gap(NY, ago(59 * 60 * 1000)), null);
});

test('gap: bucket boundaries', () => {
  assert.equal(gap(NY, ago(61 * 60 * 1000)), 'earlier today'); // just over an hour, same day
  assert.equal(gap(NY, ago(3 * HOUR)), 'earlier today');
  assert.equal(gap(NY, ago(28 * HOUR)), 'yesterday');
  assert.equal(gap(NY, ago(3 * DAY)), 'a few days ago');
  assert.equal(gap(NY, ago(4 * DAY)), 'a few days ago');    // 4 → still "a few"
  assert.equal(gap(NY, ago(5 * DAY)), 'about a week ago');  // 5 → "about a week"
  assert.equal(gap(NY, ago(7 * DAY)), 'about a week ago');
  assert.equal(gap(NY, ago(13 * DAY)), 'about a week ago');
  assert.equal(gap(NY, ago(14 * DAY)), 'a while ago');      // 14 → "a while"
  assert.equal(gap(NY, ago(90 * DAY)), 'a while ago');      // never says months
});

test('current local time renders in the given zone', () => {
  assert.match(render(NY, null), /Current local time: Saturday, June 20, 2026 at 7:42 PM\./);
  assert.match(render('Asia/Tokyo', null), /Current local time: Sunday, June 21, 2026 at 8:42 AM\./);
  assert.match(render('UTC', null), /Current local time: Saturday, June 20, 2026 at 11:42 PM\./);
});

test('invalid/missing timezone falls back to UTC without throwing', () => {
  assert.equal(render('Not/AZone', null), render('UTC', null));
  assert.equal(renderTimeContext({ now: NOW, lastSessionAt: null }), render('UTC', null));
});

test('DST handled via IANA zone (no manual offset math)', () => {
  // Same wall-clock instant, winter vs summer → EST (-5) vs EDT (-4).
  const winter = new Date('2026-01-15T17:00:00Z');
  const summer = new Date('2026-07-15T17:00:00Z');
  assert.match(renderTimeContext({ now: winter, timeZone: NY, lastSessionAt: null }), /12:00 PM/);
  assert.match(renderTimeContext({ now: summer, timeZone: NY, lastSessionAt: null }), /1:00 PM/);
});

test('localDateLabel is date-only and zone-aware', () => {
  assert.equal(localDateLabel(NY, NOW), 'Saturday, June 20, 2026');
  assert.equal(localDateLabel('Asia/Tokyo', NOW), 'Sunday, June 21, 2026'); // crosses into next day
  assert.equal(localDateLabel('Not/AZone', NOW), localDateLabel('UTC', NOW));
});
