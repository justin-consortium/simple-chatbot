# Time Context Spec — Local Time, Elapsed-Since-Last-Session, and Time-Anchored Memory

**Status:** Spec for implementation (Claude Code)

**Touches:** client request bodies · `/chat/message` · `/session/start` · `/session/end` ·
`buildSystemPrompt` · `background.txt` · `summarize-prompt.txt` · `reconcile-prompt.txt` ·
a new time helper · (optionally) `Summary` model

---

## 0. Why

The companion is currently time-blind. The server builds every prompt from
`new Date()` (UTC server time) with no notion of the user's local time, and nothing
about elapsed time ever reaches the model. Consequences:

- It doesn't know what day or time it is *for the caregiver*, so "this evening,"
  "tomorrow," "next Friday" in the live conversation can't be resolved.
- It has no idea how long it's been since the last conversation, so it can implicitly
  assume a daily cadence ("talk to you tomorrow") that may be wrong.
- A future plan mentioned in a past session ("the neurology appointment next Friday")
  is stored as vague free text, so a later session can't tell whether it has happened.

## 1. Goals

1. **In-session awareness.** The model knows the caregiver's current local date and
   time, so relative references in the live conversation resolve correctly.
2. **Elapsed awareness.** The model knows roughly how long since the last
   conversation, and never assumes a fixed cadence.
3. **Time-anchored memory (cross-session).** Relative time phrases captured into
   memory are resolved to **absolute dates at write time**, so a future session can
   tell whether they're past or still upcoming.

### In-session vs cross-session

- **In-session** — within one conversation: interpret "tonight / tomorrow / next
  Friday" against *now*.
- **Cross-session** — across conversations: (a) know how long since last chat, and
  (b) tell whether a previously-mentioned timepoint has passed. (3) above is what
  makes (b) possible.

---

## 2. Time source — client-supplied timezone (not stored)

**Decision:** the client sends its IANA timezone on each relevant request. We do
**not** store it on the profile, because users travel and a stored zone goes stale;
the device timezone is always current.

- **Field:** `timeZone` — `Intl.DateTimeFormat().resolvedOptions().timeZone`
  (e.g. `"America/New_York"`). One string, added to the JSON bodies of:
  - `POST /api/session/start`
  - `POST /api/chat/message`
  - `POST /api/session/end`  *(so the summarizer can anchor dates — see §6)*
- **No client timestamp needed.** "Now" is the same instant everywhere; the server
  uses its own NTP-synced clock for the instant and only needs the timezone to render
  it locally. This keeps all elapsed-time math on one consistent clock and avoids
  trusting a possibly-wrong client clock.
- **PWA note:** reading `Intl....timeZone` works identically in a home-screen /
  installed PWA (it runs in the platform web engine), so this is reliable in both
  browser and "add to home screen" modes.

**Fallback:** if `timeZone` is missing or not a valid IANA zone (older client,
malformed value), fall back to rendering in UTC and omit the local-time precision
rather than breaking. Never throw on a bad zone.

---

## 3. Rendering the time context — `{{TIME_CONTEXT}}`

New placeholder in `background.txt`, filled exactly like `{{CONDITION}}` / `{{TONE}}`:
a render helper computes the string, callers pass it into `buildSystemPrompt`.

**Placement in `background.txt`:** a new `# TIME CONTEXT` section placed right after the
`# THIS CONVERSATION` block (before the profile facts). The render helper emits its own
`# TIME CONTEXT` header, so `background.txt` just holds the `{{TIME_CONTEXT}}` line.

**First session (no prior conversation):**
```
# TIME CONTEXT
Current local time: Saturday, June 20, 2026 at 7:42 PM. (Background — don't recite.)
```

**Returning session:**
```
# TIME CONTEXT
Current local time: Saturday, June 20, 2026 at 7:42 PM.
Last conversation: a few days ago. (Background — reference only if it naturally fits; don't open with it or remark on the gap.)
```

**Two precisions, on purpose:**
- **Current local time — precise.** The only part that must be exact: the model needs
  it to resolve "tomorrow / this evening" and to compare against dated memory (§6).
