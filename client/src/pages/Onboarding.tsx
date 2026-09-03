import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { COMPANIONS, companionAvatar } from '../config/companions';

const TOTAL_STEPS = 5;

const SUPPORT_STYLE_OPTIONS = [
  { code: 'listen',     label: 'Being heard',              description: 'Listen to me.' },
  { code: 'make_sense', label: 'Making sense of it',       description: 'Help me understand what\'s going on.' },
  { code: 'reframe',    label: 'Seeing it differently',    description: 'Show me another way to look at it.' },
  { code: 'figure_out', label: 'Figuring out a next step', description: 'Help me decide what to do.' },
  { code: 'inform',     label: 'Getting information and guidance', description: 'Give me facts, options, or resources.' },
];

const TONE_MODIFIER_OPTIONS = [
  { code: 'direct',       label: 'Direct',       description: 'Straight to the point.' },
  { code: 'professional', label: 'Professional', description: 'Clear, thoughtful, and approachable.' },
  { code: 'humorous',     label: 'Humorous',     description: 'Adds a little lightness when the moment fits.' },
];

const RECHARGE_OPTIONS = [
  { code: 'moving',     label: 'Moving my body (walking, working out, playing sports)' },
  { code: 'outdoors',   label: 'Being outdoors / in nature' },
  { code: 'creative',   label: 'Being creative or doing hands-on activities (gardening, cooking, crafts, art, music, photography)' },
  { code: 'learning',   label: 'Reading, learning, or thinking (books, history, puzzles)' },
  { code: 'connecting', label: 'Connecting with people (friends, family, faith or community)' },
  { code: 'rest',       label: 'Relaxation (tea or coffee, a bath, music, doing nothing)' },
  { code: 'reflective', label: 'Reflection or spirituality (prayer, meditation, journaling)' },
  { code: 'watching',   label: 'Screen time (movies, TV, video games, online activities)' },
];

const CARE_RECIPIENT_CONDITION_OPTIONS = [
  { code: 'TBI',  label: 'Traumatic brain injury' },
  { code: 'ADRD', label: 'Alzheimer\'s disease or another form of dementia' },
  { code: 'HD',   label: 'Huntington\'s disease' },
];

// The answer names who the caregiver *is* to the care recipient ("I am their…").
// The server inverts this into who they care for (see RELATIONSHIP_LABELS in
// server/services/profileService.ts) — e.g. "child" -> caring for their parent.
const RELATIONSHIP_OPTIONS = [
  { code: 'spouse_partner',  label: 'Spouse/partner' },
  { code: 'parent',          label: 'Parent (mother/father)' },
  { code: 'child',           label: 'Child (daughter/son)' },
  { code: 'sibling',         label: 'Sibling (brother/sister)' },
  { code: 'grandparent',     label: 'Grandparent (grandmother/grandfather)' },
  { code: 'grandchild',      label: 'Grandchild (grandson/granddaughter)' },
  { code: 'other_relative',  label: 'Other relative (niece, nephew, cousin, in-law, etc.)' },
  { code: 'friend_neighbor', label: 'Friend/neighbor' },
  { code: 'other',           label: 'Other' },
];

const CARE_TYPE_OPTIONS = [
  { code: 'companionship',  label: 'Companionship' },
  { code: 'supervision',    label: 'Supervision' },
  { code: 'transportation', label: 'Transportation' },
  { code: 'homemaking',     label: 'Homemaking' },
  { code: 'personal_care',  label: 'Personal care' },
  { code: 'healthcare',     label: 'Healthcare coordination' },
  { code: 'financial',      label: 'Financial management' },
  { code: 'mobility',       label: 'Mobility assistance' },
];

const STEP_QUESTIONS: Record<number, string> = {
  1: 'What would you like me to call you?',
  2: 'Everyone likes to be supported in different ways.  What kind of support do you like?',
  3: 'When something\'s bothering you, how can I help you?',
  4: 'What do you enjoy, or what helps you recharge?',
  5: 'I also want to understand your caregiver role.',
};

interface Answers {
  displayName: string;
  avatarId: string;
  supportStyle: string[];
  toneModifier: string;
  rechargeCategories: string[];
  rechargeOther: string;
  careRecipientCondition: string;
  relationship: string;
  caregivingYears: string;
  careTypes: string[];
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [introStage, setIntroStage] = useState<'welcome' | 'avatar'>('welcome');
  const [answers, setAnswers] = useState<Answers>({
    displayName: '',
    avatarId: '',
    supportStyle: [],
    toneModifier: '',
    rechargeCategories: [],
    rechargeOther: '',
    careRecipientCondition: '',
    relationship: '',
    caregivingYears: '',
    careTypes: [],
  });

