import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  githubId: number;            
  username: string;            
  installations: mongoose.Types.ObjectId[];
  preferences: {
    reviewMode: 'full' | 'critical-only';
    notifyByEmail: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema({
  githubId: { type: Number, required: true, unique: true },
  username: { type: String, required: true },
  installations: [{ type: Schema.Types.ObjectId, ref: 'Installation' }],
  preferences: {
    reviewMode: { type: String, enum: ['full', 'critical-only'], default: 'full' },
    notifyByEmail: { type: Boolean, default: false },
  },
}, { timestamps: true });

export const User = mongoose.model<IUser>('User', UserSchema);
