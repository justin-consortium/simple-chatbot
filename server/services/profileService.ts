interface ProfileData {
  displayName: string;
  supportStyle: string[];
  personaTraits: string[];
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

const SUPPORT_STYLE_LABELS: Record<string, string> = {
  listen:     'be heard and have their feelings validated',
  make_sense: 'make sense of what they\'re feeling',
  reframe:    'see things from another angle',
  figure_out: 'work through what to do',
  inform:     'get information or learn something',
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

  if (profile.supportStyle.length) {
    const styles = labelList(profile.supportStyle, SUPPORT_STYLE_LABELS);
    parts.push(`When something is weighing on them, they most appreciate conversations that help them ${styles}.`);
  }

  if (profile.personaTraits.length) {
    parts.push(`They prefer a companion who is: ${profile.personaTraits.join(', ')}.`);
  }

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
