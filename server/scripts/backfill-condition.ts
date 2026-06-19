import 'dotenv/config';
import mongoose from 'mongoose';
import Profile from '../models/Profile';
import Baseline from '../models/Baseline';

// One-time backfill: every caregiver enrolled before the care-recipient-condition
// feature was a TBI caregiver (the prompt hardcoded TBI), so set careRecipientCondition
// to 'TBI' on any Profile/Baseline that doesn't already have it.
//
// Uses the native collection (not Mongoose updateMany) on purpose: Profile's
// careRecipientCondition is `immutable: true`, and Mongoose strips immutable fields
// from query-based updates. The native driver bypasses that — correct for a migration.

const NEEDS_BACKFILL = {
  $or: [
    { careRecipientCondition: { $exists: false } },
    { careRecipientCondition: null },
    { careRecipientCondition: '' },
  ],
};

async function main() {
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/chatbot';
  await mongoose.connect(uri);
  // Redact credentials when echoing which DB we hit.
  console.log('Connected to:', uri.replace(/\/\/[^@]*@/, '//***@'));

  for (const Model of [Profile, Baseline] as const) {
    const coll = Model.collection;
    const before = await coll.countDocuments(NEEDS_BACKFILL);
    const total = await coll.countDocuments({});
    const res = await coll.updateMany(NEEDS_BACKFILL, { $set: { careRecipientCondition: 'TBI' } });
    console.log(
      `${coll.collectionName}: ${total} total, ${before} needed backfill, ${res.modifiedCount} set to 'TBI'`
    );
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
