import mongoose, { Document, Schema, Types } from 'mongoose';

// One row per session start, written at /api/session/start — the moment the
// caregiver's choice is actually made. Deliberately separate from Summary:
// Summary only exists for sessions that ran long enough and summarized cleanly
// (see the skip branches in POST /end), so recording the choice there would
// silently drop every session someone opened and left, which is exactly the
// population a mode-selection analysis needs.
//
// Joins to Message and Summary on sessionId. Sessions started before this
// collection shipped simply have no row here.

// Which path produced `mode`. Needed because a brand-new visitor's first
// session starts in 'free' without the menu ever being rendered, so 'free'
// alone can't tell "chose to just chat" from "never saw the menu".
export type SessionEntryPoint = 'menu' | 'auto';

export interface ISession extends Document {
  userId: Types.ObjectId;
  sessionId: string;
  mode: string;
  entryPoint: SessionEntryPoint;
  // Whether "Continue our last conversation" was on screen to be chosen. It is
  // only rendered when a prior summary exists, so the menu is 4 or 5 options
  // depending on the caregiver — this is the denominator for "how often was
  // continue picked when it was actually available".
  menuHadContinue: boolean;
  continuedSummaryId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true },
    mode: { type: String, required: true },
    entryPoint: { type: String, enum: ['menu', 'auto'], required: true },
    menuHadContinue: { type: Boolean, default: false },
    continuedSummaryId: { type: String },
  },
  { timestamps: true }
);

// Upserts key on this pair, so a retried or refreshed start can neither
// duplicate a session nor overwrite the choice originally recorded for it.
sessionSchema.index({ userId: 1, sessionId: 1 }, { unique: true });
sessionSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<ISession>('Session', sessionSchema);
