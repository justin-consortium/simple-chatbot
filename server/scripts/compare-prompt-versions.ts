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

// Compare the NEW prompt (craft always-on + entry emphasis) against the EXACT
// prompt from before the change. The old single-mode files are preserved under
// prompts/old_prompt/, and background.txt is unchanged, so we can rebuild the old
// assembly faithfully and diff.
//
//   Text diff (default):  npx tsx server/scripts/compare-prompt-versions.ts
//     Writes old/new assembled prompts per mode to /tmp/promptcmp and prints where
//     they differ. (Pair with: git diff --no-index for a colored unified diff.)
//
//   Behavioral A/B:       npx tsx server/scripts/compare-prompt-versions.ts --behavior
//     Runs the same scripted turns through OLD and NEW and prints replies side by side.

const promptsDir = path.join(__dirname, '../prompts');
const oldDir = path.join(promptsDir, 'old_prompts');
const background = fs.readFileSync(path.join(promptsDir, 'background.txt'), 'utf-8').trim();
const openerReturning = fs.readFileSync(path.join(promptsDir, 'opener_returning.txt'), 'utf-8').trim();
const loadOld = (f: string) => fs.readFileSync(path.join(oldDir, f), 'utf-8').trim();

// ---- faithful reconstruction of the OLD prompt assembly ------------------
// (mirrors the pre-change promptService: {{THIS_CONVERSATION}} = one mode file)
const oldModeModules: Record<string, string> = {
  vent:     loadOld('mode_vent.txt'),
  reflect:  loadOld('mode_reflect.txt'),
  solve:    loadOld('mode_solve.txt'),
  free:     loadOld('mode_free.txt'),
  continue: loadOld('mode_continue.txt'),
};

function buildOldSystemPrompt(
  mode: string,
  profileContext: string,
  priorSummary: string,
  toneInstruction: string,
  conditionPhrase: string,
  timeContext: string,
): string {
  const resolvedMode = oldModeModules[mode] ? mode : 'free';
  let modeText = oldModeModules[resolvedMode];
  if (resolvedMode === 'continue') {
    modeText = priorSummary
      ? modeText.replace('{{PRIOR_SUMMARY}}', priorSummary)
      : oldModeModules['free'];
  }
  return background
    .replace('{{THIS_CONVERSATION}}', modeText)
    .replace('{{PROFILE_CONTEXT}}', profileContext)
    .replace('{{TONE}}', toneInstruction)
    .replace('{{CONDITION}}', conditionPhrase)
    .replace('{{TIME_CONTEXT}}', timeContext);
}

// ---- shared fixture -------------------------------------------------------
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
const PRIOR_SUMMARY = 'Last time, Maria was worn down after a hard week of appointments.';

const MODES = ['vent', 'reflect', 'solve', 'free', 'continue'];
const summaryFor = (mode: string) => (mode === 'continue' ? PRIOR_SUMMARY : '');

function oldFor(mode: string) {
  return buildOldSystemPrompt(mode, profileContext, summaryFor(mode), toneInstruction, conditionPhrase, '');
}
function newFor(mode: string) {
  return buildSystemPrompt(mode, profileContext, false, summaryFor(mode), toneInstruction, conditionPhrase, '');
}

// The only section that can differ is between these two headers.
const SECTION = '# THIS CONVERSATION';
const NEXT_HEADER = '# BOUNDARIES';
function thisConversationBlock(prompt: string): string {
  return prompt.split(SECTION)[1]?.split(NEXT_HEADER)[0]?.trim() ?? '(section not found)';
}

// ---- text-diff mode (default) --------------------------------------------
function textDiff() {
  const outDir = '/tmp/promptcmp';
  fs.mkdirSync(outDir, { recursive: true });
  for (const mode of MODES) {
    const oldP = oldFor(mode);
    const newP = newFor(mode);
    fs.writeFileSync(path.join(outDir, `old-${mode}.txt`), oldP + '\n');
    fs.writeFileSync(path.join(outDir, `new-${mode}.txt`), newP + '\n');

    // Sanity: everything OUTSIDE the THIS CONVERSATION section must be identical.
    const oldRest = oldP.replace(thisConversationBlock(oldP), '§');
    const newRest = newP.replace(thisConversationBlock(newP), '§');
    const restIdentical = oldRest === newRest;

    console.log('\n' + '█'.repeat(96));
    console.log(`MODE: ${mode}   (rest of prompt identical: ${restIdentical ? 'YES ✓' : 'NO ✗ — investigate'})`);
    console.log('█'.repeat(96));
    console.log('\n── OLD  # THIS CONVERSATION ──────────────────────────────────────────────');
    console.log(thisConversationBlock(oldP));
    console.log('\n── NEW  # THIS CONVERSATION ──────────────────────────────────────────────');
    console.log(thisConversationBlock(newP));
  }
  console.log('\n' + '='.repeat(96));
  console.log('Full prompts written to /tmp/promptcmp/. For a colored unified diff, e.g.:');
  for (const mode of MODES) {
    console.log(`  git diff --no-index --color /tmp/promptcmp/old-${mode}.txt /tmp/promptcmp/new-${mode}.txt`);
  }
  console.log('='.repeat(96));
}

// ---- behavioral A/B mode (--behavior) ------------------------------------
async function generate(messages: ChatCompletionMessageParam[]): Promise<string> {
  let out = '';
  for await (const token of streamTokens(messages)) out += token;
  return out.trim();
}

interface ABScenario { name: string; mode: string; turns: { text: string; mark?: string }[]; watch: string; }

