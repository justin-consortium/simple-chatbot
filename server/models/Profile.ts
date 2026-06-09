import mongoose, { Document, Schema, Types } from 'mongoose';

export interface CopingEntry {
  approach: string;
  effect: string;
}

// The evolving, living profile — the single source the prompt renders from, and
// the only collection reconcile writes. Seeded once from Baseline at onboarding,
// then rewritten in place by the reconcile process after each session.
//
// `warm` is a render constant (always-on baseline manner), not stored here.
// `supportStyle` and `toneModifier` are intentionally NOT carried over from
// Baseline: supportStyle is record-only, and toneModifier is superseded by the
// living `tone`.
export interface IProfile extends Document {
  userId: Types.ObjectId;
  displayName: string;          // immutable; frozen copy of baseline.displayName
  tone: string;                 // living; seeded from toneModifier, evolves from interactionNotes
  coping: CopingEntry[];        // living; seeded from recharge, evolves from selfCareCoping
  caregivingSituation: string;  // living; seeded from caregiverProfile, evolves from careSituationUpdates
  threads: string[];            // living; most-recent-first, evolves from whatCameUp
  createdAt: Date;
  updatedAt: Date;
}

const profileSchema = new Schema<IProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Frozen at seed time. Enforced immutable as a backstop; reconcile never
    // includes it in its write payload anyway.
    displayName: { type: String, required: true, immutable: true },
    tone: { type: String, default: '' },
    coping: [{ approach: { type: String }, effect: { type: String } }],
    caregivingSituation: { type: String, default: '' },
    threads: [{ type: String }],
  },
  { timestamps: true }
);

profileSchema.index({ userId: 1 }, { unique: true });

export default mongoose.model<IProfile>('Profile', profileSchema);
