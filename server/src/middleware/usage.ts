import { Request, Response, NextFunction } from 'express';
import { User } from '../models/user';

/**
 * Manually track usage for a successful operation
 * Call this after successful review processing
 */
export const trackUsage = async (req: Request): Promise<void> => {
  if (req.user) {
    await incrementUsage(req.user.githubId);
  }
};

/**
 * Increment usage counters for a user
 */
export const incrementUsage = async (githubId: number): Promise<void> => {
  try {
    const result = await (User as any).checkAndUpdateUsage(githubId);

    if (!result.allowed) {
      console.warn(`Usage limit exceeded for user ${githubId}: monthly=${result.resetMonthly}, daily=${result.resetDaily}`);
    } else {
      console.log(`Usage incremented for user ${githubId}`);
    }
  } catch (error) {
    console.error('Error incrementing usage:', error);
    throw error;
  }
};

/**
 * Check usage limits for a user without incrementing
 */
export const checkUsageLimits = async (githubId: number): Promise<{ allowed: boolean; monthlyCount: number; dailyCount: number; monthlyLimit: number; dailyLimit: number }> => {
  try {
    const user = await User.findOne({ githubId });
    if (!user) {
      return { allowed: false, monthlyCount: 0, dailyCount: 0, monthlyLimit: 10, dailyLimit: 3 };
    }

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const currentDate = now.toDateString();

    const monthlyReset = user.monthlyResetDate.getMonth() !== currentMonth || user.monthlyResetDate.getFullYear() !== currentYear;
    const dailyReset = user.dailyResetDate.toDateString() !== currentDate;

    const monthlyCount = monthlyReset ? 0 : user.monthlyUsageCount;
    const dailyCount = dailyReset ? 0 : user.dailyUsageCount;

    const allowed = monthlyCount < 10 && dailyCount < 3;

    return {
      allowed,
      monthlyCount,
      dailyCount,
      monthlyLimit: 10,
      dailyLimit: 3
    };
  } catch (error) {
    console.error('Error checking usage limits:', error);
    return { allowed: false, monthlyCount: 0, dailyCount: 0, monthlyLimit: 10, dailyLimit: 3 };
  }
};
