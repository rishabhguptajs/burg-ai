import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  githubId: number;
  username: string;
  email?: string;
  avatarUrl?: string;

  githubAccessToken?: string;
  githubRefreshToken?: string;
  tokenExpiresAt?: Date;

  monthlyUsageCount: number;
  monthlyResetDate: Date;
  dailyUsageCount: number;
  dailyResetDate: Date;

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
  email: { type: String },
  avatarUrl: { type: String },

  githubAccessToken: { type: String },
  githubRefreshToken: { type: String },
  tokenExpiresAt: { type: Date },

  monthlyUsageCount: { type: Number, default: 0 },
  monthlyResetDate: { type: Date, default: Date.now },
  dailyUsageCount: { type: Number, default: 0 },
  dailyResetDate: { type: Date, default: Date.now },

  installations: [{ type: Schema.Types.ObjectId, ref: 'Installation' }],
  preferences: {
    reviewMode: { type: String, enum: ['full', 'critical-only'], default: 'full' },
    notifyByEmail: { type: Boolean, default: false },
  },
}, { timestamps: true });

export const USAGE_LIMITS = {
  MONTHLY: 10,
  DAILY: 3
} as const;

UserSchema.statics.checkAndUpdateUsage = async function(githubId: number): Promise<{ allowed: boolean; resetMonthly?: boolean; resetDaily?: boolean }> {
  const user = await this.findOne({ githubId });
  if (!user) return { allowed: false };

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const currentDate = now.toDateString();

  const monthlyReset = user.monthlyResetDate.getMonth() !== currentMonth || user.monthlyResetDate.getFullYear() !== currentYear;
  const dailyReset = user.dailyResetDate.toDateString() !== currentDate;

  if (monthlyReset) {
    user.monthlyUsageCount = 0;
    user.monthlyResetDate = now;
  }
  if (dailyReset) {
    user.dailyUsageCount = 0;
    user.dailyResetDate = now;
  }

  const withinMonthlyLimit = user.monthlyUsageCount < USAGE_LIMITS.MONTHLY;
  const withinDailyLimit = user.dailyUsageCount < USAGE_LIMITS.DAILY;

  if (withinMonthlyLimit && withinDailyLimit) {
    user.monthlyUsageCount += 1;
    user.dailyUsageCount += 1;
    await user.save();
    return { allowed: true, resetMonthly: monthlyReset, resetDaily: dailyReset };
  }

  await user.save();
  return { allowed: false, resetMonthly: monthlyReset, resetDaily: dailyReset };
};

export const User = mongoose.model<IUser>('User', UserSchema);
