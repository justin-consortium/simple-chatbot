import mongoose, { Document, Schema } from 'mongoose';

// Account category. Optional: pre-existing dev/test accounts have no role and
// stay valid; only accounts created by seed-accounts.ts set it, which lets
// analysis cleanly filter real participants (`{ role: 'participant' }`) without
// relying on username-prefix matching.
export type UserRole = 'participant' | 'researcher' | 'guest';

export interface IUser extends Document {
  username: string;
  passwordHash: string;
  role?: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['participant', 'researcher', 'guest'],
      required: false,
    },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>('User', userSchema);
