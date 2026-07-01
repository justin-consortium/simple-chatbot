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
import { streamTokens, callOnce } from '../services/aiService';

// Blind, multi-run A/B evaluation of OLD (single-mode) vs NEW (craft always-on).
// For each scenario we run N independent conversations per version, then a BLIND
// judge (order randomized, does not know which is which) scores each full
// transcript on 4 caregiver-centered dimensions and picks an overall winner.
// Aggregates mean scores + win rates so the comparison is a number, not an anecdote.
//
//   Run:  npx tsx server/scripts/eval-ab-blind.ts            (N=5 per scenario)
//         npx tsx server/scripts/eval-ab-blind.ts --runs 10
//
// Cost warning: ~ (turns*2 + 1) * runs * scenarios model calls. N=5 ≈ 130 calls.

const RUNS = (() => {
  const i = process.argv.indexOf('--runs');
  return i >= 0 ? Math.max(1, parseInt(process.argv[i + 1], 10) || 5) : 5;
})();

// ---- OLD prompt reconstruction (from prompts/old_prompts/) ----------------
const promptsDir = path.join(__dirname, '../prompts');
const oldDir = path.join(promptsDir, 'old_prompts');
const background = fs.readFileSync(path.join(promptsDir, 'background.txt'), 'utf-8').trim();
const loadOld = (f: string) => fs.readFileSync(path.join(oldDir, f), 'utf-8').trim();
const oldModeModules: Record<string, string> = {
  vent: loadOld('mode_vent.txt'), reflect: loadOld('mode_reflect.txt'),
  solve: loadOld('mode_solve.txt'), free: loadOld('mode_free.txt'), continue: loadOld('mode_continue.txt'),
};

const profile = {
  displayName: 'Maria', tone: '',
  coping: [{ approach: 'a short walk', effect: '' }],
  caregivingSituation: 'Caring for her mother, who has dementia, for 2 years.',
  threads: [] as string[],
};
const conditionPhrase = renderConditionPhrase('ADRD');
const profileContext = renderProfileContext(profile);
const toneInstruction = renderToneInstruction(profile.tone);

function oldSystem(mode: string): string {
  const resolved = oldModeModules[mode] ? mode : 'free';
  return background
    .replace('{{THIS_CONVERSATION}}', oldModeModules[resolved])
    .replace('{{PROFILE_CONTEXT}}', profileContext)
    .replace('{{TONE}}', toneInstruction)
    .replace('{{CONDITION}}', conditionPhrase)
    .replace('{{TIME_CONTEXT}}', '');
}
function newSystem(mode: string): string {
  return buildSystemPrompt(mode, profileContext, false, '', toneInstruction, conditionPhrase, '');
}

// ---- scenarios ------------------------------------------------------------
const SCENARIOS: { name: string; mode: string; turns: string[] }[] = [
  {
    name: 'explicit-drift',
    mode: 'vent',
    turns: [
      "I'm completely fried. There's just nothing left in the tank.",
      "The evenings are the worst — dinner, meds, getting her settled, and I haven't started my own stuff.",
      "Okay — honestly, what do I even do about the evenings? I want to actually change something.",
      "I guess I could move some things around, but I've tried before and it never sticks.",
      "Maybe I could ask my sister to take one evening a week... but I hate feeling like a burden.",
      "Okay. What should I actually try this week?",
    ],
  },
  {
    name: 'implicit-drift',
    mode: 'vent',
    turns: [
      "Some nights I just feel completely alone in this, like no one gets what it's like.",
      "She wakes up around 3am confused and then I'm up for the rest of the night.",
      "By the afternoon I'm a zombie, so she naps and I nap, and then of course she's wired again at night.",
      "I read somewhere you're not supposed to let them nap too long in the day, but I'm too tired to fight it.",
      "I don't know. I just don't know how to break the cycle.",
    ],
  },
];

async function generate(messages: ChatCompletionMessageParam[]): Promise<string> {
  let out = '';
  for await (const token of streamTokens(messages)) out += token;
  return out.trim();
}

async function runConversation(system: string, turns: string[]): Promise<string> {
  const history: ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  const lines: string[] = [];
  for (const u of turns) {
    history.push({ role: 'user', content: u });
    const reply = await generate(history);
    history.push({ role: 'assistant', content: reply });
    lines.push(`CAREGIVER: ${u}\nASSISTANT: ${reply}`);
  }
  return lines.join('\n\n');
}

