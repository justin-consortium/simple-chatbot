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
import { streamTokens } from '../services/aiService';

// A/B PROBE — does "craft always-on" handle mid-conversation drift better than the
// current single-mode prompt, WITHOUT over-triggering (jumping to solve when the
// person just wants to be heard)?
//
//   Condition A (current):  background + the entry mode only
//   Condition B (proposed): background + all three crafts as an always-on repertoire,
//                           with the entry mode as opening emphasis
//
// SAME scripted user turns feed both conditions. Run:
//   npx tsx server/scripts/preview-craft-drift.ts

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

// Always-on craft bullets (faithful condensations of mode_vent/reflect/solve).
const CRAFT_BULLETS = `- When they need to be heard: keep listening and validation at the center; being heard *is* the help. Once they feel heard, you may gently check whether they'd like to sit with the feeling or look at what's next — lightly and easy to decline.
- When they are making sense of an experience: help them think it through with open, gentle questions, drawing out the link between what happened, the thoughts it raised, and how they felt. Where it fits, help them examine whether a thought is the whole picture, or whether there's a kinder, more balanced way to see it — offered as an invitation they can take or leave, never a correction.
- When they are working through a concrete problem: treat it as a shared, structured process — first get clear on what the problem actually is, then draw out *their* own possible approaches before you add any, weigh the options together, and help them land on a concrete next step they could try. Offer your own suggestions only with permission. If the problem turns out not to be controllable, gently shift toward making sense of it or sitting with it instead.`;

const ENTRY_EMPHASIS: Record<string, string> = {
  vent: 'The person came to this conversation wanting to vent, so begin there: keep listening and validation at the center and make sure they feel genuinely heard.',
  reflect: 'The person came to this conversation wanting to make sense of an experience, so begin there: help them think it through.',
  solve: 'The person came to this conversation wanting to work through a concrete problem, so begin there: work it as a shared, structured process.',
};

function craftBlock(entryMode: string): string {
  return `${ENTRY_EMPHASIS[entryMode]} But people don't always stay where they started — as you talk they may move toward being heard, toward making sense of an experience, or toward working through a concrete problem. Stay attentive to where they actually are, and draw on whichever of these the moment calls for, moving with them rather than ahead of them:

${CRAFT_BULLETS}

Never push them toward problem-solving before they feel heard; let the shift come from them.`;
}

function buildB(entryMode: string): string {
  return background
    .replace('{{THIS_CONVERSATION}}', craftBlock(entryMode))
    .replace('{{PROFILE_CONTEXT}}', profileContext)
    .replace('{{TONE}}', toneInstruction)
    .replace('{{CONDITION}}', conditionPhrase)
    .replace('{{TIME_CONTEXT}}', '');
}

interface Scenario {
  name: string;
  tests: string;
  entryMode: 'vent' | 'reflect' | 'solve';
  turns: { text: string; mark?: string }[];
}

const scenarios: Scenario[] = [
  {
    name: 'S1 — vent → solve (replication check)',
    tests: 'Does the Turn-3 divergence reproduce on a fresh scenario? (A stays in validation; B opens the problem.)',
    entryMode: 'vent',
    turns: [
      { text: "I'm completely fried today. I feel like I give and give and there's just nothing left in the tank." },
      { text: "And the worst part is feeling like I'm doing it all alone. People say nice things but no one shows up." },
      { text: "The evenings are what break me, honestly. Dinner, her meds, getting her settled, and by then I haven't even started my own stuff. Something has to change.", mark: 'DRIFT → concrete problem' },
      { text: "I guess I could move some things around, but I've tried before and it never sticks. I don't even know where I'd start this time." },
      { text: "Maybe. I just don't want to set up another system that falls apart in a week and makes me feel worse." },
    ],
  },
  {
    name: 'S2 — solve → vent (de-escalation test)',
    tests: 'User enters wanting to solve, but the "problem" turns into uncontrollable grief. Does A keep pushing solutions? Does B de-escalate to listening?',
    entryMode: 'solve',
    turns: [
      { text: "I want to get a handle on Mom's medication schedule — it's gotten complicated and I keep mixing up which pills go when. I need a system." },
      { text: "I tried a pill organizer but every time the doctor adjusts a dose the timing changes, so it's a moving target." },
      { text: "Honestly... I don't even know why I'm trying to optimize this. She's getting worse no matter what I do. Last week she didn't know who I was for a few minutes.", mark: 'DRIFT → uncontrollable grief' },
      { text: "I just keep going through the motions, because if I actually stop and feel it, I don't think I'll be able to get back up." },
      { text: "I don't really want advice right now. I think I just needed to say that out loud to someone." },
    ],
  },
  {
    name: 'S3 — vent with solvable bait (over-trigger / misclassification test)',
    tests: 'User keeps venting but drops solution-shaped details. Does B WRONGLY jump to problem-solving? It should stay with listening.',
    entryMode: 'vent',
    turns: [
      { text: "I had the worst day. Mom fell trying to get to the bathroom while I was on a work call, and I didn't hear her for ten minutes." },
      { text: "She's okay, just a bruise. But I can't stop replaying it. What if it had been her hip? I was right there and I didn't hear her." },
      { text: "I know, I know — people would say get a monitor or whatever. I really don't need solutions right now. I just feel like a failure.", mark: 'explicit: does NOT want solutions' },
      { text: "It's not even about the fall, really. It's that I can't be everything at once and something is always slipping." },
      { text: "Thanks for letting me say it. I don't get to put this into words out loud very often." },
    ],
  },
];

async function generate(messages: ChatCompletionMessageParam[]): Promise<string> {
  let out = '';
  for await (const token of streamTokens(messages)) out += token;
  return out.trim();
}

async function runCondition(system: string, turns: Scenario['turns']): Promise<string[]> {
  const history: ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  const replies: string[] = [];
  for (const turn of turns) {
    history.push({ role: 'user', content: turn.text });
    const reply = await generate(history);
    history.push({ role: 'assistant', content: reply });
    replies.push(reply);
  }
  return replies;
}

async function main() {
  for (const sc of scenarios) {
    const systemA = buildSystemPrompt(sc.entryMode, profileContext, false, '', toneInstruction, conditionPhrase, '');
    const systemB = buildB(sc.entryMode);

    process.stdout.write(`\nRunning ${sc.name} …`);
    const [repliesA, repliesB] = [await runCondition(systemA, sc.turns), await runCondition(systemB, sc.turns)];
    process.stdout.write(' done\n');

    console.log('\n\n' + '█'.repeat(94));
    console.log(sc.name + `   [entry mode: ${sc.entryMode}]`);
    console.log('TEST: ' + sc.tests);
    console.log('█'.repeat(94));

    for (let i = 0; i < sc.turns.length; i++) {
      console.log('\n' + '─'.repeat(94));
      console.log(`TURN ${i + 1}${sc.turns[i].mark ? '   <<< ' + sc.turns[i].mark : ''}`);
      console.log('─'.repeat(94));
      console.log('CAREGIVER: ' + sc.turns[i].text);
      console.log('\n  A (current — ' + sc.entryMode + ' only):\n  ' + repliesA[i].replace(/\n/g, '\n  '));
      console.log('\n  B (craft always-on):\n  ' + repliesB[i].replace(/\n/g, '\n  '));
    }
  }
  console.log('\n' + '█'.repeat(94));
}

main().catch(e => { console.error(e); process.exit(1); });