const AB_SCENARIOS: ABScenario[] = [
  {
    name: 'EXPLICIT drift — vent → solve, full solve arc',
    mode: 'vent',
    watch: 'After the pivot, does it run the STRUCTURED process — draw out HER ideas before advising, weigh options, ask permission, land on a concrete next step — or just hand over generic tips?',
    turns: [
      { text: "I'm completely fried. There's just nothing left in the tank." },
      { text: "The evenings are the worst — dinner, meds, getting her settled, and I haven't started my own stuff." },
      { text: "Okay — honestly, what do I even do about the evenings? I want to actually change something.", mark: 'PIVOT → asks for help' },
      { text: "I guess I could move some things around, but I've tried before and it never sticks." },
      { text: "Maybe I could ask my sister to take one evening a week... but I hate feeling like a burden.", mark: 'offers HER own idea' },
      { text: "Okay. What should I actually try this week?", mark: 'wants a concrete next step' },
    ],
  },
  {
    name: 'IMPLICIT drift — vent, a solvable problem surfaces but is never explicitly asked',
    mode: 'vent',
    watch: 'The user never says "what do I do". A concrete, controllable problem quietly surfaces. Does NEW gently offer to work it (with permission), while OLD stays purely in venting?',
    turns: [
      { text: "Some nights I just feel completely alone in this, like no one gets what it's like." },
      { text: "She wakes up around 3am confused and then I'm up for the rest of the night." },
      { text: "By the afternoon I'm a zombie, so she naps and I nap, and then of course she's wired again at night.", mark: 'solvable pattern surfaces' },
      { text: "I read somewhere you're not supposed to let them nap too long in the day, but I'm too tired to fight it." },
      { text: "I don't know. I just don't know how to break the cycle.", mark: 'implicit opening for help' },
    ],
  },
];

const PROBE_SYSTEM = `You are a silent observer. Given a caregiver/companion conversation and the companion's latest reply, classify ONLY what the companion did on this turn. Return JSON exactly:
{ "companion_offered": "presence" | "listening" | "reflecting" | "problem_solving" | "mixed", "drew_out_their_ideas": true|false, "asked_permission": true|false, "concrete_next_step": true|false, "note": "one short clause" }`;

async function probe(history: ChatCompletionMessageParam[], reply: string): Promise<any> {
  const transcript = history.filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'CAREGIVER' : 'COMPANION'}: ${m.content}`).join('\n');
  const raw = await callOnce([
    { role: 'system', content: PROBE_SYSTEM },
    { role: 'user', content: `${transcript}\nCOMPANION (latest): ${reply}` },
  ]);
  try { return JSON.parse(raw); } catch { return { companion_offered: '?', note: 'parse-failed' }; }
}

function probeLine(p: any): string {
  const flags = [
    p.drew_out_their_ideas ? 'elicited-her-ideas' : null,
    p.asked_permission ? 'asked-permission' : null,
    p.concrete_next_step ? 'concrete-step' : null,
  ].filter(Boolean).join(', ');
  return `offered=${p.companion_offered}${flags ? '  [' + flags + ']' : ''}  — ${p.note}`;
}

async function behaviorAB() {
  for (const sc of AB_SCENARIOS) {
    const histOld: ChatCompletionMessageParam[] = [{ role: 'system', content: oldFor(sc.mode) }];
    const histNew: ChatCompletionMessageParam[] = [{ role: 'system', content: newFor(sc.mode) }];

    console.log('\n' + '█'.repeat(96));
    console.log(`A/B — ${sc.name}   [entry: ${sc.mode}]`);
    console.log('WATCH: ' + sc.watch);
    console.log('█'.repeat(96));

    for (let i = 0; i < sc.turns.length; i++) {
      const u = sc.turns[i].text;
      histOld.push({ role: 'user', content: u });
      histNew.push({ role: 'user', content: u });
      const [rOld, rNew] = [await generate(histOld), await generate(histNew)];
      const [pOld, pNew] = [await probe(histOld.slice(0, -1), rOld), await probe(histNew.slice(0, -1), rNew)];
      histOld.push({ role: 'assistant', content: rOld });
      histNew.push({ role: 'assistant', content: rNew });

      console.log('\n' + '─'.repeat(96));
      console.log(`TURN ${i + 1}${sc.turns[i].mark ? '   <<< ' + sc.turns[i].mark : ''}`);
      console.log('─'.repeat(96));
      console.log('CAREGIVER: ' + u);
      console.log('\n  OLD (single-mode):\n  ' + rOld.replace(/\n/g, '\n  '));
      console.log('  └─ probe: ' + probeLine(pOld));
      console.log('\n  NEW (craft always-on):\n  ' + rNew.replace(/\n/g, '\n  '));
      console.log('  └─ probe: ' + probeLine(pNew));
    }
  }
}

// ---- opener A/B mode (--openers) -----------------------------------------
// How does each prompt OPEN a returning session, per mode? (opener_returning says
// "open in the spirit of the THIS CONVERSATION section", so the mode shapes it.)
async function openerAB() {
  console.log('\nReturning-session openers — OLD (single-mode) vs NEW (craft always-on)\n');
  for (const mode of MODES) {
    const oldSys = `${oldFor(mode)}\n\n${openerReturning}`;
    const newSys = `${newFor(mode)}\n\n${openerReturning}`;
    const [rOld, rNew] = [
      await generate([{ role: 'system', content: oldSys }]),
      await generate([{ role: 'system', content: newSys }]),
    ];
    console.log('█'.repeat(96));
    console.log(`MODE: ${mode}`);
    console.log('█'.repeat(96));
    console.log('  OLD:\n  ' + rOld.replace(/\n/g, '\n  '));
    console.log('\n  NEW:\n  ' + rNew.replace(/\n/g, '\n  '));
    console.log('');
  }
}

async function main() {
  if (process.argv.includes('--behavior')) {
    await behaviorAB();
  } else if (process.argv.includes('--openers')) {
    await openerAB();
  } else {
    textDiff();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
