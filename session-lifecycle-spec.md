# Session Lifecycle Spec — Inactivity Timeout & Cold-Start Welcome

## Goals

1. **Inactivity auto-end.** When a conversation is active and the app sits inactive
   for longer than a configurable limit (default **1 hour**) — whether idle in the
   foreground, backgrounded, or brought back later — it should wind down the same
   way pressing **End conversation** does (resting screen → tap → mode menu).
2. **Fix the confusing cold-start.** Today, force-quitting the app (or the installed
   "open as web app" PWA) and reopening drops the user silently into a *new* active
   conversation — no resting screen, no menu, and a stray "New conversation" divider
   appears on their first message. Reopening should instead show a warm welcome
   screen leading into the mode menu.

Both problems share one root cause and are fixed together.

## Root cause

All session-continuity state currently lives in **`sessionStorage`**, which is
scoped to the browser tab/window and is **cleared when the tab or app closes**
(including a force-quit of an installed PWA). It also has no notion of elapsed time.

Consequences:

- After a force-quit, `sessionId`, `sessionMode`, and the `pendingMenu` flag are all
  gone. On reopen a brand-new `sessionId` is generated, no menu is restored, and the
  user lands in a silent active session. Their first message — tagged with the new
  `sessionId` — triggers the "New conversation" divider in
  [`displayItems`](client/src/pages/Chat.tsx), because the divider is inserted before
  the first message whose `sessionId` matches the current session.
- There is no timer or timestamp anywhere, so nothing ever ends a stale session.

## Design overview

Move durable session state to **`localStorage`** (survives a force-quit), add a
**last-activity timestamp**, and use a small **`sessionStorage` flag** to tell a
same-process refresh apart from a true cold start.

### Storage keys

| Key | Store | Meaning |
| --- | --- | --- |
| `sessionId`, `sessionMode`, `continuedSummaryId` | `localStorage` | existing keys, migrated from `sessionStorage` |
| `pendingMenu` | `localStorage` | "between sessions" — restore the mode menu (migrated) |
| `sessionActive` | `localStorage` | **new** — an active conversation is in progress |
| `lastActiveAt` | `localStorage` | **new** — timestamp (ms) of the last user activity |
| `tabAlive` | `sessionStorage` | **new** — present means "same tab/process"; absent on load means cold start |

Why `tabAlive` works: `sessionStorage` survives a refresh (`F5`) but is cleared on
tab close / app force-quit and is empty for a freshly opened tab. So at load time,
`tabAlive` **absent ⇒ cold start**, `tabAlive` **present ⇒ same-process refresh**.

### Activity tracking

`markActive()` writes `lastActiveAt = Date.now()`. It is called on meaningful user
interactions only — sending a message and starting a session. Simply returning the
tab to the foreground is **not** counted as activity (that moment is when we *check*
for inactivity). `isIdle()` returns true when `now - lastActiveAt > INACTIVITY_LIMIT_MS`,
and false when no activity has ever been recorded (so a brand-new visitor is never
treated as timed out).

`INACTIVITY_LIMIT_MS` is a single configurable constant at the top of
[`Chat.tsx`](client/src/pages/Chat.tsx), default `60 * 60 * 1000` (1 hour).

## Behavior

### Three "leave and come back" scenarios

| Scenario | How it's detected | Result |
| --- | --- | --- |
| **Cold start** — force-quit reopen / fresh tab | `tabAlive` absent at load | **Welcome screen** (waving avatar, "Welcome back" / "Tap anywhere to start") → tap → mode menu |
| **App stayed alive but idle ≥ limit** — idle in foreground, or backgrounded and brought back | `setInterval` + `visibilitychange`, then `isIdle()` | **Resting screen** (resting avatar, "Tap anywhere to continue") → tap → mode menu |
| **Same-process refresh** — `F5`, tab never closed | `tabAlive` present and not idle | **Silently resume** the same conversation (same `sessionId`, so the divider stays correct) |

Key points the design deliberately makes:

- **A cold start always shows the welcome screen** (it does not silently resume,
  regardless of how much time passed). This is what makes reopening predictable.
- **The 1-hour inactivity limit applies only while the app process is alive.** A
  cold start ignores it.
- **A plain refresh resumes in place** — refreshing is not "coming back," so it
  neither winds down nor greets.

### Two overlay variants

Both are full-screen overlays whose tap handler is `handleWake` (which awaits any
in-flight session-end summarization, then opens the mode menu).

