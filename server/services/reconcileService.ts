import fs from 'fs';
import path from 'path';
import type { ChatCompletionMessageParam } from 'openai/resources';
import Profile from '../models/Profile';
import type { CopingEntry } from '../models/Profile';
import { callOnce } from './aiService';

const reconcilePrompt = fs
  .readFileSync(path.join(__dirname, '../prompts/reconcile-prompt.txt'), 'utf-8')
  .trim();

// The subset of the session summary reconcile consumes. caregiverState (safety
// path) and sessionRecap (opener only) are intentionally excluded.
export interface ReconcileSummaryInput {
  whatCameUp: string[];
  selfCareCoping: CopingEntry[];
  careSituationUpdates: string;
  interactionNotes: string;
}

// The mutable subset reconcile reads and writes. displayName is immutable and
// out of scope.
interface MutableProfile {
  tone: string;
  coping: CopingEntry[];
  caregivingSituation: string;
  threads: string[];
}

// Coerces the model's coping output into clean {approach, effect} entries,
// dropping any extra keys (e.g. an echoed _id) and defaulting a missing effect.
// Returns null only if the value isn't an array of approach-bearing objects.
function normalizeCoping(value: unknown): CopingEntry[] | null {
  if (!Array.isArray(value)) return null;
  const out: CopingEntry[] = [];
  for (const e of value) {
    if (e === null || typeof e !== 'object') return null;
    const entry = e as Record<string, unknown>;
    if (typeof entry.approach !== 'string') return null;
    out.push({
      approach: entry.approach,
      effect: typeof entry.effect === 'string' ? entry.effect : '',
    });
  }
  return out;
}

// Coerces the model's threads output into plain strings. Threads should be a
// string array, but the model occasionally echoes the {approach, effect} object
// shape from coping; pull a sensible string out of such objects rather than
// discarding the whole update.
function normalizeThreads(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const t of value) {
    if (typeof t === 'string') {
      if (t.trim()) out.push(t);
    } else if (t !== null && typeof t === 'object') {
      const o = t as Record<string, unknown>;
      const s = [o.thread, o.text, o.description, o.approach].find(v => typeof v === 'string');
      if (typeof s !== 'string') return null;
      if (s.trim()) out.push(s);
    } else {
      return null;
    }
  }
  return out;
}

// Validates/normalizes the model output against the mutable-subset shape. Returns
// the cleaned payload, or null if a field is structurally wrong (caller keeps the
// prior profile).
function validate(parsed: Record<string, unknown>): MutableProfile | null {
  if (typeof parsed.tone !== 'string') return null;
  if (typeof parsed.caregivingSituation !== 'string') return null;
  const coping = normalizeCoping(parsed.coping);
  if (!coping) return null;
  const threads = normalizeThreads(parsed.threads);
  if (!threads) return null;
  return {
    tone: parsed.tone,
    coping,
    caregivingSituation: parsed.caregivingSituation,
    threads,
  };
}

// Folds the latest session summary into the caregiver's living Profile, rewriting
// in place. Reads/writes exactly { tone, coping, caregivingSituation, threads };
// displayName and all Baseline fields are out of scope.
//
// Best-effort: on any failure (no profile, model error, malformed output) the
// prior profile is left untouched and the caller proceeds. Intended to run at
// session end, after the summary is created and before the response is sent.
export async function reconcileProfile(
  userId: string,
  summary: ReconcileSummaryInput
): Promise<void> {
  const profile = await Profile.findOne({ userId });
  if (!profile) return; // no seeded profile — nothing to reconcile into

  // Send plain {approach, effect} shapes only — never the Mongoose subdocument
  // _id fields. Leaking _id into the prompt is noise and, worse, leads the model
  // to echo the object shape into threads (which must be plain strings).
  const cleanCoping = (entries: CopingEntry[]) =>
    entries.map(({ approach, effect }) => ({ approach, effect }));

  const input = {
    currentProfile: {
      tone: profile.tone,
      coping: cleanCoping(profile.coping),
      caregivingSituation: profile.caregivingSituation,
      threads: profile.threads,
    },
    latestSummary: {
      whatCameUp: summary.whatCameUp,
      selfCareCoping: cleanCoping(summary.selfCareCoping),
      careSituationUpdates: summary.careSituationUpdates,
      interactionNotes: summary.interactionNotes,
    },
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: reconcilePrompt },
    { role: 'user', content: JSON.stringify(input, null, 2) },
  ];

  let parsed: Record<string, unknown>;
  try {
    const raw = await callOnce(messages);
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error('[reconcile] model call/parse failed, keeping prior profile:', err);
    return;
  }

  const next = validate(parsed);
  if (!next) {
    console.error('[reconcile] output failed validation, keeping prior profile');
    return;
  }

  profile.tone = next.tone;
  profile.coping = next.coping;
  profile.caregivingSituation = next.caregivingSituation;
  profile.threads = next.threads;
  await profile.save();
}
