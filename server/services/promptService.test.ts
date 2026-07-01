import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './promptService';

// Deterministic tests for prompt assembly — no API, no DB. Run with:
//   node --import tsx --test server/services/promptService.test.ts
//
// These lock in the "craft always-on + entry emphasis" design:
//  - #4  no placeholder ever survives assembly, for any mode
//  - core invariant: the full multi-need craft scaffold is present for EVERY mode,
//    so a mid-conversation drift always has the right guidance available
//  - entry emphasis matches the menu selection
//  - #5  continue edge cases (summary injected / no-summary fallback / unknown mode)

const MODES = ['vent', 'reflect', 'solve', 'free', 'continue'];

// Distinctive phrases unique to the always-on craft scaffold (mode_craft.txt),
// one per "need". Deliberately NOT the short entry-emphasis wording, so a match
// proves the full scaffold — not just the entry blurb — is present.
const SCAFFOLD_MARKERS = {
  company: 'being someone they can talk to is itself the support',
  vent:    'being heard *is* the help',
  reflect: 'drawing out the link between what happened',
  solve:   'draw out *their* own ideas before adding yours',
};

// Exact entry-emphasis fragments (entry_*.txt).
const ENTRY_FRAGMENT: Record<string, string> = {
  vent:    'wanting to vent, so begin there',
  reflect: 'wanting to make sense of an experience, so begin there',
  solve:   'wanting to work through a problem, so begin there',
  free:    "hasn't named a specific need",
};

// A build with everything populated, to be sure real values don't reintroduce braces.
function fullBuild(mode: string, priorSummary = '') {
  return buildSystemPrompt(
    mode,
    'PROFILE: caring for a spouse with dementia.',   // profileContext
    false,                                           // debug
    priorSummary,
    ' Keep it direct.',                              // toneInstruction
    'dementia',                                      // conditionPhrase
    'Current local time: Monday.',                   // timeContext
  );
}

// ---- #4: no placeholder survives assembly, for any mode -------------------
test('#4 no {{PLACEHOLDER}} survives assembly, for every mode', () => {
  for (const mode of [...MODES, 'bogus-unknown-mode']) {
    const withSummary = fullBuild(mode, 'We talked about her appointment.');
    const withoutSummary = fullBuild(mode, '');
    for (const out of [withSummary, withoutSummary]) {
      assert.equal(/\{\{/.test(out), false, `leftover {{ in mode=${mode}: ${out.match(/\{\{[^}]*\}\}/)?.[0]}`);
      assert.equal(/\}\}/.test(out), false, `leftover }} in mode=${mode}`);
    }
  }
});

// ---- core invariant: full craft scaffold present for EVERY mode -----------
test('core invariant: every mode carries the full multi-need craft scaffold', () => {
  for (const mode of MODES) {
    const out = fullBuild(mode, 'Prior recap for continue.');
    for (const [need, marker] of Object.entries(SCAFFOLD_MARKERS)) {
      assert.ok(out.includes(marker), `mode=${mode} is missing the "${need}" scaffold guidance`);
    }
  }
});

// ---- entry emphasis matches the menu selection ---------------------------
test('entry emphasis matches the selected mode', () => {
  for (const mode of ['vent', 'reflect', 'solve', 'free']) {
    const out = fullBuild(mode);
    assert.ok(out.includes(ENTRY_FRAGMENT[mode]), `mode=${mode} missing its entry emphasis`);
    // and no OTHER mode's entry emphasis leaked in
    for (const other of ['vent', 'reflect', 'solve']) {
      if (other !== mode) {
        assert.equal(out.includes(ENTRY_FRAGMENT[other]), false, `mode=${mode} wrongly contains ${other} entry`);
      }
    }
  }
});

// ---- #5: continue with a summary -----------------------------------------
test('#5 continue injects the prior summary and strips the placeholder', () => {
  const RECAP = 'UNIQUE_RECAP_TOKEN_42 — last time she was worn down after appointments.';
  const out = fullBuild('continue', RECAP);
  assert.ok(out.includes(RECAP), 'prior summary not injected');
  assert.ok(out.includes('continues an earlier conversation'), 'continue framing missing');
  assert.equal(out.includes('PRIOR_SUMMARY'), false, 'PRIOR_SUMMARY token leaked');
  // continue was chosen, so the free-entry fallback text must NOT appear
  assert.equal(out.includes(ENTRY_FRAGMENT.free), false, 'unexpectedly fell back to free');
});

// ---- #5: continue with NO summary falls back to free entry ---------------
test('#5 continue with no summary falls back to the free entry cleanly', () => {
  const out = fullBuild('continue', '');
  assert.ok(out.includes(ENTRY_FRAGMENT.free), 'did not fall back to free entry');
  assert.equal(out.includes('continues an earlier conversation'), false, 'left a dangling continue frame with no recap');
  assert.equal(/\{\{/.test(out), false, 'leftover placeholder after fallback');
});

// ---- unknown mode falls back to free -------------------------------------
test('unknown mode falls back to the free entry', () => {
  const out = fullBuild('totally-made-up');
  assert.ok(out.includes(ENTRY_FRAGMENT.free), 'unknown mode did not fall back to free');
});

// ---- #6 (deterministic half): safety overrides survive assembly ----------
// The gateway content-filter path (hardcoded CRISIS_MESSAGE in chat.ts) is
// mode-independent. What the prompt change COULD regress is the model-level
// SAFETY OVERRIDES section — so assert it is intact in every assembled prompt.
test('#6 safety overrides are present in every assembled mode', () => {
  for (const mode of [...MODES, 'bogus']) {
    const out = fullBuild(mode, 'A prior recap.');
    for (const token of ['988', '741741', '911', 'self-harm', 'SAFETY OVERRIDES']) {
      assert.ok(out.includes(token), `mode=${mode} lost safety token "${token}"`);
    }
  }
});

// ---- debug footer reflects the resolved mode -----------------------------
test('debug footer appends the resolved mode', () => {
  const bogus = buildSystemPrompt('nope', '', true);
  assert.match(bogus, /debug: free$/, 'unknown mode should resolve to free in the footer');
  const solve = buildSystemPrompt('solve', '', true);
  assert.match(solve, /debug: solve$/);
  // continue-without-summary keeps resolvedMode=continue even though it renders free text
  const cont = buildSystemPrompt('continue', '', true, '');
  assert.match(cont, /debug: continue$/);
});