// ---- blind judge ----------------------------------------------------------
const JUDGE_SYSTEM = `You are an impartial expert evaluating two anonymized companion chatbots (A and B) that support FAMILY CAREGIVERS. The goal of these bots is to support the caregiver's OWN wellbeing: make them feel heard, meet them where they are, and — only when the caregiver moves toward it — help them work through a concrete problem collaboratively. Rushing to fix before someone feels heard is a flaw; so is ignoring a clear, explicit request for help.

You will see the SAME caregiver messages answered by A and by B (two separate conversations). Score EACH bot 1–5 on four dimensions, then pick the overall better one for a family caregiver.

Dimensions (1=poor, 5=excellent):
- attunement: does the caregiver feel genuinely heard; are feelings acknowledged and reflected?
- pacing: does it meet her where she is — neither rushing to solutions before she's ready, nor withholding help once she clearly asks?
- structured_support: WHEN she moves toward practical help, is it a shared, collaborative process (draws out HER ideas, seeks permission, lands on a concrete next step) rather than generic advice-dumping? If she never asks for help, judge whether it appropriately stayed supportive without forcing solutions.
- warmth: warm, unhurried, non-judgmental tone.

Use the FULL 1–5 range and DIFFERENTIATE: do not give everything 5. Reserve 5 for genuinely exceptional and reflect real differences between A and B. Then, for each dimension, say which conversation was better (or tie) — force a preference wherever there is any real difference, only using "tie" when they are truly indistinguishable.

Return JSON exactly:
{ "A": {"attunement":n,"pacing":n,"structured_support":n,"warmth":n},
  "B": {"attunement":n,"pacing":n,"structured_support":n,"warmth":n},
  "dim_winner": {"attunement":"A|B|tie","pacing":"A|B|tie","structured_support":"A|B|tie","warmth":"A|B|tie"},
  "overall_winner": "A" | "B" | "tie",
  "reason": "one short sentence" }`;

interface Dims { attunement: number; pacing: number; structured_support: number; warmth: number }
const DIMS: (keyof Dims)[] = ['attunement', 'pacing', 'structured_support', 'warmth'];

async function judge(transA: string, transB: string): Promise<any> {
  const raw = await callOnce([
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: `=== CONVERSATION A ===\n${transA}\n\n=== CONVERSATION B ===\n${transB}` },
  ]);
  try { return JSON.parse(raw); } catch { return null; }
}

type Side = 'old' | 'new' | 'tie';
interface Result { old: Dims; new: Dims; winner: Side; dimWinner: Record<keyof Dims, Side> }

// Decode a judge "A|B|tie" verdict back to old/new given which one was shown as A.
const decode = (v: string, oldIsA: boolean): Side =>
  v === 'tie' ? 'tie' : (v === 'A' ? (oldIsA ? 'old' : 'new') : (oldIsA ? 'new' : 'old'));

async function evalScenario(sc: typeof SCENARIOS[number]): Promise<Result[]> {
  const oldSys = oldSystem(sc.mode);
  const newSys = newSystem(sc.mode);
  const results: Result[] = [];
  for (let r = 0; r < RUNS; r++) {
    const [oldConv, newConv] = [await runConversation(oldSys, sc.turns), await runConversation(newSys, sc.turns)];
    // blind: randomize which one the judge sees as A
    const oldIsA = Math.random() < 0.5;
    const v = await judge(oldIsA ? oldConv : newConv, oldIsA ? newConv : oldConv);
    if (!v) { process.stdout.write('x'); continue; }
    const oldDims = oldIsA ? v.A : v.B;
    const newDims = oldIsA ? v.B : v.A;
    const dw = v.dim_winner ?? {};
    const dimWinner = Object.fromEntries(
      DIMS.map(d => [d, decode(dw[d] ?? 'tie', oldIsA)]),
    ) as Record<keyof Dims, Side>;
    results.push({ old: oldDims, new: newDims, winner: decode(v.overall_winner, oldIsA), dimWinner });
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return results;
}

function mean(rs: Result[], side: 'old' | 'new', d: keyof Dims): number {
  const xs = rs.map(r => r[side][d]).filter(n => typeof n === 'number');
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function report(name: string, rs: Result[]) {
  console.log('\n' + '='.repeat(72));
  console.log(`SCENARIO: ${name}   (n=${rs.length} valid runs)`);
  console.log('='.repeat(72));
  console.log('  dimension            OLD    NEW    Δ       win:NEW/OLD/tie');
  for (const d of DIMS) {
    const o = mean(rs, 'old', d), n = mean(rs, 'new', d);
    const delta = n - o;
    const arrow = Math.abs(delta) < 0.05 ? '≈' : delta > 0 ? '▲' : '▼';
    const dw = { old: 0, new: 0, tie: 0 };
    rs.forEach(r => dw[r.dimWinner[d]]++);
    console.log(`  ${d.padEnd(20)} ${o.toFixed(2)}   ${n.toFixed(2)}   ${arrow}${delta >= 0 ? '+' : ''}${delta.toFixed(2)}   ${dw.new}/${dw.old}/${dw.tie}`);
  }
  const w = { old: 0, new: 0, tie: 0 };
  rs.forEach(r => w[r.winner]++);
  console.log(`  overall winner:  NEW ${w.new}  |  OLD ${w.old}  |  tie ${w.tie}   (of ${rs.length})`);
}

async function main() {
  console.log(`Blind A/B eval — ${RUNS} runs/scenario. Progress ('.'=run, 'x'=judge parse fail):`);
  const all: Result[] = [];
  for (const sc of SCENARIOS) {
    process.stdout.write(`  ${sc.name}: `);
    const rs = await evalScenario(sc);
    report(sc.name, rs);
    all.push(...rs);
  }
  report('ALL SCENARIOS COMBINED', all);
  console.log('\n(1–5 per dimension; higher is better. Judge was blind to which prompt was which.)');
}

main().catch(e => { console.error(e); process.exit(1); });
