# Spec: Pre-Created Accounts & Login Hardening

## 1. Motivation

Move from self-registration to **pre-created accounts**. Today participants
create their own passwords, which (a) the research team is not permitted to know
and (b) are stored only as bcrypt hashes. Under the new model the **research team
generates** random access codes and distributes them; MongoDB still stores only
the bcrypt hash, and the plaintext codes live in a **master list** the lab holds.
Self-registration is removed. Existing dev/test accounts are **kept as-is** (no
wipe, no migration).

## 2. Account roster

| Group | Username | Count | `role` |
|---|---|---|---|
| Participants (CareCompanionTBI) | `CCT01`–`CCT50` | 50 | `participant` |
| Researcher test | `CODA01`–`CODA20` | 20 | `researcher` |
| Public / passerby test | `GUEST01`–`GUEST20` | 20 | `guest` |

**Total: 90 new accounts**, seeded alongside the existing dev/test accounts,
which remain untouched.

## 3. Access code

- **8 characters, uppercase letters, charset A–Z excluding O** (25 letters) →
  ~37 bits of entropy.
- Generated with a **cryptographically secure RNG** (`crypto.randomInt`),
  **unique** across all seeded accounts.
- Stored only as `bcrypt(accessCode)` — see §4.

## 4. Data model (`server/models/User.ts`)

- Add `role: 'participant' | 'researcher' | 'guest'` as an **optional** field
  (NOT `required`). Existing dev/test docs have no `role` and remain valid;
  only seeded accounts set it. Enables clean analysis queries
  (`{ role: 'participant' }`) without relying on username-prefix regex.
- Keep `username` and `passwordHash`. `passwordHash` now holds
  `bcrypt(accessCode)` for seeded accounts; the field name stays `passwordHash`
  to avoid churn across the auth code.
- **No** `failedAttempts` / `lockUntil` fields — per-account lockout is
  intentionally omitted (see §9).

## 5. Hashing

**Unchanged.** Continue using **bcrypt, cost 12** — the same function and cost
already used for passwords. Only the *content* being hashed changes (a generated
access code instead of a user-chosen password) and *where the plaintext comes
from* (the seed script instead of a registration form). Login still verifies via
`bcrypt.compare`.

## 6. Case sensitivity

| Field | Rule | Rationale |
|---|---|---|
| **Username** | **Case-insensitive** lookup + trim whitespace | Safe for everyone: `CCT07`/`cct07` both match, and existing mixed-case dev usernames (e.g. `roxanne`/`Roxanne`) keep working. |
| **Access code** | **Case-insensitive**, via a two-step compare (see below) + trim whitespace | Best UX for non-technical participants: codes are printed uppercase (easy to read) but can be typed in any case (easy on a phone keyboard, where uppercase means a shift tap per letter), so case can never cause a false failure. |

**Two-step compare** (gives participants case-insensitivity without breaking
existing dev/test accounts, and without branching on account type): on login,
run `bcrypt.compare(input, hash)` **as typed** first; if that fails, run
`bcrypt.compare(input.toUpperCase(), hash)`. Either match = success.

- Seeded codes are hashed in uppercase, so a participant typing lowercase
  matches on the second (uppercased) compare.
- Existing dev accounts have mixed-case passwords hashed as-is, so they match on
  the first (exact) compare; the uppercased attempt cannot false-match them.
- Cost: one extra bcrypt (~250 ms) only when the first compare fails — bounded
  by rate limiting (§8), acceptable for this traffic.

The login field must **not** auto-uppercase input, because the exact-compare
step relies on receiving the dev accounts' mixed-case passwords unchanged.

## 7. Copy

