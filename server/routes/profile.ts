import { Router } from 'express';
import type { Request, Response } from 'express';
import Profile from '../models/Profile';
import auth from '../middleware/auth';

const router = Router();

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

interface ProfileBody {
  displayName?: string;
  supportStyle?: string[];
  toneModifier?: string;
  recharge?: { categories?: string[]; other?: string };
  caregiverProfile?: {
    relationship?: string;
    caregivingDurationMonths?: number;
    careTypes?: string[];
  };
}

router.post('/', auth, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as ProfileBody;

  if (!body.displayName?.trim()) {
    res.status(400).json({ error: 'displayName is required' });
    return;
  }

  try {
    const profile = await Profile.findOneAndUpdate(
      { userId: req.user!.id },
      {
        $set: {
          displayName: body.displayName.trim(),
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
        },
      },
      { upsert: true, new: true }
    );
    res.status(200).json(profile);
  } catch {
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

router.delete('/', auth, async (req: Request, res: Response): Promise<void> => {
  try {
    await Profile.deleteOne({ userId: req.user!.id });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

export default router;
