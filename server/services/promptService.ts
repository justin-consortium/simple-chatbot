import fs from 'fs';
import path from 'path';

const promptsDir = path.join(__dirname, '../prompts');

function load(filename: string): string {
  return fs.readFileSync(path.join(promptsDir, filename), 'utf-8').trim();
}

// Load once at startup
const background = load('background.txt');
const modeModules: Record<string, string> = {
  vent: load('mode_vent.txt'),
  reflect: load('mode_reflect.txt'),
  solve: load('mode_solve.txt'),
  free: load('mode_free.txt'),
  // mode_continue is out of scope for Layer 0 — routes to free
};

const DEBUG_FOOTER = (mode: string) =>
  `\n\n[DEBUG — not for deployment] End your reply with a final line containing exactly: ——— debug: ${mode}`;

export function buildSystemPrompt(
  mode: string,
  profileContext: string = '',
  debug: boolean = false,
): string {
  const resolvedMode = modeModules[mode] ? mode : 'free';
  const modeText = modeModules[resolvedMode];

  let prompt = background
    .replace('{{THIS_CONVERSATION}}', modeText)
    .replace('{{PROFILE_CONTEXT}}', profileContext);

  if (debug) {
    prompt += DEBUG_FOOTER(resolvedMode);
  }

  return prompt;
}
