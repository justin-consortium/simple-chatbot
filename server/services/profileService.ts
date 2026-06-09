interface ProfileData {
  displayName: string;
  supportStyle: string[];
  toneModifier: string;
  recharge: { categories: string[]; other: string };
  caregiverProfile: {
    relationship: string;
    caregivingDurationMonths: number;
    careTypes: string[];
  };
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  spouse_partner: 'spouse or partner',
  parent:         'parent',
  adult_child:    'adult child',
  sibling:        'sibling',
  grandchild:     'grandchild',
  other_relative: 'other relative',
  friend:         'friend',
  other:          'family member',
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

function durationText(months: number): string {
  if (!months) return '';
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'}`;
}

function labelList(codes: string[], map: Record<string, string>): string {
  return codes.map(c => map[c] ?? c).join(', ');
}

export function renderProfileContext(profile: ProfileData): string {
  const parts: string[] = [];
  const c = profile.caregiverProfile;

  const relationship = RELATIONSHIP_LABELS[c.relationship] ?? c.relationship;
  const duration = durationText(c.caregivingDurationMonths);
  const careTypes = c.careTypes.length ? labelList(c.careTypes, CARE_TYPE_LABELS) : '';

  let situationLine = `They are caring for their ${relationship}`;
  if (duration) situationLine += `, and have been doing so for ${duration}`;
  if (careTypes) situationLine += `. Their caregiving includes: ${careTypes}`;
  situationLine += '.';
  parts.push(situationLine);

  const rechargeItems = [
    ...profile.recharge.categories.map((r: string) => RECHARGE_LABELS[r] ?? r),
    ...(profile.recharge.other ? [profile.recharge.other] : []),
  ];
  if (rechargeItems.length) {
    parts.push(`Outside of caregiving, they recharge through: ${rechargeItems.join(', ')}.`);
  }

  if (!parts.length) return '';

  return `# ABOUT THIS CAREGIVER\nTheir name is ${profile.displayName}. ${parts.join(' ')}`;
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: 'A composed lean on the warm baseline. Stay even-keeled and less bubbly; treat them as a capable adult. Keep it personable — never cold or stiff.',
  direct:       'A plain-spoken lean on the warm baseline. Get to the point and go light on hedging; trust them with a straight answer. Don\'t skip past what they\'re feeling — clear, not curt.',
  humorous:     'A light-touch lean on the warm baseline. Bring in gentle humor when the mood allows. Read the moment and ease off when they\'re struggling — never to minimize.',
};

// Rendered into the YOUR MANNER section (the {{TONE}} placeholder), so it reads
// as a directive about how to come across, not a fact about the caregiver.
// Returns '' (no modifier chosen) or a leading-space sentence to append inline.
export function renderToneInstruction(toneModifier: string): string {
  const desc = TONE_INSTRUCTIONS[toneModifier];
  if (!desc) return '';
  return ` They've asked you to adjust how you come across: ${desc}`;
}