- **Resting screen** (existing): `resting` avatar, copy *"I'm here whenever you need
  me" / "Tap anywhere to continue"*. Shown on explicit **End conversation** and on a
  ≥ limit inactivity timeout while the app is alive.
- **Welcome screen** (new): `waving` avatar, copy *"Welcome back" / "Tap anywhere to
  start"*. Shown on a cold start for a returning user. Implemented as a new
  `SessionState` value `'welcome'`.

### Cold-start "catch-up" summarization

When the app is force-quit mid-conversation, that session never ran `/session/end`,
so it was never summarized. On a cold start, if an active session is detected
(`sessionActive` present), fire `/session/end` for that old `sessionId` to summarize
it before showing the menu. This makes the menu's **"Continue our last conversation"**
option meaningful. The welcome screen covers the wait: its tap is disabled (showing a
"preparing" label) until the summarization promise resolves — mirroring the existing
resting-screen behavior.

### Logout summarization

Signing out is a fourth session-exit path the original design overlooked. Unlike a
tab close, `logout()` clears **both** the auth cookie and the durable session state
(`clearSessionState`), so the cold-start catch-up can no longer recover the session —
it must be summarized inline instead. `handleLogout` fires `/session/end` for the
active session **before** calling `logout()` (the endpoint is auth-protected, so it
must run while the cookie is still valid), showing a brief "Saving your conversation…"
overlay meanwhile, then logs out. Best-effort and capped by `LOGOUT_SUMMARIZE_CAP_MS`
so a slow or failed summarize never traps the user; the request is already sent, so
the server still completes the summary in the background.

### Brand-new user (unchanged)

A first-time visitor (no history, no summary, no active session) does **not** see the
welcome screen. They go straight into their first conversation via
`startSession('free', …)`, which streams the agent's first-time opener:
[`opener_first.txt`](server/prompts/opener_first.txt) drives the agent to introduce
itself by name, set a caregiver-centered frame from the profile context, and end with
an open question — i.e., the agent speaks first. The server decides this from
`isFirstSession = !latestSummary` in [`session.ts`](server/routes/session.ts), based
on the caregiving background prompt; the client change preserves this branch exactly.

## Init decision logic (on mount)

```
coldStart = !sessionStorage.tabAlive
sessionStorage.tabAlive = '1'

load profile, history, latest-summary

hasActive   = localStorage.sessionActive present
pendingMenu = localStorage.pendingMenu present
returning   = hasActive || pendingMenu || history.length > 0 || latestSummary != null

if coldStart:
    if not returning:
        startSession('free')                 # brand-new user → agent opener
    else:
        if hasActive: runSessionEnd(oldSessionId)   # catch-up summarize; tap gated on it
        else:         enable tap immediately
        show welcome screen
else:  # same-process refresh
    if pendingMenu:   show mode menu
    elif hasActive:   if isIdle() → end (resting screen); else resume in place
    elif not returning: startSession('free')
    else:             show mode menu
```

## Runtime inactivity watcher

A `useEffect` active only while `sessionState === 'active'`:

- `setInterval(check, 60s)` covers an app left open but idle.
- A `visibilitychange` listener re-checks when the page becomes visible again,
  because background timers are throttled/frozen and cannot be trusted to fire on
  time.
- `check()` calls the end-conversation flow when `isIdle()` is true.

## Scope

- All changes are in the client, in
  [`client/src/pages/Chat.tsx`](client/src/pages/Chat.tsx).
- No server changes: the backend already treats sessions statelessly per request,
  and the existing `/session/end` and `/session/start` endpoints are reused as-is.

## Known minor edge (out of scope)

If the user force-quits while only the first-time opener exists (no reply sent yet),
that session has a single message. `/session/end` requires ≥ 2 messages to summarize
([`session.ts`](server/routes/session.ts)), so no summary is produced and the next
load still treats them as a brand-new user (greeted with the first-time opener
again). Low probability, low impact, pre-existing — not addressed here.

## Open decisions (resolved)

- **Refresh behavior:** silently resume the conversation (not welcome → menu).
- **Inactivity limit:** a single configurable constant, default 1 hour.
- **Welcome copy:** "Welcome back" / "Tap anywhere to start".
- **Multi-tab:** moving state to `localStorage` means multiple tabs of the same origin
  share one session state. Accepted as reasonable for a single-companion app.
