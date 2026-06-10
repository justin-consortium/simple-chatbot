import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { COMPANIONS, companionAvatar } from '../config/companions';

const TOTAL_STEPS = 5;

const SUPPORT_STYLE_OPTIONS = [
  { code: 'listen',     label: 'Being heard',              description: 'I just need to get it out.' },
  { code: 'make_sense', label: 'Making sense of it',       description: 'Help me understand what\'s going on.' },
  { code: 'reframe',    label: 'Seeing it differently',    description: 'Offer another way to look at it.' },
  { code: 'figure_out', label: 'Figuring out a next step', description: 'Help me decide what to do.' },
  { code: 'inform',     label: 'Getting clear information', description: 'Give me facts or options.' },
];

const TONE_MODIFIER_OPTIONS = [
  { code: 'direct',       label: 'Direct',       description: 'Get to the point in a plain-spoken way.' },
  { code: 'professional', label: 'Professional', description: 'Stays grounded with a steady, formal tone.' },
  { code: 'humorous',     label: 'Humorous',     description: 'A little lightness when the moment fits.' },
];

const RECHARGE_OPTIONS = [
  { code: 'moving',     label: 'Moving my body (walking, exercise, yoga, sports)' },
  { code: 'outdoors',   label: 'Being outdoors / in nature' },
  { code: 'creative',   label: 'Hands-on or creative (gardening, cooking, crafts, art, music, photography)' },
  { code: 'learning',   label: 'Reading or learning (books, history, puzzles)' },
  { code: 'connecting', label: 'Connecting with people (friends, family, faith or community)' },
  { code: 'rest',       label: 'Quiet and rest (tea or coffee, a bath, music, doing nothing)' },
  { code: 'reflective', label: 'Reflective or spiritual (prayer, meditation, journaling)' },
  { code: 'watching',   label: 'Watching or playing (movies, TV, games)' },
];

const RELATIONSHIP_OPTIONS = [
  { code: 'spouse_partner', label: 'Spouse or partner' },
  { code: 'parent',         label: 'Parent' },
  { code: 'adult_child',    label: 'Adult child' },
  { code: 'sibling',        label: 'Sibling' },
  { code: 'grandchild',     label: 'Grandchild' },
  { code: 'other_relative', label: 'Other relative' },
  { code: 'friend',         label: 'Friend' },
  { code: 'other',          label: 'Other' },
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
  2: 'I\'m always warm and caring. What would you like to add?',
  3: 'When something\'s weighing on you, what usually helps most?',
  4: 'Outside of caregiving, what do you enjoy, or what helps you recharge when you get a moment?',
  5: 'A few questions about your caregiving situation so I can be a more relevant companion for you.',
};

interface Answers {
  displayName: string;
  avatarId: string;
  supportStyle: string[];
  toneModifier: string;
  rechargeCategories: string[];
  rechargeOther: string;
  relationship: string;
  caregivingYears: string;
  careTypes: string[];
}

export default function Onboarding() {
  const navigate = useNavigate();
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
    relationship: '',
    caregivingYears: '',
    careTypes: [],
  });

  useEffect(() => {
    api.get('/profile')
      .then(() => navigate('/', { replace: true }))
      .catch(() => {});
  }, [navigate]);

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
                CareCompanion is an AI chatbot here to listen and support you.
              </p>
              <p className="ob-welcome-text">
                Before you begin, you'll choose a companion and answer a few questions so it can support you best.
              </p>
              <button className="btn-primary ob-intro-btn" onClick={() => setIntroStage('avatar')}>
                Let's get started
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
              They'll be here with you each time you visit. Pick the one that feels right.
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
                  <span className="ob-trait-desc">Speak with care and stay here with you.</span>
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
                <p className="ob-q5-label">What is your relationship to the person you care for?</p>
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
                <p className="ob-q5-label">What kind of care do you provide? <span className="hint">(select all that apply)</span></p>
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
                disabled={submitting}
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
