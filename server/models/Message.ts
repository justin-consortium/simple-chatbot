import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IMessage extends Document {
  userId: Types.ObjectId;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
  },
  { timestamps: true }
);

// Supports efficient per-user history queries sorted by time
messageSchema.index({ userId: 1, createdAt: 1 });

export default mongoose.model<IMessage>('Message', messageSchema);
