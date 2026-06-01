import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { AGENT_NAME, AGENT_IMAGE } from '../config/agent';

const TOTAL_STEPS = 5;

const SUPPORT_STYLE_OPTIONS = [
  { code: 'listen',     label: 'Hear me out and sit with me in it' },
  { code: 'make_sense', label: 'Help me make sense of what I\'m feeling' },
  { code: 'reframe',    label: 'Help me see it from another angle' },
  { code: 'figure_out', label: 'Help me figure out what to do' },
  { code: 'inform',     label: 'Give me information or teach me something' },
];

const PERSONA_TRAIT_OPTIONS = [
  { code: 'warm',        label: 'Warm',        description: 'Speak with care and let you know I\'m here with you.' },
  { code: 'genuine',     label: 'Genuine',     description: 'No clichés or canned empathic phrases.' },
  { code: 'calm',        label: 'Calm',        description: 'Keep a steady, even tone, especially when things feel heavy.' },
  { code: 'direct',      label: 'Direct',      description: 'Get to the point in a plain-spoken way.' },
  { code: 'encouraging', label: 'Encouraging', description: 'Notice what you\'re doing well and look for hopeful signs.' },
  { code: 'humorous',    label: 'Humorous',    description: 'A little lightness when the moment fits.' },
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
  2: 'How should I support you? When something\'s weighing on you, what usually helps most?',
  3: 'How would you like me to come across?',
  4: 'Outside of caregiving, what do you enjoy, or what helps you recharge when you get a moment?',
  5: 'A few questions about your caregiving situation so I can be a more relevant companion for you.',
};

interface Answers {
  displayName: string;
  supportStyle: string[];
  personaTraits: string[];
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
  const [answers, setAnswers] = useState<Answers>({
    displayName: '',
    supportStyle: [],
    personaTraits: [],
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
    field: keyof Pick<Answers, 'supportStyle' | 'personaTraits' | 'rechargeCategories' | 'careTypes'>,
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

  const canAdvance = (): boolean => {
    if (step === 1) return answers.displayName.trim().length > 0;
    if (step === 2) return answers.supportStyle.length > 0;
    return true;
  };

  const handleSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError('');
    try {
      const years = parseInt(answers.caregivingYears || '0', 10);
      await api.post('/profile', {
        displayName: answers.displayName.trim(),
        supportStyle: answers.supportStyle,
        personaTraits: answers.personaTraits,
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

  // ── Intro page (step 0) ──────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div className="onboarding-container">
        <div className="onboarding-card">
          <div className="ob-body ob-intro">
            <img src={AGENT_IMAGE} alt={AGENT_NAME} className="ob-intro-image" />
            <span className="ob-agent-name">{AGENT_NAME}</span>
            <p className="ob-greeting">
              Hi, I'm {AGENT_NAME}. I'm here to listen and support you.
              <br />
              Before we start, I'd love to learn a little about how I can show up for you.
            </p>
            <button className="btn-primary ob-intro-btn" onClick={() => setStep(1)}>
              Let's get started
            </button>
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
              <img src={AGENT_IMAGE} alt={AGENT_NAME} className="ob-bubble-avatar" />
              <span className="ob-bubble-name">{AGENT_NAME}</span>
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
            <div className="ob-option-list">
              {SUPPORT_STYLE_OPTIONS.map(opt => (
                <button
                  key={opt.code}
                  className={`ob-option-chip${answers.supportStyle.includes(opt.code) ? ' selected' : ''}`}
                  onClick={() => toggleMulti('supportStyle', opt.code)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <>
              <p className="ob-hint">Pick up to 3.</p>
              <div className="ob-option-list">
                {PERSONA_TRAIT_OPTIONS.map(opt => {
                  const selected = answers.personaTraits.includes(opt.code);
                  const disabled = !selected && answers.personaTraits.length >= 3;
                  return (
                    <button
                      key={opt.code}
                      className={`ob-trait-chip${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                      onClick={() => toggleMulti('personaTraits', opt.code, 3)}
                      disabled={disabled}
                    >
                      <span className="ob-trait-label">{opt.label}</span>
                      <span className="ob-trait-desc">{opt.description}</span>
                    </button>
                  );
                })}
              </div>
            </>
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
