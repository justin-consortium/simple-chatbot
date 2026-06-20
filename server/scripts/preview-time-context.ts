import { renderTimeContext } from '../services/timeService';

// Developer-facing preview of the {{TIME_CONTEXT}} block across gap lengths and
// timezones. No API key, no database — just prints what the model would see, so we can
// review the wording without running the real app. Run with:
//   npx tsx server/scripts/preview-time-context.ts
//
// `now` is pinned to a fixed instant so the output is identical every run (a test
// fixture, not an app setting). Timezones are just example zones to render in.

const NOW = new Date('2026-06-20T23:42:00Z'); // fixed "current moment" for repeatable output
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

// label = a human caption for each scenario (printout only, not used by app logic).
const cases: Array<{ label: string; timeZone?: string; lastSessionAt: Date | null }> = [
  { label: 'First session (no prior)',         timeZone: 'America/New_York', lastSessionAt: null },
  { label: 'Resumed <1h ago (gap omitted)',    timeZone: 'America/New_York', lastSessionAt: ago(30 * MIN) },
  { label: 'Earlier today',                    timeZone: 'America/New_York', lastSessionAt: ago(3 * HOUR) },
  { label: 'Yesterday',                        timeZone: 'America/New_York', lastSessionAt: ago(28 * HOUR) },
  { label: 'A few days ago (3 days)',          timeZone: 'America/New_York', lastSessionAt: ago(3 * DAY) },
  { label: 'About a week ago (8 days)',        timeZone: 'America/New_York', lastSessionAt: ago(8 * DAY) },
  { label: 'A while ago (3 months)',           timeZone: 'America/New_York', lastSessionAt: ago(90 * DAY) },
  { label: 'Non-US timezone (Tokyo)',          timeZone: 'Asia/Tokyo',       lastSessionAt: ago(3 * DAY) },
  { label: 'Missing/invalid timezone (→ UTC)', timeZone: 'Not/AZone',        lastSessionAt: ago(3 * DAY) },
];

for (const c of cases) {
  console.log('\n' + '='.repeat(78));
  console.log(c.label + (c.timeZone ? `  [${c.timeZone}]` : ''));
  console.log('-'.repeat(78));
  console.log(renderTimeContext({ now: NOW, timeZone: c.timeZone, lastSessionAt: c.lastSessionAt }));
}
console.log('\n' + '='.repeat(78));
