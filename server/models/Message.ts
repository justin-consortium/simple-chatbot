import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IMessage extends Document {
  userId: Types.ObjectId;
  role: 'user' | 'assistant';
  content: string;
  sessionId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    sessionId: { type: String },
  },
  { timestamps: true }
);

messageSchema.index({ userId: 1, createdAt: 1 });
messageSchema.index({ userId: 1, sessionId: 1 });

export default mongoose.model<IMessage>('Message', messageSchema);
