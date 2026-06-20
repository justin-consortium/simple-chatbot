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
import { renderTimeContext, localDateLabel } from '../services/timeService';
import { callOnce, streamTokens } from '../services/aiService';

// End-to-end cross-session behavior test with controlled dates (no DB, no waiting).
// Mirrors what /session/end (summarize) and reconcileService (reconcile) do, then
// renders a later session so you can see whether a dated plan is treated as PAST.
//
// Flow: Session 1 transcript (mentions a near-future plan) on D1
//   → summarize with {{SESSION_DATE}} = D1   → expect an ABSOLUTE date in whatCameUp
//   → reconcile with {{TODAY}} = D1          → expect the dated item folded into threads
//   → Session 2 on D2 (after the plan)       → expect the model to treat it as past.
//
// Run with:  npx tsx server/scripts/preview-cross-session.ts

const TZ = 'America/New_York';
const D1 = new Date('2026-06-22T18:00:00-04:00'); // Mon Jun 22 — the session-1 day
const D2 = new Date('2026-06-29T18:00:00-04:00'); // Mon Jun 29 — a week later

const promptsDir = path.join(__dirname, '../prompts');
const load = (f: string) => fs.readFileSync(path.join(promptsDir, f), 'utf-8').trim();

// A TBI caregiver, mid-conversation, mentioning a plan this week.
const conditionCode = 'TBI';
const transcript = [
  'Caregiver: Honestly this week has been a lot. I have my husband\'s neurology appointment this Friday and I\'m dreading it.',
  'Companion: That sounds heavy to carry. What is it about Friday that\'s weighing on you?',
  'Caregiver: Just the not-knowing. Last time the news wasn\'t good. I\'m trying to take a walk each morning to steady myself.',
  'Companion: Those morning walks sound like they help you find some ground. I\'m glad you have that.',
  'Caregiver: They do. I\'ll try to keep it up through Friday. Oh, and a package I\'ve been waiting on is supposed to arrive this afternoon.',
  'Companion: A little something to look forward to today, then.',
].join('\n\n');

// Session-1 living profile (as if freshly seeded). Mirrors the reconcile read shape.
const seedProfile = {
  displayName: 'Maria',
  tone: '',
  coping: [{ approach: 'walking', effect: '' }],
  caregivingSituation: 'Caring for their spouse or partner, for 3 years. Their caregiving includes: personal care, healthcare coordination.',
  threads: [] as string[],
};

async function generate(messages: ChatCompletionMessageParam[]): Promise<string> {
  let out = '';
  for await (const token of streamTokens(messages)) out += token;
  return out;
}

async function main() {
  const conditionPhrase = renderConditionPhrase(conditionCode);
  const sessionDate = localDateLabel(TZ, D1);

  console.log('='.repeat(80));
  console.log(`SESSION 1 — ${sessionDate}`);
  console.log('='.repeat(80));
  console.log(transcript);

  // 1) Summarize (mirrors /session/end) ------------------------------------
  const summarizePrompt = load('summarize-prompt.txt')
    .replace('{{CONDITION}}', conditionPhrase)
    .replace('{{SESSION_DATE}}', sessionDate);
  const summaryRaw = await callOnce([
    { role: 'system', content: summarizePrompt },
    { role: 'user', content: transcript },
  ]);
  const summary = JSON.parse(summaryRaw) as Record<string, unknown>;
  console.log('\n--- SUMMARY (look for an absolute date in whatCameUp) ---');
  console.log('whatCameUp:', JSON.stringify(summary.whatCameUp, null, 2));
  console.log('sessionRecap:', summary.sessionRecap);

  // 2) Reconcile (mirrors reconcileService) --------------------------------
  const reconcilePrompt = load('reconcile-prompt.txt').replace('{{TODAY}}', localDateLabel(TZ, D1));
  const reconcileInput = {
    currentProfile: {
      tone: seedProfile.tone,
      coping: seedProfile.coping,
      caregivingSituation: seedProfile.caregivingSituation,
      threads: seedProfile.threads,
    },
    latestSummary: {
      whatCameUp: summary.whatCameUp ?? [],
      selfCareCoping: summary.selfCareCoping ?? [],
      careSituationUpdates: summary.careSituationUpdates ?? '',
      interactionNotes: summary.interactionNotes ?? '',
    },
  };
  const reconciledRaw = await callOnce([
    { role: 'system', content: reconcilePrompt },
    { role: 'user', content: JSON.stringify(reconcileInput, null, 2) },
  ]);
  const reconciled = JSON.parse(reconciledRaw) as typeof seedProfile;
  console.log('\n--- RECONCILED THREADS (the dated plan, now in memory) ---');
  console.log(JSON.stringify(reconciled.threads, null, 2));

  // 3) Session 2, a week later — does the model treat Friday as past? ------
  const updatedProfile = { ...seedProfile, ...reconciled };
  const timeContext = renderTimeContext({ now: D2, timeZone: TZ, lastSessionAt: D1 });
  const systemPrompt = buildSystemPrompt(
    'free',
    renderProfileContext(updatedProfile),
    false,
    '',
    renderToneInstruction(updatedProfile.tone),
    conditionPhrase,
    timeContext,
  );

  console.log('\n' + '='.repeat(80));
  console.log(`SESSION 2 — ${localDateLabel(TZ, D2)}`);
  console.log('='.repeat(80));
  console.log('--- TIME CONTEXT injected ---');
  console.log(timeContext);

  const userTurn = "Remind me — wasn't there something on my calendar I was nervous about?";
  console.log('\nCaregiver:', userTurn);
  const reply = await generate([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userTurn },
  ]);
  console.log('\nCompanion:', reply.trim());
  console.log('\n(Check: does it treat the appointment as already past — "how did Friday go?" — rather than still upcoming?)');
  console.log('='.repeat(80));
}

main().catch(e => { console.error(e); process.exit(1); });
