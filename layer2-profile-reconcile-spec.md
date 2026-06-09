# Layer 2 Spec — Baseline + Living Profile + Reconcile

**Scope:** the two profile collections (immutable `baseline` + evolving `profile`)
and the reconcile process that updates the evolving profile from session summaries.
Depends on the Layer 1 amendment (session summary).

**Companion principle:** the caregiver — their own experience, not the person they
care for — is the subject. The profile is *ambient* memory: the companion knows
these things and lets them shape how it shows up, but does not recite them back or
surface them unprompted. Warmth comes from being remembered, not from being told
what the system remembers.

---

## 1. Storage layout — two collections

Split by purpose:

- **`baseline`** — written once when onboarding completes, never updated. The
  immutable intake record (analysis / IRB retention) and the seed source for
  `profile`.
- **`profile`** — rewrite-in-place. The single source the prompt renders from, and
  the only collection reconcile writes.

**Invariant:** `baseline` is never read or written at runtime. At runtime you touch
exactly one collection — `profile` — and it holds exactly the fields that get
rendered. So "what gets injected?" has one answer: whatever is in `profile`.

---

## 2. `baseline` schema (write-once)

Your current onboarding schema, repurposed as the immutable record:

```
userId: ObjectId -> User     // required, unique
displayName: String          // required
supportStyle: String[]       // support-style codes
toneModifier: String         // default ''  (direct | professional | humorous)
recharge: { categories: String[], other: String }   // other default ''
caregiverProfile: {
  relationship: String,              // default ''
  caregivingDurationMonths: Number,  // default 0
  careTypes: String[]                // care-type codes
}
onboardingCompletedAt: Date
createdAt: Date
```

Coded fields stay as codes here (good for analysis). They're mapped to labels once,
at seed time, when deriving `profile` — not at render.

**Write path — onboarding runs exactly once.** There is no post-onboarding edit
path. On completion the route creates `baseline` and seeds `profile`, both once; it
does not re-write either afterward. The current "redo onboarding" affordance (the
upsert behavior in `POST /api/profile` and the `DELETE /api/profile` route, plus the
client redo button) is removed — it existed only as a testing convenience. This is
what makes the write-once invariant real rather than aspirational.

---

## 3. `profile` schema (evolving; the rendered source)

```
userId: ObjectId -> User     // required, unique
displayName: String          // immutable; frozen copy of baseline.displayName
tone: String                 // living
coping: [{ approach: String, effect: String }]   // living
caregivingSituation: String  // living
threads: String[]            // living; ordered, most-recent-first
updatedAt: Date
// warm is a render constant — not stored
```

| Field | Kind | Injected? | Written by reconcile? |
|---|---|---|---|
| `displayName` | fixed (immutable copy) | yes — profile block | no |
| `tone` | living (seeded from `toneModifier`) | yes — via `{{TONE}}` under YOUR MANNER | yes — from `interactionNotes` |
| `coping` | living (seeded from `recharge`) | yes — profile block | yes — from `selfCareCoping` |
| `caregivingSituation` | living (seeded from `caregiverProfile`) | yes — profile block | yes — from `careSituationUpdates` |
| `threads` | living (no seed) | yes — profile block | yes — from `whatCameUp` |
| warm | constant | yes — YOUR MANNER baseline | n/a |

- **`displayName`** is a frozen denormalized copy. Enforce with Mongoose
  `immutable: true`; it can't drift because `baseline.displayName` is itself
  write-once. Reconcile never includes it in its write payload.
- **`supportStyle` and `toneModifier` are NOT copied into `profile`.** `supportStyle`
  is record-only (never injected); `toneModifier` is superseded by the living `tone`.
  Both live only in `baseline`.
- **`tone` renders into the YOUR MANNER section, not the profile facts block** — see
  §8. It is a directive about *how the companion comes across*, alongside the
  always-on "warm" baseline, not a fact recited about the caregiver. Everything else
  (`displayName`, `coping`, `caregivingSituation`, `threads`) renders in the profile
  facts block.

The uniform pattern: **a fixed intake code (record, not injected) seeds a living
free-text field (injected, evolves).** If it's injected, it's living; if it's a
code, it's a record. The only exceptions are `displayName` (injected, fixed — names
don't evolve) and `warm` (injected constant).

---

## 4. Onboarding -> seed mapping

At onboarding completion: write `baseline`, then derive `profile` from it. The
code->label mapping currently in `profileService.ts` (run at render) moves here and
runs once.

