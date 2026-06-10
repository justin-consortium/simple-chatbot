import { Router } from 'express';
import type { Request, Response } from 'express';
import Baseline from '../models/Baseline';
import Profile from '../models/Profile';
import { seedProfileFromBaseline } from '../services/profileService';
import auth from '../middleware/auth';

const router = Router();

// Returns the evolving Profile (the rendered source). Used by the client for the
// onboarding existence guard and to display the caregiver's name.
router.get('/', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    const profile = await Profile.findOne({ userId: req.user!.id }).lean();
    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }
    res.json(profile);
  } catch {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Keep in sync with the client companion ids (client/src/config/companions.ts).
const VALID_AVATAR_IDS = ['penguin', 'robot', 'star', 'gem'];

interface ProfileBody {
  displayName?: string;
  avatarId?: string;
  supportStyle?: string[];
  toneModifier?: string;
  recharge?: { categories?: string[]; other?: string };
  caregiverProfile?: {
    relationship?: string;
    caregivingDurationMonths?: number;
    careTypes?: string[];
  };
}

// Onboarding completion. Onboarding runs exactly once: this writes the immutable
// Baseline and seeds the evolving Profile from it, both once. There is no edit
// path — a repeat submission is rejected.
router.post('/', auth, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as ProfileBody;

  if (!body.displayName?.trim()) {
    res.status(400).json({ error: 'displayName is required' });
    return;
  }

  if (!body.avatarId || !VALID_AVATAR_IDS.includes(body.avatarId)) {
    res.status(400).json({ error: 'A valid avatarId is required' });
    return;
  }

  try {
    const existing = await Baseline.findOne({ userId: req.user!.id }).lean();
    if (existing) {
      res.status(409).json({ error: 'Onboarding already completed' });
      return;
    }

    const baseline = await Baseline.create({
      userId: req.user!.id,
      displayName: body.displayName.trim(),
      avatarId: body.avatarId,
      supportStyle: body.supportStyle ?? [],
      toneModifier: body.toneModifier ?? '',
      recharge: {
        categories: body.recharge?.categories ?? [],
        other: body.recharge?.other?.trim() ?? '',
      },
      caregiverProfile: {
        relationship: body.caregiverProfile?.relationship ?? '',
        caregivingDurationMonths: body.caregiverProfile?.caregivingDurationMonths ?? 0,
        careTypes: body.caregiverProfile?.careTypes ?? [],
      },
      onboardingCompletedAt: new Date(),
    });

    const profile = await Profile.create({
      userId: req.user!.id,
      avatarId: baseline.avatarId,
      ...seedProfileFromBaseline(baseline),
    });

    res.status(201).json(profile);
  } catch {
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

export default router;
