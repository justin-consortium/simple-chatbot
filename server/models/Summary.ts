import mongoose, { Document, Schema, Types } from 'mongoose';

interface SelfCareCopingEntry {
  approach: string;
  effect: string;
}

interface SummaryContent {
  caregiverState: string;
  whatCameUp: string[];
  selfCareCoping: SelfCareCopingEntry[];
  careSituationUpdates: string;
  interactionNotes: string;
  sessionRecap: string;
}

export interface ISummary extends Document {
  userId: Types.ObjectId;
  sessionId: string;
  summary: SummaryContent;
  createdAt: Date;
  updatedAt: Date;
}

const summarySchema = new Schema<ISummary>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true },
    summary: {
      caregiverState: { type: String, default: '' },
      whatCameUp: [{ type: String }],
      selfCareCoping: [{ approach: { type: String }, effect: { type: String } }],
      careSituationUpdates: { type: String, default: '' },
      interactionNotes: { type: String, default: '' },
      sessionRecap: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

summarySchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<ISummary>('Summary', summarySchema);
