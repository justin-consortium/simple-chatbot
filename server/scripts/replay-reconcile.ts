import 'dotenv/config';
import mongoose from 'mongoose';
import Baseline from '../models/Baseline';
import Profile from '../models/Profile';
import Summary from '../models/Summary';
import { seedProfileFromBaseline } from '../services/profileService';
import { reconcileProfile } from '../services/reconcileService';

// Replays a caregiver's session summaries through reconcile in chronological
// order, starting from a fresh seed — simulating what would have happened if
// reconcile had run after each session. For testing the reconcile prompt.

async function main() {
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/chatbot');

  const profile = await Profile.findOne().sort({ updatedAt: -1 });
  if (!profile) { console.log('no profile'); return; }
  const userId = profile.userId.toString();
  console.log('USER:', userId, 'displayName:', profile.displayName);

  // 1. Reset the living profile to its seeded (post-onboarding) state.
  const baseline = await Baseline.findOne({ userId: profile.userId });
  if (!baseline) { console.log('no baseline'); return; }
  const seed = seedProfileFromBaseline(baseline);
  profile.tone = seed.tone;
  profile.coping = seed.coping;
  profile.caregivingSituation = seed.caregivingSituation;
  profile.threads = seed.threads;
  await profile.save();
  console.log('\n=== RESET TO SEED ===');
  console.log('threads:', JSON.stringify(profile.threads));
  console.log('coping:', JSON.stringify(profile.coping.map(c => c.approach)));

  // 2. Replay each summary, oldest first.
  const summaries = await Summary.find({ userId: profile.userId }).sort({ createdAt: 1 }).lean();
  console.log(`\n=== REPLAYING ${summaries.length} SUMMARIES (oldest first) ===`);
  for (let i = 0; i < summaries.length; i++) {
    await reconcileProfile(userId, summaries[i].summary);
    const p = await Profile.findOne({ userId }).lean();
    console.log(`\n--- after summary ${i + 1} ---`);
    console.log('tone:', p!.tone);
    console.log('caregivingSituation:', p!.caregivingSituation);
    console.log('coping:', JSON.stringify(p!.coping.map(c => ({ a: c.approach, e: c.effect })), null, 2));
    console.log('threads:', JSON.stringify(p!.threads, null, 2));
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