| `profile` field | Seeded from | Derivation |
|---|---|---|
| `displayName` | `baseline.displayName` | copy (then frozen) |
| `tone` | `baseline.toneModifier` | label -> short free-text core preference (e.g. "direct" -> "direct and to the point"); empty modifier -> empty `tone` (warm still applies). Stored as the bare preference; the directive framing ("They've asked you to adjust how you come across: …") is added at render, not stored — see §8. |
| `coping` | `baseline.recharge` | category codes -> labels as `{approach, effect: ""}`; append `recharge.other` as an entry |
| `caregivingSituation` | `baseline.caregiverProfile` | one free-text sentence from relationship + duration + careType labels |
| `threads` | — | `[]` |

---

## 5. Summary -> profile routing contract

```
Reconcile consumes (writes the mutable subset of profile):
  whatCameUp           -> threads
  selfCareCoping       -> coping
  careSituationUpdates -> caregivingSituation
  interactionNotes     -> tone

Reconcile does NOT write:    displayName (immutable)
Reconcile does NOT consume:
  caregiverState  -> safety path (separate spec)
  sessionRecap    -> opener only

baseline: never read or written at runtime.
```

Reconcile's read/write payload is exactly `{ tone, coping, caregivingSituation, threads }`.

**When it runs:** in the `POST /session/end` handler, immediately after
`Summary.create` succeeds. The session is over, so nothing the user is actively
waiting on blocks on it, and `profile` is always current before the next session
starts. If summarization is skipped (no `sessionRecap`), reconcile is skipped too —
no summary, nothing to fold in.

**UI coupling:** the end-of-session "tap anywhere to start" affordance appears only
*after* reconcile completes (or fails and falls back to the prior profile), so the
user can't open a new session mid-rewrite and race the profile read.

---

## 6. Reconcile prompt

System prompt for the reconcile call. Input: current `profile` mutable subset +
latest summary. Output: JSON with the four mutable fields.

```
# Reconcile — updating the caregiver profile

You maintain a small, living profile of a family caregiver, giving a companion warm,
continuous memory of them across sessions. The caregiver — their own experience, not
the person they care for — is always the subject.

You're given the current profile fields and the latest session summary. Return the
updated fields as JSON. Change only what the summary gives you reason to change;
leave everything else exactly as it is. If the summary adds nothing to a field,
return it unchanged.

## tone
A short, current description of how she wants the companion to talk to her, beyond
its always-on warmth. Rewrite it from interactionNotes when she expresses a standing
preference ("more direct," "fewer questions," "less humor"). A newer standing
preference supersedes an older one — rewrite to the current effective preference,
don't stack contradictions. Don't mention warmth here; it's always applied separately.

## coping
A list of {approach, effect} — what she does to recharge and how it lands. Add new
approaches from selfCareCoping; if one already listed comes up again, update its
effect to the latest reading. Don't list the same approach twice.

## caregivingSituation
A short free-text picture of the caregiving context that frames her life — who she
cares for, how long, what it involves. Fold careSituationUpdates in by rewriting it
as one current description, not an append log. Most sessions add nothing; that's fine.

## threads
Threads are what's currently going on in her life that carries across sessions — the
handful of things on her mind: something weighing on her, something she's looking
forward to, something new she's trying. Kept most-recent-first, and small.

Update them the way you'd update your sense of what's going on with a friend after
talking with her: refresh what's changed, add what's genuinely new, fold related
things together instead of keeping duplicates, and when something resolves, let the
summary land on how it turned out — then let it fade. Then read back over the list
and merge any two entries that have drifted into describing the same thing.

Return the list most-recent-first: anything you touched or added this session moves
to the top; untouched threads keep their order and drift down. Keep it to about six;
if it runs longer, the one at the very bottom drops off.

Source: whatCameUp.

Example —
  Before (most recent first):
    1. Wants regular hours to herself; tried Saturday-morning coverage, didn't hold.
    2. Recently started swimming and has been enjoying it.
    3. On edge about the upcoming neurology appointment.
  whatCameUp:
    - The neurology appointment went okay; she's relieved.
    - Her sister is coming to visit next month; she's looking forward to it.
  After:
    1. Her sister is visiting next month; she's looking forward to it.
    2. The neurology appointment she'd dreaded went okay; she's relieved.
    3. Wants regular hours to herself; tried Saturday-morning coverage, didn't hold.
    4. Recently started swimming and has been enjoying it.
  (The appointment isn't deleted — it's updated to how it resolved and slides down;
  it'll fade off later if it doesn't come back up. The new items lead; untouched ones
  drift beneath them.)

Return only JSON with the fields: tone, coping, caregivingSituation, threads.
No commentary.
```

