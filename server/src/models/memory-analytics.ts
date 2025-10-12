import mongoose, { Schema, Document } from 'mongoose';
import { IMemoryAnalytics } from '../types/mem0Types';

const MemoryAnalyticsSchema: Schema = new Schema({
  repositoryId: { type: String, required: true, index: true },
  period: {
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    type: { type: String, enum: ['daily', 'weekly', 'monthly'], required: true }
  },
  metrics: {
    totalMemories: { type: Number, default: 0 },
    memoriesAdded: { type: Number, default: 0 },
    memoriesRetrieved: { type: Number, default: 0 },
    averageRetrievalTime: { type: Number, default: 0 },
    memoryHitRate: { type: Number, min: 0, max: 1, default: 0 },
    categoryDistribution: {
      naming: { type: Number, default: 0 },
      'error-handling': { type: Number, default: 0 },
      performance: { type: Number, default: 0 },
      security: { type: Number, default: 0 },
      architecture: { type: Number, default: 0 },
      style: { type: Number, default: 0 }
    },
    topPatterns: [{
      pattern: { type: String, required: true },
      category: { type: String, required: true },
      usageCount: { type: Number, default: 0 },
      confidence: { type: Number, min: 0, max: 1, required: true }
    }]
  },
  performance: {
    retrievalSuccessRate: { type: Number, min: 0, max: 1, default: 0 },
    averageRelevanceScore: { type: Number, min: 0, max: 1, default: 0 },
    memoryStorageGrowth: { type: Number, default: 0 },
    apiCallCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 }
  }
}, { timestamps: true });

// Compound indexes for efficient queries
MemoryAnalyticsSchema.index({ repositoryId: 1, 'period.start': 1, 'period.end': 1 });
MemoryAnalyticsSchema.index({ repositoryId: 1, 'period.type': 1, createdAt: -1 });
MemoryAnalyticsSchema.index({ 'period.type': 1, 'period.start': 1 });

/**
 * Service class for managing memory analytics
 */
export class MemoryAnalyticsService {
  /**
   * Create or update memory analytics for a repository and period
   */
  static async upsertAnalytics(
    repositoryId: string,
    periodType: 'daily' | 'weekly' | 'monthly',
    startDate: Date,
    endDate: Date,
    metrics: Partial<IMemoryAnalytics['metrics']>,
    performance: Partial<IMemoryAnalytics['performance']>
  ): Promise<IMemoryAnalytics> {
    try {
      const updateData = {
        metrics: {
          totalMemories: metrics.totalMemories || 0,
          memoriesAdded: metrics.memoriesAdded || 0,
          memoriesRetrieved: metrics.memoriesRetrieved || 0,
          averageRetrievalTime: metrics.averageRetrievalTime || 0,
          memoryHitRate: metrics.memoryHitRate || 0,
          categoryDistribution: {
            naming: metrics.categoryDistribution?.naming || 0,
            'error-handling': metrics.categoryDistribution?.['error-handling'] || 0,
            performance: metrics.categoryDistribution?.performance || 0,
            security: metrics.categoryDistribution?.security || 0,
            architecture: metrics.categoryDistribution?.architecture || 0,
            style: metrics.categoryDistribution?.style || 0
          },
          topPatterns: metrics.topPatterns || []
        },
        performance: {
          retrievalSuccessRate: performance.retrievalSuccessRate || 0,
          averageRelevanceScore: performance.averageRelevanceScore || 0,
          memoryStorageGrowth: performance.memoryStorageGrowth || 0,
          apiCallCount: performance.apiCallCount || 0,
          errorCount: performance.errorCount || 0
        }
      };

      const analytics = await MemoryAnalytics.findOneAndUpdate(
        {
          repositoryId,
          'period.start': startDate,
          'period.end': endDate,
          'period.type': periodType
        },
        updateData,
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );

      console.log(`📊 Updated memory analytics for repository ${repositoryId}`);
      return analytics;
    } catch (error) {
      console.error('❌ Failed to upsert memory analytics:', error);
      throw error;
    }
  }

  /**
   * Get analytics for a repository within a date range
   */
  static async getAnalytics(
    repositoryId: string,
    startDate: Date,
    endDate: Date,
    periodType?: 'daily' | 'weekly' | 'monthly'
  ): Promise<IMemoryAnalytics[]> {
    try {
      const query: any = {
        repositoryId,
        'period.start': { $gte: startDate },
        'period.end': { $lte: endDate }
      };

      if (periodType) {
        query['period.type'] = periodType;
      }

      const analytics = await MemoryAnalytics.find(query)
        .sort({ 'period.start': 1 })
        .lean();

      return analytics;
    } catch (error) {
      console.error('❌ Failed to get memory analytics:', error);
      throw error;
    }
  }

  /**
   * Get aggregated metrics across all repositories
   */
  static async getGlobalAnalytics(
    startDate: Date,
    endDate: Date,
    periodType?: 'daily' | 'weekly' | 'monthly'
  ): Promise<{
    totalRepositories: number;
    totalMemories: number;
    averageHitRate: number;
    totalApiCalls: number;
    totalErrors: number;
  }> {
    try {
      const matchStage: any = {
        'period.start': { $gte: startDate },
        'period.end': { $lte: endDate }
      };

      if (periodType) {
        matchStage['period.type'] = periodType;
      }

      const result = await MemoryAnalytics.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalRepositories: { $addToSet: '$repositoryId' },
            totalMemories: { $sum: '$metrics.totalMemories' },
            totalHitRateSum: { $sum: '$metrics.memoryHitRate' },
            totalApiCalls: { $sum: '$performance.apiCallCount' },
            totalErrors: { $sum: '$performance.errorCount' },
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            totalRepositories: { $size: '$totalRepositories' },
            totalMemories: 1,
            averageHitRate: { $divide: ['$totalHitRateSum', '$count'] },
            totalApiCalls: 1,
            totalErrors: 1
          }
        }
      ]);

      return result[0] || {
        totalRepositories: 0,
        totalMemories: 0,
        averageHitRate: 0,
        totalApiCalls: 0,
        totalErrors: 0
      };
    } catch (error) {
      console.error('❌ Failed to get global memory analytics:', error);
      throw error;
    }
  }

  /**
   * Clean up old analytics data (retention policy)
   */
  static async cleanupOldAnalytics(retentionDays: number = 365): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await MemoryAnalytics.deleteMany({
        createdAt: { $lt: cutoffDate }
      });

      console.log(`🧹 Cleaned up ${result.deletedCount} old memory analytics records`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Failed to cleanup old memory analytics:', error);
      throw error;
    }
  }
}

export const MemoryAnalytics = mongoose.model<IMemoryAnalytics>('MemoryAnalytics', MemoryAnalyticsSchema);
