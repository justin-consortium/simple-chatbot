import mongoose from 'mongoose';
import Summary from '../models/Summary';

// Returns the prior-session recap to inject for a "continue" session, or '' otherwise.
//
// The summary is always scoped by userId, so a user can never read another user's
// summary — even if a forged or stale continuedSummaryId is sent. An id that is
// missing, malformed, or not owned by this user falls back to their latest summary.
export async function getContinueRecap(
  userId: string,
  mode: string | undefined,
  continuedSummaryId?: string,
): Promise<string> {
  if (mode !== 'continue') return '';

  let summary = null;
  if (continuedSummaryId && mongoose.isValidObjectId(continuedSummaryId)) {
    // The exact summary this session was pinned to when it started.
    summary = await Summary.findOne({ _id: continuedSummaryId, userId }).lean();
  }
  if (!summary) {
    // No (valid, owned) pin — fall back to this user's most recent summary.
    summary = await Summary.findOne({ userId }).sort({ createdAt: -1 }).lean();
  }
  return summary?.summary.sessionRecap ?? '';
}
