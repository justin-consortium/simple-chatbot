import 'dotenv/config';
import type { ChatCompletionMessageParam } from 'openai/resources';
import { buildSystemPrompt } from '../services/promptService';
import {
  renderProfileContext,
  renderToneInstruction,
  renderConditionPhrase,
} from '../services/profileService';
import { streamTokens, callOnce } from '../services/aiService';

// Behavioral harness for the "craft always-on + entry emphasis" change, run
// against the REAL production prompt (buildSystemPrompt + the actual prompt files).
// An observe-only probe classifies each companion turn AFTER it is generated; it
// never steers the reply. Model output is non-deterministic, so treat the PASS/FAIL
// as a strong signal and skim the transcript for the final call.
//
//   Run: npx tsx server/scripts/test-mode-behavior.ts
//
// Covers:
//   #1 DRIFT          — vent → problem-solving: does the solve playbook now show up?
//   #2 OVER-EAGERNESS — pure vent w/ solution-bait: does it WRONGLY jump to solving?
//   #3 ENTRY FIDELITY — turn-1 per mode honors the menu selection

const profile = {
  displayName: 'Maria',
  tone: '',
  coping: [{ approach: 'a short walk', effect: '' }],
  caregivingSituation: 'Caring for her mother, who has dementia, for 2 years.',
  threads: [] as string[],
};
const conditionPhrase = renderConditionPhrase('ADRD');
const profileContext = renderProfileContext(profile);
const toneInstruction = renderToneInstruction(profile.tone);

function systemFor(mode: string): string {
  return buildSystemPrompt(mode, profileContext, false, '', toneInstruction, conditionPhrase, '');
}

const PROBE_SYSTEM = `You are a silent observer evaluating ONE turn of a conversation between a family caregiver and a companion chatbot. You see the conversation so far and the companion's latest reply. Report what the caregiver seemed to need on THIS turn and what the companion actually did. Classify only — do not rewrite or grade tone.

Return JSON exactly in this shape:
{
  "sensed_need": "be_heard" | "make_sense" | "solve" | "just_company" | "unclear",
  "confidence": "low" | "med" | "high",
  "companion_offered": "presence" | "listening" | "reflecting" | "problem_solving" | "mixed",
  "note": "one short clause"
}`;

async function generate(messages: ChatCompletionMessageParam[]): Promise<string> {
  let out = '';
  for await (const token of streamTokens(messages)) out += token;
  return out.trim();
}

