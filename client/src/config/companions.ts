// The four companion characters the user picks from during onboarding and then
// keeps. Each character has four expressive states mapped to UX moments:
//   waving   → welcome, the moment after selection, the chat opener
//   curious  → onboarding question bubbles, "listening / awaiting your reply",
//              and the busy "preparing" beat while a summary is generating
//   standing → chat header (small), general idle
//   resting  → the sleep / end-of-conversation screen (once summary is ready)
//
// Keep `id`s in sync with VALID_AVATAR_IDS in server/routes/profile.ts.

export type CompanionState = 'standing' | 'curious' | 'waving' | 'resting';

export interface Companion {
  id: string;
  name: string;
}

export const COMPANIONS: Companion[] = [
  { id: 'penguin', name: 'Penguin' },
  { id: 'robot',   name: 'Robot' },
  { id: 'star',    name: 'Star' },
  { id: 'gem',     name: 'Gemstone' },
];

export const DEFAULT_COMPANION_ID = 'penguin';

export function getCompanion(id: string | undefined): Companion {
  return COMPANIONS.find(c => c.id === id) ?? COMPANIONS[0];
}

// Resolves a character + state to its image path:
//   /assets/companions/<id>/<state>.png
//
// The four placeholder files per character are currently identical copies; drop
// in the real per-state art at these same paths to replace them, no code change.
export function companionAvatar(
  id: string | undefined,
  state: CompanionState = 'standing'
): string {
  const companion = getCompanion(id);
  return `/assets/companions/${companion.id}/${state}.png`;
}
