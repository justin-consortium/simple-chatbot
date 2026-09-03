import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedProfileFromBaseline, RELATIONSHIP_LABELS } from './profileService';
import type { IBaseline } from '../models/Baseline';

// Deterministic tests for the onboarding -> seed mapping — no API, no DB. Run with:
//   node --import tsx --test server/services/profileService.test.ts

function baseline(over: Partial<IBaseline['caregiverProfile']>): IBaseline {
  return {
    displayName: 'Maria',
    avatarId: 'penguin',
    supportStyle: [],
    toneModifier: '',
    recharge: { categories: [], other: '' },
    careRecipientCondition: 'TBI',
    caregiverProfile: { relationship: '', caregivingDurationMonths: 0, careTypes: [], ...over },
  } as unknown as IBaseline;
}

// The onboarding question is "I am their ___", but the profile line reads
// "Caring for their ___" — so every code must render its own inverse.
const situation = (relationship: string) =>
  seedProfileFromBaseline(baseline({ relationship })).caregivingSituation;

test('relationship renders the inverse of the onboarding answer', () => {
  assert.equal(situation('parent'), 'Caring for their child.');
  assert.equal(situation('child'), 'Caring for their parent.');
  assert.equal(situation('grandparent'), 'Caring for their grandchild.');
  assert.equal(situation('grandchild'), 'Caring for their grandparent.');
});

test('symmetric relations map to themselves', () => {
  assert.equal(situation('spouse_partner'), 'Caring for their spouse or partner.');
  assert.equal(situation('sibling'), 'Caring for their sibling.');
});

test('catch-all codes render a generic noun', () => {
  assert.equal(situation('other_relative'), 'Caring for their relative.');
  assert.equal(situation('friend_neighbor'), 'Caring for their friend or neighbor.');
  assert.equal(situation('other'), 'Caring for their loved one.');
});

// An unmapped code falls through to the raw string, which would put the
// *uninverted* relationship into the system prompt. Every option offered by
// RELATIONSHIP_OPTIONS in client/src/pages/Onboarding.tsx must be listed here.
test('every onboarding option has a label', () => {
  const codes = [
    'spouse_partner', 'parent', 'child', 'sibling',
    'grandparent', 'grandchild', 'other_relative', 'friend_neighbor', 'other',
  ];
  for (const code of codes) {
    assert.ok(RELATIONSHIP_LABELS[code], `${code} is unmapped`);
  }
});

test('no relationship yields no situation line', () => {
  assert.equal(situation(''), '');
});

test('duration and care types are appended when present', () => {
  const profile = seedProfileFromBaseline(baseline({
    relationship: 'parent',
    caregivingDurationMonths: 60,
    careTypes: ['supervision', 'transportation'],
  }));
  assert.equal(
    profile.caregivingSituation,
    'Caring for their child, for 5 years. Their caregiving includes: supervision, transportation.',
  );
});