**A. Rate-limit (429) response** — the JSON body carries `retryAfterSeconds`
(computed from the window's reset time) so the login page renders a **live
countdown** to when the user can retry:

> Too many attempts. Please try again in M:SS. If you've forgotten your username
> or access code, contact the study team at 734-764-0644 or
> PMR-CODALab@med.umich.edu.

**B. Permanent contact block on the login page:**

> Access is by invitation only. If you need an account, contact the **Center for
> Clinical Outcomes Development & Application** at the University of Michigan:
> 📞 734-764-0644  ✉️ PMR-CODALab@med.umich.edu

**C. Access-code field hint** (small helper text under the input):

> Enter the access code provided to you.

## 8. Backend auth (`server/routes/auth.ts`, `server/server.ts`)

- **Remove** `POST /api/auth/register` entirely.
- Harden `POST /api/auth/login`:
  - **Rate limiting** via `express-rate-limit`, keyed on **IP + username**: **10
    failed attempts per account per IP per 15 min**, responds **429** with the
    message in §7A. A **successful login resets that key's counter**, so a user's
    earlier fumbles clear the instant they get in; otherwise the counter expires
    after the 15-min window. Keying on IP alone would let a burst of failures
    against one account lock out every other account behind a shared IP (clinic /
    household / campus network, or one machine testing many accounts);
    per-(IP+username) scopes the cap to the account actually being hammered. The
    username is normalized (trim + lowercase) so the key can't be bypassed by
    varying case.
  - **Generic error** for all failures: `"Invalid username or access code"`.
  - **Dummy bcrypt compare** when the username doesn't exist, so response timing
    and CPU cost don't distinguish real vs. unknown usernames.
  - **Case-insensitive username** lookup + trim; **case-insensitive access
    code** via the two-step compare in §6 (trim whitespace; no auto-uppercase of
    input).
- `server.ts`: set **`app.set('trust proxy', 1)`** (or the correct hop count) so
  per-IP limiting sees the real client IP behind nginx/GCP; confirm the proxy
  layer on deploy, or all clients share one rate-limit bucket.
- `POST /api/auth/logout` and `GET /api/auth/me` unchanged.

## 9. Security rationale (why Layer 1 only)

- Access codes carry ~37 bits of entropy and every guess costs a bcrypt-cost-12
  verification (~250 ms server CPU), so **online brute force of any single
  account is already infeasible**.
- **Layer 1 (IP rate limiting)** stops single-source scripts and protects server
  CPU — the main realistic threat.
- **Layer 2 (per-account lockout) is deliberately excluded**: usernames are
  predictable (`CCT01`…), so it would let an attacker deliberately lock a real
  participant out, and it adds almost no security given how strong the codes
  already are. Note the IP+username rate-limit key (§8) is **not** Layer 2: it is
  scoped per-IP, so it cannot lock an account out globally across the internet —
  it only throttles one IP's attempts against one account.

## 10. Seed script (`server/scripts/seed-accounts.ts`)

- Generates all 90 accounts: inserts `username + passwordHash + role` into
  MongoDB. **Does not** touch existing dev/test accounts.
- **Idempotent** — skips usernames that already exist, so re-running won't
  duplicate.
- Writes the plaintext master list **`credentials.csv`** (`username, accessCode,
  role`) — see §10.1 for how it is kept out of git.
- Because codes are hashed, **"resend a forgotten code" = look it up in the
  master list**. If the master list is lost, that account's code cannot be
  recovered and must be regenerated (re-seed).

### 10.1 Keeping `credentials.csv` out of version control (it is plaintext)

`credentials.csv` holds **plaintext access codes** and must **never** be
committed — to a public *or* private repo. Layered safeguards:

1. **Written outside the git working tree by default.** The output path is a CLI
   arg / env var (`CREDENTIALS_OUT`), defaulting to a location **outside the
   repo** (e.g. the user's home dir). A file that never lives inside the repo
   cannot be tracked by git regardless of `.gitignore`.
2. **`.gitignore` belt-and-suspenders.** Add `credentials*.csv` and `secrets/`
   to the root `.gitignore` *before* the script can run, so even if the output
   is later pointed into the repo it stays ignored. (Only `git add -f` could
   override, which won't happen by accident.)
3. **Loud warning on write.** The script prints the absolute output path plus a
   reminder: contains plaintext codes, do not commit, store in lab-controlled
   secure storage, delete the local copy after distribution.
4. **Verify.** After running, `git status` must not list the CSV.

Custody: the CSV lives only in the lab's secure storage (e.g. protected Google
Drive / U-M OneDrive) and transiently on the developer's machine; the server and
the repo keep only bcrypt hashes.

## 11. Frontend (`client/src`)

- **Delete** `pages/Register.tsx`, the `/register` route in `App.tsx`, and
  `register()` from `context/AuthContext.tsx`.
- **`pages/Login.tsx`**:
  - Relabel the `Password` field → **Access Code**; remove the "Must be at least
    8 characters" hint; add the hint in §7C.
  - Remove the `Don't have an account? Register` link; replace with contact
    block §7B.
  - Surface the server's 429 message (§7A) on rate-limit.
  - Do **not** auto-uppercase the access-code input (§6).
- **First-login routing**: after a successful login, route to `/onboarding` when
  the user has **no `Profile`** yet, otherwise to `/`. (Previously only the
  register flow sent users to onboarding; now every account logs in, so
  onboarding is gated on Profile existence. Verify the existing onboarding guard
  covers this during implementation.)

## 12. Operational notes

- Master list (`credentials.csv`) custody belongs to the lab; the server retains
  only hashes.
- On deploy, verify `trust proxy` matches the actual proxy setup.
- New dependency: `express-rate-limit`.

## 13. Out of scope

- Password/code reset self-service (handled manually by the lab via the master
  list).
- Migrating or changing existing dev/test account credentials.
