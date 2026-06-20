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

// In-session time behavior preview: with the time context injected, does the model
// greet by time of day and resolve "tomorrow / this evening / yesterday" correctly?
// Eyeball test (LLM output varies). Run with:
//   npx tsx server/scripts/preview-in-session.ts

const TZ = 'America/New_York';
const openerReturning = fs.readFileSync(path.join(__dirname, '../prompts/opener_returning.txt'), 'utf-8').trim();

const profile = {
  displayName: 'Maria',
  tone: '',
  coping: [{ approach: 'walking', effect: '' }],
  caregivingSituation: 'Caring for their spouse or partner, for 3 years.',
  threads: [] as string[],
};

// at(localHour) → an instant that is that hour, today, in TZ (EDT = UTC-4).
const at = (hour: number) => new Date(`2026-06-24T${String(hour).padStart(2, '0')}:00:00-04:00`);

interface Scenario {
  label: string;
  now: Date;
  kind: 'opener' | 'message';
  userMessage?: string;
}

const scenarios: Scenario[] = [
  { label: 'Returning opener — morning (8 AM)',  now: at(8),  kind: 'opener' },
  { label: 'Returning opener — night (9 PM)',    now: at(21), kind: 'opener' },
  { label: '"tomorrow morning" (said Wed 2 PM)',  now: at(14), kind: 'message',
    userMessage: "I'm taking my mom to the doctor tomorrow morning and I'm pretty nervous about it." },
  { label: '"this evening" (said 10 AM)',         now: at(10), kind: 'message',
    userMessage: "I have to make a hard phone call this evening and I'm dreading it." },
  { label: '"yesterday" (said 11 AM)',            now: at(11), kind: 'message',
    userMessage: "Yesterday was honestly one of the worst days I've had in a while." },
];

async function generate(messages: ChatCompletionMessageParam[]): Promise<string> {
  let out = '';
  for await (const token of streamTokens(messages)) out += token;
  return out;
}

async function main() {
  const conditionPhrase = renderConditionPhrase('TBI');
  for (const s of scenarios) {
    // Returning context (a few days since last chat) so the opener is the returning one.
    const timeContext = renderTimeContext({
      now: s.now,
      timeZone: TZ,
      lastSessionAt: new Date(s.now.getTime() - 3 * 24 * 60 * 60 * 1000),
    });
    const systemPrompt = buildSystemPrompt(
      'free',
      renderProfileContext(profile),
      false,
      '',
      renderToneInstruction(profile.tone),
      conditionPhrase,
      timeContext,
    );

    const messages: ChatCompletionMessageParam[] =
      s.kind === 'opener'
        ? [{ role: 'system', content: `${systemPrompt}\n\n${openerReturning}` }]
        : [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: s.userMessage! },
          ];

    const reply = await generate(messages);
    console.log('\n' + '='.repeat(80));
    console.log(s.label);
    console.log('  ' + timeContext.split('\n')[1]); // the "Current local time:" line
    if (s.userMessage) console.log('\nCaregiver: ' + s.userMessage);
    console.log('\nCompanion: ' + reply.trim());
  }
  console.log('\n' + '='.repeat(80));
}

main().catch(e => { console.error(e); process.exit(1); });