- **Gap since last chat — coarse, non-numeric, guarded.** A labeled datum, not a
  sentence, never a number (§5). The one-clause guard ("reference only if it naturally
  fits; don't open with it or remark on the gap") keeps it from reading as blame or
  surveillance, while staying small.

Format details:
- Local time string: `Intl.DateTimeFormat('en-US', { timeZone, weekday, year, month,
  day, hour, minute })` over the server's current instant — DST-correct.
- The block is **always present** (current time is always knowable); the
  `Last conversation:` line is conditional (see §5).

---

## 4. `buildSystemPrompt` plumbing

- Add a `timeContext: string = ''` parameter to `buildSystemPrompt`, and
  `.replace('{{TIME_CONTEXT}}', timeContext)` — same shape as the `conditionPhrase`
  change.
- Render helper `renderTimeContext(...)` lives in a small new `timeService.ts`. It
  takes the timezone and the last-session anchor and returns the block text.
- **Callers** ([chat.ts](server/routes/chat.ts), [session.ts](server/routes/session.ts)
  `/start`): read `timeZone` from the request, look up the last-session anchor (§5),
  build the context, pass it to `buildSystemPrompt`.

---

## 5. Elapsed-since-last-session

- **Anchor = the most recent `Message` whose `sessionId !==` the current session**
  (i.e. the last thing said before this conversation). Chosen over `Summary.createdAt`
  because a short session may never have been summarized, but its messages still mark
  "when we last talked."
- **Diff on the server clock:** `elapsedMs = serverNow - lastMessage.createdAt`. Both
  ends are server time → no client-skew error.
- **No prior message** (first-ever session, or only the current session exists) ⇒ omit
  the `Last conversation:` line entirely.
- **Coarse, approximate phrase** (a render helper), rendered as a labeled datum
  (`Last conversation: <phrase>.`):
  - `< 1h` → omit the line (just talked / resuming)
  - same local day → "earlier today"
  - previous local day → "yesterday"
  - 2–4 days → "a few days ago"
  - 5–13 days → "about a week ago"
  - 14+ days → "a while ago"
- Stays approximate and tops out at "a while ago" — long absences never get an exact
  count, to avoid a blaming, surveillance-like tone. The model gets a rough sense for
  calibration only; precise reasoning about specific dates runs off the absolute dates
  in memory (§6) plus the current local time, not this gap.

---

## 6. Time-anchored memory at write time (the cross-session core)

This is what lets a *future* session know whether "next Friday" has passed.

**Summarizer ([summarize-prompt.txt](server/prompts/summarize-prompt.txt)):**
- Inject the session's **local date** via a new `{{SESSION_DATE}}` placeholder
  (computed in `/session/end` from `serverNow` + request `timeZone`).
- Add an instruction: *when the caregiver refers to a specific time — "tomorrow,"
  "this evening," "next Friday," "in two weeks," "last Tuesday" — resolve it to a
  concrete absolute date relative to {{SESSION_DATE}} and include that date in the text
  you write* (e.g. "has a neurology appointment on Fri, Jun 27"). Keep the phrasing
  natural; just make the date explicit so it survives into later sessions.
- This affects the free-text fields that carry forward — primarily `whatCameUp`
  (→ threads) and `sessionRecap` — with **no schema change**: threads stay strings,
  they just now contain absolute dates.

**Reconcile ([reconcile-prompt.txt](server/prompts/reconcile-prompt.txt)):**
- Also give reconcile **today's date** (it already runs at `/session/end`; pass the
  same local date).
- Light instruction: dated items carry absolute dates; when a dated event is now in
  the past, update the thread to reflect that it happened (and let it resolve/fade per
  the existing thread rules). This keeps "the appointment she dreaded" from lingering
  as a future worry after the date passes.

**Net effect:** memory accumulates absolute dates; the `{{TIME_CONTEXT}}` block tells
the model today's date; the model compares the two to reason about past vs upcoming.

---

## 7. Data model

- **No required schema change.** Core behavior works from the existing
  `Message.createdAt` (elapsed) + per-request `timeZone` (rendering) + write-time
  date anchoring (free text).
- **Optional enhancement (recommended for analysis/IRB, not blocking):** add
  `timeZone: string` to `Summary` so each session record retains the zone it occurred
  in. Useful for accurately re-rendering a past session's local weekday and for
  studying engagement timing. If added, set it in `/session/end` from the request.

---

## 8. Client changes

- A small helper `getTimeZone()` → `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Include `timeZone` in the three request bodies in
  [Chat.tsx](client/src/pages/Chat.tsx): `startSession` (`/session/start`),
  `sendMessage` (`/chat/message`), and `runSessionEnd` (`/session/end`).
- No UI change.

---

## 9. Edge cases

- **Missing/invalid `timeZone`** → render in UTC, drop local-time precision; never
  throw (§2 fallback).
- **First-ever session** → time block present, `Last conversation:` line omitted (§5).
- **Very recent / resumed** (`< 1h`) → the gap line is omitted so it doesn't read oddly
  on a quick return (§5).
- **Clock skew** → avoided by computing the gap entirely on the server clock; the client
  only supplies a timezone, never an instant (§2).
- **Travel between sessions** → the coarse gap phrase is zone-robust (computed from
  local-day keys), so travel can only shift it across a bucket boundary in rare
  near-midnight cases — never a date stated to the user. Storing `Summary.timeZone` (§7)
  would tighten it if it ever matters.
- **DST** → handled by `Intl` + IANA zone; no manual offset math anywhere.

---

## 10. Not in this spec (parked)

- **Structured date fields on threads/events** (queryable dates in the data model
  rather than dates-in-text). More precise but a much larger change; revisit only if
  text anchoring proves insufficient.
- **Proactive reminders / notifications** ("your appointment is tomorrow"). This spec
  makes the model *aware* of time; it does not add outbound prompts.
- **Non-`en-US` date formatting / localization.**

---

## 11. Testing

- Extend [preview-openers.ts](server/scripts/preview-openers.ts) (or a sibling script)
  to render `{{TIME_CONTEXT}}` for varied timezones, first-vs-returning, and several
  gap lengths, and to dry-run the summarizer's date-anchoring on transcripts that say
  "tomorrow / next Friday."
- Manual: send a message that references a future date, end the session, start a new
  one "after" that date (simulate via the script), and confirm the model treats the
  plan as past.

---

## 12. Open decisions (resolved)

- **Time source:** client-supplied IANA `timeZone` per request; not stored (users
  travel). Server clock supplies the instant.
- **PWA:** confirmed reliable in home-screen/installed mode.
- **Cross-session depth:** resolve relative phrases to **absolute dates at write
  time** (no thread-schema change).
- **Scope:** both in-session and cross-session (the anchoring choice entails both).
- **Elapsed anchor:** last `Message` outside the current session; diffed on the server
  clock.
