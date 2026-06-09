import mongoose, { Document, Schema, Types } from 'mongoose';

// Immutable intake record, written once when onboarding completes and never
// updated. Kept for analysis / IRB retention and as the seed source for the
// evolving Profile. Never read or written at runtime — the prompt renders from
// Profile only.
export interface IBaseline extends Document {
  userId: Types.ObjectId;
  displayName: string;
  supportStyle: string[];
  toneModifier: string;
  recharge: {
    categories: string[];
    other: string;
  };
  caregiverProfile: {
    relationship: string;
    caregivingDurationMonths: number;
    careTypes: string[];
  };
  onboardingCompletedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const baselineSchema = new Schema<IBaseline>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    displayName: { type: String, required: true },
    supportStyle: [{ type: String }],
    toneModifier: { type: String, default: '' },
    recharge: {
      categories: [{ type: String }],
      other: { type: String, default: '' },
    },
    caregiverProfile: {
      relationship: { type: String, default: '' },
      caregivingDurationMonths: { type: Number, default: 0 },
      careTypes: [{ type: String }],
    },
    onboardingCompletedAt: { type: Date },
  },
  { timestamps: true }
);

baselineSchema.index({ userId: 1 }, { unique: true });

export default mongoose.model<IBaseline>('Baseline', baselineSchema);
