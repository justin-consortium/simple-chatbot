import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IProfile extends Document {
  userId: Types.ObjectId;
  displayName: string;
  supportStyle: string[];
  personaTraits: string[];
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

const profileSchema = new Schema<IProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    displayName: { type: String, required: true },
    supportStyle: [{ type: String }],
    personaTraits: {
      type: [{ type: String }],
      validate: {
        validator: (v: string[]) => v.length <= 3,
        message: 'personaTraits may not exceed 3 selections',
      },
    },
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

profileSchema.index({ userId: 1 }, { unique: true });

export default mongoose.model<IProfile>('Profile', profileSchema);
