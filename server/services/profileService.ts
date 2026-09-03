import type { IBaseline } from '../models/Baseline';
import type { CopingEntry } from '../models/Profile';

// What the render path needs from the evolving Profile. Kept structural (not the
// full Mongoose document) so both lean() reads and documents satisfy it.
interface RenderableProfile {
  displayName: string;
  tone: string;
  coping: CopingEntry[];
  caregivingSituation: string;
  threads: string[];
}

// The fields reconcile/seed write — the mutable subset plus the frozen name.
// careRecipientCondition is seeded once here but never written by reconcile.
export interface SeededProfile {
  displayName: string;
  careRecipientCondition: string;
  tone: string;
  coping: CopingEntry[];
  caregivingSituation: string;
  threads: string[];
}

// The onboarding answer names who the caregiver *is* to the care recipient
// ("I am their child"). seedCaregivingSituation renders "Caring for their ___",
// which needs the *inverse* — who the care recipient is to the caregiver. So a
// caregiver who is the "child" is caring for their parent, and a "grandchild"
// cares for their grandparent. Symmetric relations map to themselves. Each value
// must read grammatically after "Caring for their ".
export const RELATIONSHIP_LABELS: Record<string, string> = {
  spouse_partner:  'spouse or partner',
  parent:          'child',
  child:           'parent',
  sibling:         'sibling',
  grandparent:     'grandchild',
  grandchild:      'grandparent',
  other_relative:  'relative',
  friend_neighbor: 'friend or neighbor',
  other:           'loved one',
};

const CARE_TYPE_LABELS: Record<string, string> = {
  companionship: 'companionship',
  supervision:   'supervision',
  transportation:'transportation',
  homemaking:    'homemaking',
  personal_care: 'personal care',
  healthcare:    'healthcare coordination',
  financial:     'financial management',
  mobility:      'mobility assistance',
};

const RECHARGE_LABELS: Record<string, string> = {
  moving:      'physical movement or exercise',
  outdoors:    'time outdoors or in nature',
  creative:    'creative or hands-on activities',
  learning:    'reading or learning',
  connecting:  'connecting with others',
  rest:        'quiet and rest',
  reflective:  'reflection or spiritual practice',
  watching:    'watching or playing',
};

// Intake tone code -> a short, bare standing preference. The render layer adds
// the directive framing (see renderToneInstruction); reconcile later rewrites
// this free-text from the caregiver's expressed preferences. Empty modifier ->
// empty tone (the always-on warm baseline still applies).
const TONE_SEED: Record<string, string> = {
  direct:       'direct and to the point, going easy on hedging',
  professional: 'composed and even-keeled — warm, but not overly casual',
  humorous:     'open to gentle humor when the moment allows',
};

function durationText(months: number): string {
  if (!months) return '';
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'}`;
}

function labelList(codes: string[], map: Record<string, string>): string {
  return codes.map(c => map[c] ?? c).join(', ');
}

// --- Onboarding -> seed mapping ---------------------------------------------
// Run once at onboarding completion, deriving the evolving Profile from the
// immutable Baseline. The code->label mapping happens here (not at render).

function seedCaregivingSituation(c: IBaseline['caregiverProfile']): string {
  const relationship = RELATIONSHIP_LABELS[c.relationship] ?? c.relationship;
  if (!relationship) return '';
  const duration = durationText(c.caregivingDurationMonths);
  const careTypes = c.careTypes.length ? labelList(c.careTypes, CARE_TYPE_LABELS) : '';

  let line = `Caring for their ${relationship}`;
  if (duration) line += `, for ${duration}`;
  if (careTypes) line += `. Their caregiving includes: ${careTypes}`;
  line += '.';
  return line;
}

function seedCoping(recharge: IBaseline['recharge']): CopingEntry[] {
  const entries: CopingEntry[] = recharge.categories.map(code => ({
    approach: RECHARGE_LABELS[code] ?? code,
    effect: '',
  }));
  if (recharge.other) entries.push({ approach: recharge.other, effect: '' });
  return entries;
}

export function seedProfileFromBaseline(baseline: IBaseline): SeededProfile {
  return {
    displayName: baseline.displayName,
    careRecipientCondition: baseline.careRecipientCondition,
    tone: TONE_SEED[baseline.toneModifier] ?? '',
    coping: seedCoping(baseline.recharge),
    caregivingSituation: seedCaregivingSituation(baseline.caregiverProfile),
    threads: [],
  };
}

// --- Render -----------------------------------------------------------------

function copingText(coping: CopingEntry[]): string {
  return coping
    .filter(c => c.approach)
    .map(c => (c.effect ? `${c.approach} (${c.effect})` : c.approach))
    .join(', ');
}

// Renders the {{PROFILE_CONTEXT}} facts block. Background the companion carries,
// not a script. `tone` is NOT rendered here — it's a manner directive and goes
// into {{TONE}} under YOUR MANNER (see renderToneInstruction).
export function renderProfileContext(profile: RenderableProfile): string {
  const lines: string[] = [];

  if (profile.caregivingSituation) lines.push(`Her situation: ${profile.caregivingSituation}`);

  const coping = copingText(profile.coping ?? []);
  if (coping) lines.push(`What helps her recharge: ${coping}.`);

  const threads = (profile.threads ?? []).filter(Boolean);
  if (threads.length) lines.push(`What's been going on for her: ${threads.join('; ')}.`);

  const intro = `Her name is ${profile.displayName}.`;
  if (!lines.length) {
    // Name alone is still worth carrying.
    return `# ABOUT THIS CAREGIVER\n${intro}`;
  }

  return (
    `# ABOUT THIS CAREGIVER\n${intro} ${lines.join(' ')}\n\n` +
    `Carry this as background — let it shape your warmth and what you understand ` +
    `about her. Don't list it back to her or bring items up unprompted; let her lead.`
  );
}

// Renders the {{TONE}} placeholder appended inline to the YOUR MANNER section,
// so the living tone reads as a directive about how to come across, layered on
// the always-on warm baseline — not a fact about the caregiver. Returns '' when
// there's no standing preference, or a leading-space sentence to append inline.
export function renderToneInstruction(tone: string): string {
  if (!tone) return '';
  return ` They've asked you to adjust how you come across: ${tone}.`;
}

// The care recipient's condition code -> the phrase filling {{CONDITION}} in the
// MISSION line ("…people living with {{CONDITION}}."). The correct article lives
// inside each value (TBI takes "a"; the disease names don't). The default never
// fires for enrolled users — it just guarantees the sentence never breaks for a
// missing or unrecognized code.
const CONDITION_PHRASES: Record<string, string> = {
  TBI:  'a traumatic brain injury (TBI)',
  ADRD: "Alzheimer's disease or a related dementia",
  HD:   'Huntington\'s disease (HD)',
};

export function renderConditionPhrase(condition: string): string {
  return CONDITION_PHRASES[condition] ?? 'a significant health condition';
}