async function probe(history: ChatCompletionMessageParam[], reply: string): Promise<any> {
  const transcript = history
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'CAREGIVER' : 'COMPANION'}: ${m.content}`)
    .join('\n');
  const raw = await callOnce([
    { role: 'system', content: PROBE_SYSTEM },
    { role: 'user', content: `${transcript}\nCOMPANION (latest): ${reply}` },
  ]);
  try { return JSON.parse(raw); } catch { return { note: 'parse-failed', companion_offered: '?', sensed_need: '?' }; }
}

type Verdict = 'PASS' | 'FAIL' | 'WARN' | 'INFO';
interface Turn {
  text: string;
  mark?: string;
  // Given the probe's companion_offered, decide pass/fail for this turn.
  expect?: (offered: string) => { verdict: Verdict; why: string };
}
interface Scenario {
  name: string;
  goal: string;
  entryMode: string;
  turns: Turn[];
}

// Helpers for expectations.
const mustNotSolve = (offered: string) =>
  offered === 'problem_solving'
    ? { verdict: 'FAIL' as Verdict, why: 'jumped to problem-solving when the person only wanted to be heard' }
    : offered === 'mixed'
      ? { verdict: 'WARN' as Verdict, why: 'mixed — check it did not lead with fixing' }
      : { verdict: 'PASS' as Verdict, why: 'stayed with listening/presence' };

// The solve playbook OPENS by clarifying the problem ("first get clear on what the
// problem actually is"), which reads as reflecting. So on the pivot turn, clarifying
// counts as engaging; by the following turn we expect active problem-solving.
const beginsSolving = (offered: string) =>
  offered === 'problem_solving' || offered === 'mixed' || offered === 'reflecting'
    ? { verdict: 'PASS' as Verdict, why: 'engaged the solve playbook (clarify-the-problem is its first step)' }
    : { verdict: 'FAIL' as Verdict, why: 'ignored the explicit ask for help (stayed in pure listening/presence)' };

const shouldSolve = (offered: string) =>
  offered === 'problem_solving' || offered === 'mixed'
    ? { verdict: 'PASS' as Verdict, why: 'actively problem-solving after the pivot' }
    : { verdict: 'FAIL' as Verdict, why: 'did NOT reach active problem-solving a turn after the ask' };

const scenarios: Scenario[] = [
  {
    name: '#1 DRIFT — vent → solve',
    goal: 'Enters venting, then explicitly pivots to "what do I do". The solve playbook (unavailable before this change) should now kick in AFTER the pivot — but not before.',
    entryMode: 'vent',
    turns: [
      { text: "I'm completely fried. I give and give and there's just nothing left in the tank.", expect: mustNotSolve },
      { text: "The evenings are the worst — dinner, her meds, getting her settled, and I haven't even started my own stuff.", expect: mustNotSolve },
      { text: "Okay — honestly, what do I even do about the evenings? I can't keep going like this. I want to actually change something.", mark: 'PIVOT → asks for help', expect: beginsSolving },
      { text: "I guess I could move some things around, but I've tried before and it never sticks.", expect: shouldSolve },
    ],
  },
  {
    name: '#2 OVER-EAGERNESS — pure vent with solution-bait',
    goal: 'User keeps venting and EXPLICITLY says they do not want solutions, but drops solution-shaped details. The always-on solve guidance must NOT trigger premature fixing.',
    entryMode: 'vent',
    turns: [
      { text: "Worst day. Mom fell reaching for the bathroom while I was on a work call and I didn't hear her for ten minutes.", expect: mustNotSolve },
      { text: "She's okay, just a bruise. But I can't stop replaying it. What if it had been her hip?", expect: mustNotSolve },
      { text: "I know people would say get a monitor or whatever. I really don't need solutions right now. I just feel like a failure.", mark: 'EXPLICIT: no solutions', expect: mustNotSolve },
      { text: "It's not even about the fall. It's that I can't be everything at once and something is always slipping.", expect: mustNotSolve },
    ],
  },
];

// #3 entry fidelity — one neutral opener per mode; turn-1 should honor the entry.
const ENTRY_CHECKS: { mode: string; opener: string; ok: string[]; label: string }[] = [
  { mode: 'vent',    opener: 'I just need to get some stuff off my chest today.',        ok: ['listening', 'presence', 'reflecting'], label: 'lead with listening, not fixing' },
  { mode: 'reflect', opener: "I've been trying to make sense of how I felt after her last appointment.", ok: ['reflecting', 'listening', 'presence'], label: 'help them think it through' },
  { mode: 'solve',   opener: "I need to figure out a plan for Mom's mornings — they're chaos.", ok: ['problem_solving', 'reflecting'], label: 'begin the structured problem process (clarify counts)' },
  { mode: 'free',    opener: 'Not much on my mind, just felt like talking.',                ok: ['presence', 'listening'], label: 'be present, no agenda' },
];

const tally = { PASS: 0, FAIL: 0, WARN: 0, INFO: 0 };
function record(v: Verdict) { tally[v]++; }
const badge = (v: Verdict) => ({ PASS: '✓ PASS', FAIL: '✗ FAIL', WARN: '⚠ WARN', INFO: '· info' }[v]);

async function runScenario(sc: Scenario) {
  console.log('\n\n' + '█'.repeat(96));
  console.log(sc.name + `   [entry: ${sc.entryMode}]`);
  console.log('GOAL: ' + sc.goal);
  console.log('█'.repeat(96));

  const history: ChatCompletionMessageParam[] = [{ role: 'system', content: systemFor(sc.entryMode) }];
  for (let i = 0; i < sc.turns.length; i++) {
    const turn = sc.turns[i];
    history.push({ role: 'user', content: turn.text });
    const reply = await generate(history);
    const p = await probe(history.slice(0, -1), reply);
    history.push({ role: 'assistant', content: reply });

    const res = turn.expect ? turn.expect(p.companion_offered) : { verdict: 'INFO' as Verdict, why: '' };
    record(res.verdict);

    console.log('\n' + '─'.repeat(96));
    console.log(`TURN ${i + 1}${turn.mark ? '   <<< ' + turn.mark : ''}`);
    console.log('─'.repeat(96));
    console.log('CAREGIVER: ' + turn.text);
    console.log('\nCOMPANION: ' + reply.replace(/\n/g, '\n           '));
    console.log(`\n  [probe] need=${p.sensed_need} (${p.confidence})  offered=${p.companion_offered}  |  ${badge(res.verdict)} — ${res.why}`);
    console.log(`          probe-note: ${p.note}`);
  }
}

async function runEntryChecks() {
  console.log('\n\n' + '█'.repeat(96));
  console.log('#3 ENTRY FIDELITY — turn-1 per mode honors the menu selection');
  console.log('█'.repeat(96));
  for (const c of ENTRY_CHECKS) {
    const history: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemFor(c.mode) },
      { role: 'user', content: c.opener },
    ];
    const reply = await generate(history);
    const p = await probe(history, reply);
    const pass = c.ok.includes(p.companion_offered);
    const verdict: Verdict = pass ? 'PASS' : (p.companion_offered === 'mixed' ? 'WARN' : 'FAIL');
    record(verdict);

    console.log('\n' + '─'.repeat(96));
    console.log(`MODE ${c.mode.toUpperCase()}  — expect: ${c.label}  (ok: ${c.ok.join('/')})`);
    console.log('─'.repeat(96));
    console.log('CAREGIVER: ' + c.opener);
    console.log('\nCOMPANION: ' + reply.replace(/\n/g, '\n           '));
    console.log(`\n  [probe] offered=${p.companion_offered}  |  ${badge(verdict)}   probe-note: ${p.note}`);
  }
}

async function main() {
  for (const sc of scenarios) await runScenario(sc);
  await runEntryChecks();

  console.log('\n\n' + '='.repeat(96));
  console.log(`SUMMARY   ✓ ${tally.PASS} pass   ✗ ${tally.FAIL} fail   ⚠ ${tally.WARN} warn   · ${tally.INFO} info`);
  console.log('(model output is non-deterministic — skim the transcript to confirm the verdicts)');
  console.log('='.repeat(96));
}

main().catch(e => { console.error(e); process.exit(1); });
