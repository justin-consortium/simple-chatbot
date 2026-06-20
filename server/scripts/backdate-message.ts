import 'dotenv/config';
import mongoose from 'mongoose';
import Message from '../models/Message';
import User from '../models/User';

// LOCAL TESTING ONLY. Backdates a user's messages by N days so the next session you
// start in the real app sees an elapsed gap (fakes "it's been a few days / a while").
//
// Uses the native driver because Mongoose makes `createdAt` immutable; the aggregation
// pipeline subtracts N days from each message's createdAt in place.
//
// Usage:
//   npx tsx server/scripts/backdate-message.ts <days> [username]
//   npx tsx server/scripts/backdate-message.ts 5            # all messages back 5 days
//   npx tsx server/scripts/backdate-message.ts 10 maria     # just user "maria"

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const days = Number(process.argv[2]);
  const username = process.argv[3];
  if (!Number.isFinite(days) || days <= 0) {
    console.error('Usage: npx tsx server/scripts/backdate-message.ts <days> [username]');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/chatbot';
  await mongoose.connect(uri);
  console.log('Connected to:', uri.replace(/\/\/[^@]*@/, '//***@'));

  const filter: Record<string, unknown> = {};
  if (username) {
    const user = await User.findOne({ username }).lean();
    if (!user) {
      console.error(`No user with username "${username}"`);
      await mongoose.disconnect();
      process.exit(1);
    }
    filter.userId = user._id;
  }

  const res = await Message.collection.updateMany(filter, [
    { $set: { createdAt: { $subtract: ['$createdAt', days * DAY_MS] } } },
  ]);
  console.log(
    `Backdated ${res.modifiedCount} message(s) by ${days} day(s)` +
      (username ? ` for "${username}".` : ' (all users).')
  );

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