  useEffect(() => {
    api.get('/profile')
      .then(() => navigate('/', { replace: true }))
      .catch(() => {});
  }, [navigate]);

  // Escape hatch from onboarding: a freshly-logged-in user who used the wrong
  // account can drop the session and return to the login screen without being
  // forced through the whole flow. (The browser Back button can't do this — a
  // valid session cookie always redirects away from /login.)
  const handleBackToLogin = async (): Promise<void> => {
    await logout();
    navigate('/login', { replace: true });
  };

  const toggleMulti = (
    field: keyof Pick<Answers, 'supportStyle' | 'rechargeCategories' | 'careTypes'>,
    code: string,
    max?: number
  ) => {
    setAnswers(prev => {
      const current = prev[field];
      if (current.includes(code)) {
        return { ...prev, [field]: current.filter(c => c !== code) };
      }
      if (max !== undefined && current.length >= max) return prev;
      return { ...prev, [field]: [...current, code] };
    });
  };

  const toggleToneModifier = (code: string) => {
    setAnswers(prev => ({ ...prev, toneModifier: prev.toneModifier === code ? '' : code }));
  };

  const canAdvance = (): boolean => {
    if (step === 1) return answers.displayName.trim().length > 0;
    if (step === 3) return answers.supportStyle.length > 0;
    return true;
  };

