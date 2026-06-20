// Renders the {{TIME_CONTEXT}} block injected into the system prompt. Gives the
// model the caregiver's current local time (precise — needed to resolve "tomorrow",
// "this evening", and to judge whether dated plans have passed) plus a deliberately
// coarse, non-numeric sense of how long since the last conversation.
//
// The gap is presented as a labeled reference datum, not a ready-made sentence, and
// the block is marked background-only: the companion may draw on it if it naturally
// fits, but never opens with it or remarks on how long the caregiver has been away.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Intl inserts a narrow no-break space (U+202F) before AM/PM; normalize it (and a
// regular nbsp, U+00A0) to a plain space so prompt text and logs stay clean ASCII.
function normalizeSpaces(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, " ");
}

function formatLocal(now: Date, timeZone: string): string {
  return normalizeSpaces(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(now)
  );
}

// Calendar-day distance between two instants, evaluated in the given zone. Uses the
// YYYY-MM-DD local-day key parsed as UTC midnight so the result is DST-safe and
// independent of wall-clock time within each day.
function localDaysApart(now: Date, last: Date, timeZone: string): number {
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return Math.round((Date.parse(dayKey(now)) - Date.parse(dayKey(last))) / DAY_MS);
}

// Coarse phrase for the gap since the last conversation, or null to omit it (just
// talked / resuming). Stays approximate, never an exact count, and tops out at
// "a while ago" so long absences don't read as blaming or surveillance-like.
function gapPhrase(now: Date, last: Date, timeZone: string): string | null {
  const ms = now.getTime() - last.getTime();
  if (ms < HOUR_MS) return null;

  const days = localDaysApart(now, last, timeZone);
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 5) return 'a few days ago';
  if (days < 14) return 'about a week ago';
  return 'a while ago';
}

// Date-only local label (e.g. "Friday, June 20, 2026"), used to anchor the
// summarizer/reconcile so they can resolve relative time references to absolute dates.
export function localDateLabel(timeZone?: string, now: Date = new Date()): string {
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return normalizeSpaces(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(now)
  );
}

export interface TimeContextInput {
  now?: Date;                  // defaults to current server instant
  timeZone?: string;           // IANA zone from the client; falls back to UTC
  lastSessionAt?: Date | null; // last activity before this session, or null on first
}

export function renderTimeContext({ now = new Date(), timeZone, lastSessionAt }: TimeContextInput): string {
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const gap = lastSessionAt ? gapPhrase(now, lastSessionAt, tz) : null;

  const head = `Current local time: ${formatLocal(now, tz)}.`;
  if (!gap) {
    return `# TIME CONTEXT\n${head} (Background — don't recite.)`;
  }
  return (
    `# TIME CONTEXT\n${head}\n` +
    `Last conversation: ${gap}. (Background — reference only if it naturally fits; don't open with it or remark on the gap.)`
  );
}
