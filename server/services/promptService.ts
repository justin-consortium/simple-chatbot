import fs from 'fs';
import path from 'path';

const promptsDir = path.join(__dirname, '../prompts');

function load(filename: string): string {
  return fs.readFileSync(path.join(promptsDir, filename), 'utf-8').trim();
}

// Load once at startup
const background = load('background.txt');
// The "craft" scaffold is always injected into {{THIS_CONVERSATION}}, regardless
// of the menu selection, so the model always carries the how-to guidance for every
// need (vent/reflect/solve/company). The menu selection only sets the *entry point*
// via {{ENTRY_EMPHASIS}} — it no longer caps the conversation to a single mode.
const craft = load('mode_craft.txt');
const entryEmphasis: Record<string, string> = {
  vent:     load('entry_vent.txt'),
  reflect:  load('entry_reflect.txt'),
  solve:    load('entry_solve.txt'),
  free:     load('entry_free.txt'),
  continue: load('entry_continue.txt'),
};

const DEBUG_FOOTER = (mode: string) =>
  `\n\n[DEBUG — not for deployment] End your reply with a final line containing exactly: ——— debug: ${mode}`;

export function buildSystemPrompt(
  mode: string,
  profileContext: string = '',
  debug: boolean = false,
  priorSummary: string = '',
  toneInstruction: string = '',
  conditionPhrase: string = 'a significant health condition',
  timeContext: string = '',
): string {
  const resolvedMode = entryEmphasis[mode] ? mode : 'free';
  let emphasis = entryEmphasis[resolvedMode];

  if (resolvedMode === 'continue') {
    emphasis = priorSummary
      ? emphasis.replace('{{PRIOR_SUMMARY}}', priorSummary)
      : entryEmphasis['free']; // no summary yet — fall back to free
  }

  // {{THIS_CONVERSATION}} always gets the full craft scaffold; the menu selection
  // only fills the nested {{ENTRY_EMPHASIS}} slot with a "begin here" nudge.
  const conversation = craft.replace('{{ENTRY_EMPHASIS}}', emphasis);

  let prompt = background
    .replace('{{THIS_CONVERSATION}}', conversation)
    .replace('{{PROFILE_CONTEXT}}', profileContext)
    .replace('{{TONE}}', toneInstruction)
    .replace('{{CONDITION}}', conditionPhrase)
    .replace('{{TIME_CONTEXT}}', timeContext);

  if (debug) {
    prompt += DEBUG_FOOTER(resolvedMode);
  }

  return prompt;
}
