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

// B′ = craft always-on, FOUR cards (presence added) + ambiguity fail-safe default.
// NO judge-gate in the reply. A SEPARATE observe-only probe classifies each turn
// AFTER the reply is generated — it never steers the reply.
//
//   A  = production `free` mode (faithful "just chat" baseline)
//   B′ = the updated prompt below
//
//   Run: npx tsx server/scripts/preview-craft-probe.ts

const promptsDir = path.join(__dirname, '../prompts');
const background = fs.readFileSync(path.join(promptsDir, 'background.txt'), 'utf-8').trim();

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

// ---------- B′ craft block: 4 cards + ambiguity default (no gate) ----------
const CRAFT_BLOCK = `The person hasn't named a specific need — they just came to talk. Begin by simply being with them: warm, curious, unhurried, following whatever they bring.

People may stay there, or as you talk they may move toward wanting to be heard, toward making sense of an experience, or toward working through a concrete problem. Stay attentive to where they actually are, and draw on whichever of these the moment calls for — moving with them, never ahead of them:

- When they just want company — talking, sharing their day, not looking for anything in particular: meet them there. Be present and curious and let it unfold. Not every moment needs a direction; being someone they can talk to is itself the support.
- When they need to be heard: keep listening and validation at the center; being heard *is* the help. Once they feel heard, you may gently check whether they'd like to sit with the feeling or look at what's next — lightly, easy to decline.
- When they are making sense of an experience: help them think it through with open, gentle questions, drawing out the link between what happened, the thoughts it raised, and how they felt. Offer any reframe as an invitation, never a correction.
- When they are working through a concrete problem: treat it as a shared, structured process — first get clear on what the problem actually is, then draw out *their* own ideas before adding yours, weigh options together, and help them land on a concrete next step. Offer suggestions only with permission. If it isn't controllable, gently shift toward making sense of it or sitting with it.

When it's unclear what they need — and often it will be — do not rush to categorize it or ask them to choose. Default to being present, and let what they need surface on its own. Only move toward making sense or problem-solving once they've clearly gone there themselves. When in doubt, stay with listening and presence.`;

const systemBprime = background
  .replace('{{THIS_CONVERSATION}}', CRAFT_BLOCK)
  .replace('{{PROFILE_CONTEXT}}', profileContext)
  .replace('{{TONE}}', toneInstruction)
  .replace('{{CONDITION}}', conditionPhrase)
  .replace('{{TIME_CONTEXT}}', '');

// Faithful baseline: what the app does today for "just chat".
const systemA = buildSystemPrompt('free', profileContext, false, '', toneInstruction, conditionPhrase, '');

// ---------- separate, observe-only probe (runs AFTER the reply) ----------
const PROBE_SYSTEM = `You are a silent observer evaluating ONE turn of a conversation between a family caregiver and a companion chatbot. You see the conversation so far and the companion's latest reply. Report what the caregiver seemed to need on THIS turn and what the companion actually did. Classify only — do not rewrite or grade tone.

Return JSON exactly in this shape:
{
  "sensed_need": "be_heard" | "make_sense" | "solve" | "just_company" | "unclear",
  "confidence": "low" | "med" | "high",
  "companion_offered": "presence" | "listening" | "reflecting" | "problem_solving" | "mixed",
  "aligned": true or false,
  "note": "one short clause"
}`;

async function probe(history: ChatCompletionMessageParam[], reply: string): Promise<any> {
  const transcript = history
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'CAREGIVER' : 'COMPANION'}: ${m.content}`)
    .join('\n');
  const raw = await callOnce([
    { role: 'system', content: PROBE_SYSTEM },
    { role: 'user', content: `${transcript}\nCOMPANION (latest): ${reply}` },
  ]);
  try { return JSON.parse(raw); } catch { return { note: 'parse-failed', raw }; }
}

async function generate(messages: ChatCompletionMessageParam[]): Promise<string> {
  let out = '';
  for await (const token of streamTokens(messages)) out += token;
  return out.trim();
}

// Ambiguous opener → diffuse narration → a quiet loneliness surfaces (never a "problem")
const userTurns = [
  "I don't really have anything specific. Today was just... a lot, I guess. I don't even know where to start.",
  "Mom had a doctor's appointment, then I did three loads of laundry, made dinner — the usual. Nothing dramatic. Just one of those days that blur together.",
  "I think I'm just talking to hear myself, honestly. The house gets really quiet after she's asleep.",
  "Yeah. I used to call my sister in the evenings but we've kind of drifted. It's mostly just me and the TV now.",
  "It's fine, mostly. Tonight it just felt nice to type to someone who answers.",
];

async function main() {
  const histA: ChatCompletionMessageParam[] = [{ role: 'system', content: systemA }];
  const histB: ChatCompletionMessageParam[] = [{ role: 'system', content: systemBprime }];

  for (let i = 0; i < userTurns.length; i++) {
    const u = userTurns[i];
    histA.push({ role: 'user', content: u });
    histB.push({ role: 'user', content: u });

    const replyA = await generate(histA);
    const replyB = await generate(histB);
    histA.push({ role: 'assistant', content: replyA });
    histB.push({ role: 'assistant', content: replyB });

    // probe observes B′'s turn, AFTER the reply exists — separate call, no steering
    const p = await probe(histB.slice(0, -1), replyB);

    console.log('\n' + '─'.repeat(96));
    console.log(`TURN ${i + 1}`);
    console.log('─'.repeat(96));
    console.log('CAREGIVER: ' + u);
    console.log('\n  A  (current `free` mode):\n  ' + replyA.replace(/\n/g, '\n  '));
    console.log('\n  B′ (4 cards + ambiguity default):\n  ' + replyB.replace(/\n/g, '\n  '));
    const flag = p.aligned === true ? '✓ aligned' : p.aligned === false ? '✗ MISALIGNED' : '?';
    console.log(`\n  └─ [invisible probe]  need=${p.sensed_need} (${p.confidence})  offered=${p.companion_offered}  ${flag}`);
    console.log(`                        note: ${p.note}`);
  }
  console.log('\n' + '─'.repeat(96));
}

main().catch(e => { console.error(e); process.exit(1); });
