import 'dotenv/config';
import mongoose from 'mongoose';
import Message from '../models/Message';
import Summary from '../models/Summary';

// Read-only audit run before adding session-level mode logging: confirms that
// sessionId is a sound join key across messages and summaries, and measures how
// many sessions Summary alone would miss.
//
// sessionId was added to the Message schema on 2026-06-05 (commit 980f326), so
// messages written before that have no such field — the split below should show
// that cleanly rather than as scattered gaps.
//
// No writes: counts, distinct, read-only aggregation, and sampled finds.

const HAS_ID = { sessionId: { $exists: true, $ne: null } };
const NO_ID = { $or: [{ sessionId: { $exists: false } }, { sessionId: null }] };

async function dateRange(filter: Record<string, unknown>): Promise<string> {
  const first = await Message.findOne(filter).sort({ createdAt: 1 }).select('createdAt').lean();
  const last = await Message.findOne(filter).sort({ createdAt: -1 }).select('createdAt').lean();
  if (!first || !last) return '(none)';
  return `${first.createdAt.toISOString().slice(0, 10)} → ${last.createdAt.toISOString().slice(0, 10)}`;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/chatbot';
  console.log(`Connecting to: ${uri.replace(/\/\/[^@]+@/, '//<credentials>@')}\n`);
  await mongoose.connect(uri);

  const total = await Message.countDocuments({});
  const withId = await Message.countDocuments(HAS_ID);

  console.log('=== messages ===');
  console.log(`total:             ${total}`);
  console.log(`with sessionId:    ${withId}   ${await dateRange(HAS_ID)}`);
  console.log(`without sessionId: ${total - withId}   ${await dateRange(NO_ID)}`);

  // Messages per session. A session of 1 is an opener nobody replied to — the
  // case /api/session/end skips (messages.length < 2), so it never produces a
  // Summary and its mode choice would be lost without a Session row.
  const perSession = await Message.aggregate<{ _id: string; n: number }>([
    { $match: HAS_ID },
    { $group: { _id: '$sessionId', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);

  const counts = perSession.map(s => s.n).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  const singletons = counts.filter(n => n === 1).length;

  console.log('\n=== sessions (grouped by sessionId) ===');
  console.log(`distinct sessions:        ${perSession.length}`);
  console.log(`messages per session:     min ${counts[0] ?? 0} / median ${median} / max ${counts[counts.length - 1] ?? 0}`);
  console.log(`sessions with 1 message:  ${singletons}  <- opener only, never summarized`);

  // The join itself: every summary should point at a sessionId that messages
  // also carry. A nonzero "unmatched" would mean the key is not reliable.
  const messageIds = new Set(perSession.map(s => s._id));
  const summaryIds: string[] = await Summary.distinct('sessionId');
  const unmatched = summaryIds.filter(id => !messageIds.has(id));

  console.log('\n=== summaries ===');
  console.log(`total summaries:                 ${await Summary.countDocuments({})}`);
  console.log(`distinct sessionIds:             ${summaryIds.length}`);
  console.log(`  ...matching a message session: ${summaryIds.length - unmatched.length}`);
  console.log(`  ...unmatched (should be 0):    ${unmatched.length}`);

  // What the new Session collection buys us: sessions that have real messages
  // but no summary, i.e. whose mode choice is currently unrecoverable.
  const summarySet = new Set(summaryIds);
  const noSummary = perSession.filter(s => !summarySet.has(s._id));
  console.log(`\nsessions with messages but NO summary: ${noSummary.length} of ${perSession.length}`);
  console.log('  (their mode selection is exactly what is lost today)');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