**Note on `tone` output:** reconcile returns the bare standing preference (e.g.
"direct and to the point," "fewer questions"), not the framed directive sentence.
The render layer wraps it under YOUR MANNER (§8). This keeps the framing stable and
consistent across sessions rather than at the mercy of the model each run.

**Graduation note:** an episodic thread can become a durable fact through the durable
field's own channel — swimming starts as a thread, and once it sticks, "swimming
recharges her" lands in `coping` via `selfCareCoping`. Reconcile doesn't move it by
hand; both fields read the same summary, and the thread is free to fade.

---

## 7. Structured output & validation

Tiered (degrade gracefully):
1. **Preferred:** `response_format: { type: "json_schema" }` with the four-field
   schema. *Verify UMGPT support with Mark.*
2. **Fallback:** `response_format: { type: "json_object" }`, schema described in prompt.
3. **Last resort:** prompt-only, defensive parse.

Validate code-side in all tiers before saving:
- Shape: `threads` is a string array; each `coping` entry has `approach` + `effect`;
  `tone` and `caregivingSituation` are strings.
- Never accept writes to anything outside `{tone, coping, caregivingSituation, threads}`
  — `displayName` and all `baseline` fields are out of scope.
- On validation failure, keep the prior profile rather than persist a malformed update.
- `displayName` is additionally protected by Mongoose `immutable: true` as a backstop.

---

## 8. Rendering into the prompt

Render reads `profile` only. The profile is background the companion carries, not a
script. It renders into **two** spots in `background.txt`, by purpose:

### 8a. `tone` -> `{{TONE}}` under YOUR MANNER

`tone` is a directive about how the companion comes across, so it layers onto the
always-on "warm" baseline inside the YOUR MANNER section — it is **not** a fact in
the profile block. The render layer wraps the stored bare preference with the
existing directive framing:

```
{{TONE}} := (tone empty) -> ''
            (tone set)   -> ' They've asked you to adjust how you come across: {tone}.'
```

- `warm` is always present in YOUR MANNER (locked baseline); `tone` layers on top.
- If `tone` is empty, nothing is appended — warmth still applies.
- This preserves the current `{{TONE}}` placeholder mechanism; only the *source* of
  the preference changes (living `profile.tone` instead of a fixed `toneModifier`
  lookup table).

### 8b. profile facts -> `{{PROFILE_CONTEXT}}`

Everything else renders as the background facts block (omit any empty field):

```
Her name: {displayName}.
Her situation: {caregivingSituation}.
What helps her recharge: {coping as "approach (effect)"}.
What's been going on for her: {threads, most-recent-first}.

Carry this as background — let it shape your warmth and what you understand about
her. Don't list it back to her or bring items up unprompted; let her lead.
```

Notes:
- `tone` does **not** appear here — it lives in YOUR MANNER (§8a).
- `supportStyle` and `toneModifier` are never rendered (they live only in `baseline`).
- `threads` may render in two tiers for explicit foreground/background:
  > On her mind lately: {top one or two}.
  > Still around, quieter: {the rest} — there if she raises them, not for you to bring up.

---

## 9. Open items

- **Safety path** for `caregiverState` (in-session live guardrails + post-session
  escalation). Out of scope for the memory layer; decide with Noelle and Pedja, and
  check IRB safety-protocol implications (how a risk session reopens; researcher
  notification).
- **Thread cap (~6)** — tune once real sessions show how many concerns surface.
- **Recency** — positional (array order, reconcile-maintained). If you want
  deterministic time-decay, add a `lastTouched` marker per thread; not needed for MVP.
- **Read-path** — `buildSystemPrompt` assembles `{{PROFILE_CONTEXT}}` and `{{TONE}}`
  from `profile`; wiring deferred until the schema is locked.
- **Migration** — current collection becomes `baseline`; create `profile` by seeding
  from it. Trivial with test data; an infra item (Mark) if real users exist.
- **Remove redo-onboarding** — make `POST /api/profile` create-once (reject if a
  `baseline` already exists), drop `DELETE /api/profile`, and remove the client redo
  button. Cleanup that lands with this layer; see §2 write path.
