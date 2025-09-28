import mongoose, { Schema, Document } from 'mongoose';

export interface IReviewFeedback extends Document {
  repoId: number;
  prNumber: number;
  reviewCommentId: string;
  userAction: 'accepted' | 'ignored' | 'rejected' | 'dismissed';
  userId?: number;
  timestamp: Date;
  commentData: {
    filePath: string;
    line: number;
    severity: 'critical' | 'major' | 'minor';
    message: string;
    rationale: string;
  };
  metadata?: {
    actionContext?: string;
    userFeedback?: string;
    responseTime?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ReviewFeedbackSchema: Schema = new Schema({
  repoId: { type: Number, required: true, index: true },
  prNumber: { type: Number, required: true, index: true },
  reviewCommentId: { type: String, required: true, index: true },
  userAction: {
    type: String,
    enum: ['accepted', 'ignored', 'rejected', 'dismissed'],
    required: true
  },
  userId: { type: Number, index: true },
  timestamp: { type: Date, default: Date.now },
  commentData: {
    filePath: { type: String, required: true },
    line: { type: Number, required: true },
    severity: { type: String, enum: ['critical', 'major', 'minor'], required: true },
    message: { type: String, required: true },
    rationale: { type: String, required: true }
  },
  metadata: {
    actionContext: { type: String },
    userFeedback: { type: String },
    responseTime: { type: Number }
  }
}, { timestamps: true });

ReviewFeedbackSchema.index({ repoId: 1, userAction: 1 });
ReviewFeedbackSchema.index({ repoId: 1, severity: 1, userAction: 1 });
ReviewFeedbackSchema.index({ repoId: 1, prNumber: 1 });
ReviewFeedbackSchema.index({ userId: 1, timestamp: -1 });

ReviewFeedbackSchema.index({
  repoId: 1,
  prNumber: 1,
  reviewCommentId: 1,
  userId: 1
}, { unique: true });

export const ReviewFeedback = mongoose.model<IReviewFeedback>('ReviewFeedback', ReviewFeedbackSchema);

/**
 * Service class for managing review feedback
 */
export class ReviewFeedbackService {
  /**
   * Record user feedback on a review comment
   */
  static async recordFeedback(
    repoId: number,
    prNumber: number,
    reviewCommentId: string,
    userAction: 'accepted' | 'ignored' | 'rejected' | 'dismissed',
    userId?: number,
    commentData?: IReviewFeedback['commentData'],
    metadata?: IReviewFeedback['metadata']
  ): Promise<IReviewFeedback> {
    try {
      const feedback = await ReviewFeedback.findOneAndUpdate(
        {
          repoId,
          prNumber,
          reviewCommentId,
          userId: userId || null
        },
        {
          userAction,
          timestamp: new Date(),
          ...(commentData && { commentData }),
          ...(metadata && { metadata })
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );

      console.log(`📝 Recorded feedback: ${userAction} for comment ${reviewCommentId} in ${repoId}#${prNumber}`);
      return feedback;
    } catch (error) {
      console.error('❌ Failed to record review feedback:', error);
      throw error;
    }
  }

  /**
   * Get feedback statistics for a repository
   */
  static async getRepoFeedbackStats(repoId: number): Promise<{
    totalActions: number;
    actionBreakdown: Record<string, number>;
    severityBreakdown: Record<string, Record<string, number>>;
    averageResponseTime: number;
  }> {
    try {
      const feedbacks = await ReviewFeedback.find({ repoId }).lean();

      const stats = {
        totalActions: feedbacks.length,
        actionBreakdown: {} as Record<string, number>,
        severityBreakdown: {
          critical: {} as Record<string, number>,
          major: {} as Record<string, number>,
          minor: {} as Record<string, number>
        },
        averageResponseTime: 0
      };

      let totalResponseTime = 0;
      let responseTimeCount = 0;

      feedbacks.forEach(feedback => {
        stats.actionBreakdown[feedback.userAction] = (stats.actionBreakdown[feedback.userAction] || 0) + 1;

        if (feedback.commentData?.severity) {
          const severity = feedback.commentData.severity;
          stats.severityBreakdown[severity][feedback.userAction] =
            (stats.severityBreakdown[severity][feedback.userAction] || 0) + 1;
        }

        if (feedback.metadata?.responseTime) {
          totalResponseTime += feedback.metadata.responseTime;
          responseTimeCount++;
        }
      });

      stats.averageResponseTime = responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;

      return stats;
    } catch (error) {
      console.error('❌ Failed to get repo feedback stats:', error);
      throw error;
    }
  }

  /**
   * Get feedback-based thresholds for severity filtering
   */
  static async getAdaptiveThresholds(repoId: number): Promise<{
    ignoreMinorThreshold: number;
    ignoreMajorThreshold: number;
    criticalWeight: number;
  }> {
    try {
      const stats = await this.getRepoFeedbackStats(repoId);

      const thresholds = {
        ignoreMinorThreshold: 0.7,
        ignoreMajorThreshold: 0.3,
        criticalWeight: 1.0
      };

      if (stats.totalActions > 10) {
        const minorIgnored = stats.severityBreakdown.minor?.ignored || 0;
        const minorTotal = Object.values(stats.severityBreakdown.minor || {}).reduce((a, b) => a + b, 0);
        const majorIgnored = stats.severityBreakdown.major?.ignored || 0;
        const majorTotal = Object.values(stats.severityBreakdown.major || {}).reduce((a, b) => a + b, 0);

        if (minorTotal > 0) {
          thresholds.ignoreMinorThreshold = minorIgnored / minorTotal;
        }
        if (majorTotal > 0) {
          thresholds.ignoreMajorThreshold = majorIgnored / majorTotal;
        }

        if (majorTotal > 0) {
          const majorAccepted = stats.severityBreakdown.major?.accepted || 0;
          thresholds.criticalWeight = Math.max(0.8, majorAccepted / majorTotal);
        }
      }

      console.log(`📊 Adaptive thresholds for repo ${repoId}:`, thresholds);
      return thresholds;
    } catch (error) {
      console.error('❌ Failed to calculate adaptive thresholds:', error);
      return {
        ignoreMinorThreshold: 0.7,
        ignoreMajorThreshold: 0.3,
        criticalWeight: 1.0
      };
    }
  }
}
