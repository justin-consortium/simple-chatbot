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

// Generates opener/greeting messages for a set of synthetic profiles, using the
// exact same path POST /api/session/start uses (buildSystemPrompt + the opener
// instruction + streamTokens). Read-only: touches no database, just prints.

const promptsDir = path.join(__dirname, '../prompts');
const openerFirst = fs.readFileSync(path.join(promptsDir, 'opener_first.txt'), 'utf-8').trim();
const openerReturning = fs.readFileSync(path.join(promptsDir, 'opener_returning.txt'), 'utf-8').trim();

interface PreviewProfile {
  label: string;
  mode: string;
  firstSession: boolean;
  priorSummary?: string;     // returning sessions only
  careRecipientCondition: string;
  displayName: string;
  tone: string;              // bare stored preference, '' = warm only
  coping: CopingEntry[];
  caregivingSituation: string;
  threads: string[];
}

// Varied across condition, relationship, tone preference, and how much is known.
const PROFILES: PreviewProfile[] = [
  {
    label: 'Maria — TBI, spouse, warm only — FIRST session',
    mode: 'free', firstSession: true,
    careRecipientCondition: 'TBI',
    displayName: 'Maria',
    tone: '',
    coping: [{ approach: 'walking', effect: '' }, { approach: 'gardening', effect: '' }],
    caregivingSituation: 'Caring for their spouse or partner, for 3 years. Their caregiving includes: personal care, healthcare coordination.',
    threads: [],
  },
  {
    label: 'James — ADRD, parent, prefers direct — FIRST session',
    mode: 'free', firstSession: true,
    careRecipientCondition: 'ADRD',
    displayName: 'James',
    tone: 'direct and to the point, going easy on hedging',
    coping: [{ approach: 'connecting with others', effect: '' }],
    caregivingSituation: 'Caring for their parent, for 5 years. Their caregiving includes: supervision, transportation, financial management.',
    threads: [],
  },
  {
    label: 'Priya — HD, sibling, open to humor — FIRST session',
    mode: 'free', firstSession: true,
    careRecipientCondition: 'HD',
    displayName: 'Priya',
    tone: 'open to gentle humor when the moment allows',
    coping: [{ approach: 'quiet and rest', effect: '' }, { approach: 'reflection or spiritual practice', effect: '' }],
    caregivingSituation: 'Caring for their sibling, for 1 year. Their caregiving includes: companionship, mobility assistance.',
    threads: [],
  },
  {
    label: 'Robert — TBI, minimal profile (name + situation only) — FIRST session',
    mode: 'free', firstSession: true,
    careRecipientCondition: 'TBI',
    displayName: 'Robert',
    tone: '',
    coping: [],
    caregivingSituation: 'Caring for their parent.',
    threads: [],
  },
  {
    label: 'Maria — TBI — RETURNING session (reflect mode, with prior recap + threads)',
    mode: 'reflect', firstSession: false,
    priorSummary: 'Last time, Maria was worn down after a hard week of appointments and was trying to carve out a little time for herself.',
    careRecipientCondition: 'TBI',
    displayName: 'Maria',
    tone: '',
    coping: [{ approach: 'walking', effect: 'helps her clear her head' }],
    caregivingSituation: 'Caring for their spouse or partner, for 3 years. Their caregiving includes: personal care, healthcare coordination.',
    threads: ['Trying to protect a regular morning walk; it keeps slipping.', 'Her sister is visiting next month — looking forward to it.'],
  },
];

async function generate(messages: ChatCompletionMessageParam[]): Promise<string> {
  let out = '';
  for await (const token of streamTokens(messages)) out += token;
  return out;
}

async function main() {
  for (const p of PROFILES) {
    const profileContext = renderProfileContext(p);
    const toneInstruction = renderToneInstruction(p.tone);
    const conditionPhrase = renderConditionPhrase(p.careRecipientCondition);
    // Returning profiles get a "a few days ago" gap; first sessions get none.
    const timeContext = renderTimeContext({
      timeZone: 'America/New_York',
      lastSessionAt: p.firstSession ? null : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
    const systemPrompt = buildSystemPrompt(
      p.mode, profileContext, false, p.priorSummary ?? '', toneInstruction, conditionPhrase, timeContext,
    );
    const openerInstruction = p.firstSession ? openerFirst : openerReturning;
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: `${systemPrompt}\n\n${openerInstruction}` },
    ];

    const greeting = await generate(messages);
    console.log('\n' + '='.repeat(80));
    console.log(p.label);
    console.log('  condition: ' + conditionPhrase + (p.tone ? ` | tone: ${p.tone}` : ' | tone: warm only'));
    console.log('-'.repeat(80));
    console.log(greeting.trim());
  }
  console.log('\n' + '='.repeat(80));
}

main().catch(e => { console.error(e); process.exit(1); });