  const handleSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError('');
    try {
      const years = parseInt(answers.caregivingYears || '0', 10);
      await api.post('/profile', {
        displayName: answers.displayName.trim(),
        avatarId: answers.avatarId,
        supportStyle: answers.supportStyle,
        toneModifier: answers.toneModifier,
        recharge: {
          categories: answers.rechargeCategories,
          other: answers.rechargeOther.trim(),
        },
        careRecipientCondition: answers.careRecipientCondition,
        caregiverProfile: {
          relationship: answers.relationship,
          caregivingDurationMonths: years * 12,
          careTypes: answers.careTypes,
        },
      });
      navigate('/', { replace: true });
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  // ── Intro: welcome, then companion picker (step 0) ───────────────────────
  if (step === 0) {
    if (introStage === 'welcome') {
      return (
        <div className="onboarding-container onboarding-container--centered">
          <div className="onboarding-card">
            <div className="ob-body ob-intro">
              <h1 className="ob-welcome-title">Welcome to CareCompanion</h1>
              <p className="ob-welcome-text">
                CareCompanion is here to listen and support you.
              </p>
              <p className="ob-welcome-text">
                Before you begin, you'll choose a companion and answer a few questions so it can support you best.
              </p>
              <button className="btn-primary ob-intro-btn" onClick={() => setIntroStage('avatar')}>
                Let's get started
              </button>
              <button
                type="button"
                className="ob-back-to-login"
                onClick={() => void handleBackToLogin()}
              >
                Back to login
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="onboarding-container">
        <div className="onboarding-card">
          <div className="ob-body ob-pick">
            <h2 className="ob-pick-title">Choose your companion</h2>
            <p className="ob-pick-subtitle">
              They'll be here each time you visit. Pick the one that feels right.
            </p>
            <div className="ob-companion-grid">
              {COMPANIONS.map(c => {
                const selected = answers.avatarId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`ob-companion-card${selected ? ' selected' : ''}`}
                    onClick={() => setAnswers(prev => ({ ...prev, avatarId: c.id }))}
                    aria-pressed={selected}
                  >
                    <img
                      src={companionAvatar(c.id, selected ? 'waving' : 'standing')}
                      alt={c.name}
                      className="ob-companion-img"
                    />
                  </button>
                );
              })}
            </div>
            <div className="ob-nav">
              <button className="ob-btn-back" onClick={() => setIntroStage('welcome')}>
                Back
              </button>
              <button
                className="btn-primary ob-btn-next"
                onClick={() => setStep(1)}
                disabled={!answers.avatarId}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Question steps (1–5) ─────────────────────────────────────────────────
  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <div className="ob-progress-track">
          <div className="ob-progress-fill" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
        </div>

        <div className="ob-body">
          <div className="ob-bubble-row">
            <div className="ob-bubble-agent">
              <img src={companionAvatar(answers.avatarId, 'curious')} alt="Companion" className="ob-bubble-avatar" />
            </div>
            <div className="ob-speech-bubble">{STEP_QUESTIONS[step]}</div>
          </div>

          {step === 1 && (
            <div className="form-group">
              <input
                type="text"
                value={answers.displayName}
                onChange={e => setAnswers(prev => ({ ...prev, displayName: e.target.value }))}
                placeholder="Your name or nickname"
                autoFocus
              />
            </div>
          )}

          {step === 2 && (
            <>
              <p className="ob-hint">Pick one more, or none.</p>
              <div className="ob-option-list">
                <div className="ob-trait-chip ob-trait-locked">
                  <div className="ob-trait-chip-header">
                    <span className="ob-trait-label">
                      <span className="ob-lock-icon">🔒</span> Warm
                    </span>
                    <span className="ob-locked-badge">always on</span>
                  </div>
                  <span className="ob-trait-desc">Speak with care.</span>
                </div>
                {TONE_MODIFIER_OPTIONS.map(opt => {
                  const selected = answers.toneModifier === opt.code;
                  return (
                    <button
                      key={opt.code}
                      className={`ob-trait-chip${selected ? ' selected' : ''}`}
                      onClick={() => toggleToneModifier(opt.code)}
                    >
                      <span className="ob-trait-label">{opt.label}</span>
                      <span className="ob-trait-desc">{opt.description}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 3 && (
            <div className="ob-option-list">
              {SUPPORT_STYLE_OPTIONS.map(opt => (
                <button
                  key={opt.code}
                  className={`ob-trait-chip${answers.supportStyle.includes(opt.code) ? ' selected' : ''}`}
                  onClick={() => toggleMulti('supportStyle', opt.code)}
                >
                  <span className="ob-trait-label">{opt.label}</span>
                  <span className="ob-trait-desc">{opt.description}</span>
                </button>
              ))}
            </div>
          )}

          {step === 4 && (
            <>
              <div className="ob-option-list">
                {RECHARGE_OPTIONS.map(opt => (
                  <button
                    key={opt.code}
                    className={`ob-option-chip${answers.rechargeCategories.includes(opt.code) ? ' selected' : ''}`}
                    onClick={() => toggleMulti('rechargeCategories', opt.code)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="form-group ob-other-input">
                <label>Anything else?</label>
                <input
                  type="text"
                  value={answers.rechargeOther}
                  onChange={e => setAnswers(prev => ({ ...prev, rechargeOther: e.target.value }))}
                  placeholder="Other things you enjoy…"
                />
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <div className="ob-q5-section">
                <p className="ob-q5-label">What condition does the person you care for live with?</p>
                <div className="ob-option-list">
                  {CARE_RECIPIENT_CONDITION_OPTIONS.map(opt => (
                    <button
                      key={opt.code}
                      className={`ob-option-chip${answers.careRecipientCondition === opt.code ? ' selected' : ''}`}
                      onClick={() => setAnswers(prev => ({ ...prev, careRecipientCondition: opt.code }))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ob-q5-section">
                <p className="ob-q5-label">How are you related to the person you care for? I am their:</p>
                <div className="ob-option-list">
                  {RELATIONSHIP_OPTIONS.map(opt => (
                    <button
                      key={opt.code}
                      className={`ob-option-chip${answers.relationship === opt.code ? ' selected' : ''}`}
                      onClick={() => setAnswers(prev => ({ ...prev, relationship: opt.code }))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ob-q5-section">
                <p className="ob-q5-label">How long have you been in a caregiving role?</p>
                <div className="form-group ob-years-input">
                  <label>Years</label>
                  <input
                    type="number"
                    min="0"
                    value={answers.caregivingYears}
                    onChange={e => setAnswers(prev => ({ ...prev, caregivingYears: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="ob-q5-section">
                <p className="ob-q5-label">What kind(s) of care do you provide? <span className="hint">(select all that apply)</span></p>
                <div className="ob-option-list">
                  {CARE_TYPE_OPTIONS.map(opt => (
                    <button
                      key={opt.code}
                      className={`ob-option-chip${answers.careTypes.includes(opt.code) ? ' selected' : ''}`}
                      onClick={() => toggleMulti('careTypes', opt.code)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {error && <div className="error-message ob-error">{error}</div>}

          <div className="ob-nav">
            <button className="ob-btn-back" onClick={() => setStep(s => s - 1)}>
              Back
            </button>
            {step < TOTAL_STEPS ? (
              <button
                className="btn-primary ob-btn-next"
                onClick={() => setStep(s => s + 1)}
                disabled={!canAdvance()}
              >
                Next
              </button>
            ) : (
              <button
                className="btn-primary ob-btn-next"
                onClick={() => void handleSubmit()}
                disabled={submitting || !answers.careRecipientCondition}
              >
                {submitting ? 'Saving…' : 'Get started'}
              </button>
            )}
          </div>

          <p className="ob-step-indicator">{step} of {TOTAL_STEPS}</p>
        </div>
      </div>
    </div>
  );
}
