import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import type { ChatCompletionMessageParam } from 'openai/resources';
import { buildSystemPrompt } from '../services/promptService';
import {
  renderProfileContext,
  renderToneInstruction,
  renderConditionPhrase,
} from '../services/profileService';
import { renderTimeContext } from '../services/timeService';
import { streamTokens } from '../services/aiService';
import type { CopingEntry } from '../models/Profile';

// Holds ONE profile constant and varies only the menu selection (mode), so any
// difference in the opener is attributable to the mode. Uses the exact path
// POST /api/session/start uses (buildSystemPrompt + opener instruction +
// streamTokens). Read-only: touches no database, just prints.

const promptsDir = path.join(__dirname, '../prompts');
const openerFirst = fs.readFileSync(path.join(promptsDir, 'opener_first.txt'), 'utf-8').trim();
const openerReturning = fs.readFileSync(path.join(promptsDir, 'opener_returning.txt'), 'utf-8').trim();

// Fixed profile across all runs.
const profile = {
  careRecipientCondition: 'ADRD',
  displayName: 'Maria',
  tone: '',
  coping: [{ approach: 'walking', effect: 'helps her clear her head' }] as CopingEntry[],
  caregivingSituation:
    'Caring for their spouse or partner, for 3 years. Their caregiving includes: personal care, healthcare coordination.',
  threads: [] as string[],
};

const PRIOR_SUMMARY =
  'Last time, Maria was worn down after a hard week of appointments and was trying to carve out a little time for herself.';

interface Run {
  label: string;
  mode: string;
  returning: boolean;   // returning => opener_returning + a time gap
  priorSummary?: string;
}

// In the real app, "first session" means the user has NO prior summary at all
// (their genuine first-ever session) — it is independent of mode. Only that first
// session uses opener_first (the "welcome to CareCompanion"); every later session,
// whatever the mode, uses opener_returning (no welcome). So we show one genuine
// first-session-ever run, then each mode as a returning session.
const RUNS: Run[] = [
  { label: 'FIRST SESSION EVER (post-onboarding, free) — welcome SHOULD appear', mode: 'free', returning: false },
  { label: 'VENT (returning) — no welcome',    mode: 'vent',    returning: true },
  { label: 'REFLECT (returning) — no welcome', mode: 'reflect', returning: true },
  { label: 'SOLVE (returning) — no welcome',   mode: 'solve',   returning: true },
  { label: 'FREE (returning) — no welcome',    mode: 'free',    returning: true },
  { label: 'CONTINUE (returning, with recap) — no welcome', mode: 'continue', returning: true, priorSummary: PRIOR_SUMMARY },
];

async function generate(messages: ChatCompletionMessageParam[]): Promise<string> {
  let out = '';
  for await (const token of streamTokens(messages)) out += token;
  return out;
}

async function main() {
  const profileContext = renderProfileContext(profile);
  const toneInstruction = renderToneInstruction(profile.tone);
  const conditionPhrase = renderConditionPhrase(profile.careRecipientCondition);

  for (const r of RUNS) {
    const timeContext = renderTimeContext({
      timeZone: 'America/New_York',
      lastSessionAt: r.returning ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) : null,
    });
    const systemPrompt = buildSystemPrompt(
      r.mode, profileContext, false, r.priorSummary ?? '', toneInstruction, conditionPhrase, timeContext,
    );
    const openerInstruction = r.returning ? openerReturning : openerFirst;
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: `${systemPrompt}\n\n${openerInstruction}` },
    ];

    const greeting = await generate(messages);
    console.log('\n' + '='.repeat(80));
    console.log('MODE: ' + r.label);
    console.log('-'.repeat(80));
    console.log(greeting.trim());
  }
  console.log('\n' + '='.repeat(80));
}

main().catch(e => { console.error(e); process.exit(1); });
