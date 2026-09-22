import 'dotenv/config';
import mongoose from 'mongoose';
import Session from '../models/Session';
import Message from '../models/Message';
import Summary from '../models/Summary';

// Read-only: prints the most recent rows the session-start logging wrote, with
// the message count and summary presence for the same sessionId, so a session
// started by hand can be checked end to end.
//
// No writes: find, countDocuments, exists.

// Which of the cases the logging is meant to distinguish have actually been
// exercised. Each menu button, plus the two cases a plain `mode` value cannot
// tell apart on its own: a first-ever session that never showed the menu, and a
// menu rendered without the "continue" option.
const CASES: { label: string; filter: Record<string, unknown> }[] = [
  { label: '"Continue our last conversation"', filter: { mode: 'continue', entryPoint: 'menu' } },
  { label: '"Get my feelings out"',            filter: { mode: 'vent',     entryPoint: 'menu' } },
  { label: '"Make sense of something"',        filter: { mode: 'reflect',  entryPoint: 'menu' } },
  { label: '"Figure out what to do"',          filter: { mode: 'solve',    entryPoint: 'menu' } },
  { label: '"I don\'t know — just chat"',      filter: { mode: 'free',     entryPoint: 'menu' } },
  { label: 'first session, menu never shown',  filter: { entryPoint: 'auto' } },
  { label: 'menu without continue offered',    filter: { entryPoint: 'menu', menuHadContinue: false } },
];

async function reportCoverage(): Promise<void> {
  console.log('=== case coverage ===');
  let untested = 0;
  for (const c of CASES) {
    const n = await Session.countDocuments(c.filter);
    if (n === 0) untested++;
    console.log(`  ${n > 0 ? '✓' : '·'}  ${c.label.padEnd(34)} ${n}`);
  }
  console.log(untested === 0 ? '\nAll cases exercised.' : `\n${untested} case(s) not yet exercised.`);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/chatbot';
  console.log(`Connecting to: ${uri.replace(/\/\/[^@]+@/, '//<credentials>@')}\n`);
  await mongoose.connect(uri);

  const rows = await Session.find({}).sort({ createdAt: -1 }).limit(5).lean();

  if (rows.length === 0) {
    console.log('No Session rows yet.');
    await mongoose.disconnect();
    return;
  }

  console.log(`${await Session.countDocuments({})} session row(s) total; newest first:\n`);

  for (const r of rows) {
    const messages = await Message.countDocuments({ userId: r.userId, sessionId: r.sessionId });
    const summarized = await Summary.exists({ userId: r.userId, sessionId: r.sessionId });
    console.log(`  ${r.createdAt.toISOString()}`);
    console.log(`    sessionId:        ${r.sessionId}`);
    console.log(`    mode:             ${r.mode}`);
    console.log(`    entryPoint:       ${r.entryPoint}`);
    console.log(`    menuHadContinue:  ${r.menuHadContinue}`);
    console.log(`    continuedSummary: ${r.continuedSummaryId ?? '(none)'}`);
    console.log(`    -> messages joined on sessionId: ${messages}`);
    console.log(`    -> has summary:                  ${summarized ? 'yes' : 'no'}`);
    console.log('');
  }

  await reportCoverage();

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
