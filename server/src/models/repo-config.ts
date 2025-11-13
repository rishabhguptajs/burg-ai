import mongoose, { Schema, Document } from 'mongoose';

export interface IRepoConfig extends Document {
  repoId: number;
  repoFullName: string;
  owner: string;

  enabledSeverities: ('critical' | 'major' | 'minor')[];
  adaptiveThresholds: boolean;

  manualThresholds: {
    ignoreMinorThreshold: number;
    ignoreMajorThreshold: number;
    maxCommentsPerReview: number;
  };

  reviewSettings: {
    postInlineComments: boolean;
    postSummaryComment: boolean;
    requireApprovalForCritical: boolean;
    groupSimilarComments: boolean;
    includeSuggestions: boolean;
  };

  aiSettings: {
    model: string;
    temperature: number;
    maxTokens: number;
    customPrompts?: {
      systemPrompt?: string;
      reviewGuidelines?: string[];
    };
  };

  createdAt: Date;
  updatedAt: Date;
}

const RepoConfigSchema: Schema = new Schema({
  repoId: { type: Number, required: true, unique: true, index: true },
  repoFullName: { type: String, required: true, unique: true },
  owner: { type: String, required: true, index: true },

  enabledSeverities: {
    type: [{ type: String, enum: ['critical', 'major', 'minor'] }],
    default: ['critical', 'major', 'minor']
  },
  adaptiveThresholds: { type: Boolean, default: true },

  manualThresholds: {
    ignoreMinorThreshold: { type: Number, min: 0, max: 1, default: 0.7 },
    ignoreMajorThreshold: { type: Number, min: 0, max: 1, default: 0.3 },
    maxCommentsPerReview: { type: Number, min: 1, max: 50, default: 20 }
  },

  reviewSettings: {
    postInlineComments: { type: Boolean, default: true },
    postSummaryComment: { type: Boolean, default: true },
    requireApprovalForCritical: { type: Boolean, default: true },
    groupSimilarComments: { type: Boolean, default: true },
    includeSuggestions: { type: Boolean, default: true }
  },

  aiSettings: {
    model: { type: String, default: 'openai/gpt-oss-20b:free' },
    temperature: { type: Number, min: 0, max: 2, default: 0.1 },
    maxTokens: { type: Number, min: 1000, max: 8000, default: 4000 },
    customPrompts: {
      systemPrompt: { type: String },
      reviewGuidelines: [{ type: String }]
    }
  },

}, { timestamps: true });

RepoConfigSchema.index({ owner: 1, repoId: 1 });

export const RepoConfig = mongoose.model<IRepoConfig>('RepoConfig', RepoConfigSchema);

/**
 * Service class for managing repository configurations
 */
export class RepoConfigService {
  /**
   * Get or create default configuration for a repository
   */
  static async getOrCreateConfig(repoId: number, repoFullName: string): Promise<IRepoConfig> {
    try {
      const [owner] = repoFullName.split('/');

      let config = await RepoConfig.findOne({ repoId });

      if (!config) {
        config = await RepoConfig.create({
          repoId,
          repoFullName,
          owner,
        });

        console.log(`📝 Created default config for repository: ${repoFullName}`);
      }

      return config;
    } catch (error) {
      console.error('❌ Failed to get/create repo config:', error);
      throw error;
    }
  }

  /**
   * Update repository configuration
   */
  static async updateConfig(
    repoId: number,
    updates: Partial<Omit<IRepoConfig, '_id' | 'createdAt' | 'updatedAt'>>
  ): Promise<IRepoConfig> {
    try {
      const config = await RepoConfig.findOneAndUpdate(
        { repoId },
        updates,
        { new: true, runValidators: true }
      );

      if (!config) {
        throw new Error(`Repository config not found for repoId: ${repoId}`);
      }

      console.log(`⚙️ Updated config for repository ${repoId}`);
      return config;
    } catch (error) {
      console.error('❌ Failed to update repo config:', error);
      throw error;
    }
  }

  /**
   * Get effective thresholds for a repository (adaptive or manual)
   */
  static async getEffectiveThresholds(repoId: number): Promise<{
    ignoreMinorThreshold: number;
    ignoreMajorThreshold: number;
    maxCommentsPerReview: number;
    enabledSeverities: ('critical' | 'major' | 'minor')[];
  }> {
    try {
      const config = await this.getOrCreateConfig(repoId, '');

      let thresholds = {
        ignoreMinorThreshold: config.manualThresholds.ignoreMinorThreshold,
        ignoreMajorThreshold: config.manualThresholds.ignoreMajorThreshold,
        maxCommentsPerReview: config.manualThresholds.maxCommentsPerReview,
        enabledSeverities: config.enabledSeverities
      };

      if (config.adaptiveThresholds) {
        const { ReviewFeedbackService } = await import('./review-feedback');
        const adaptiveThresholds = await ReviewFeedbackService.getAdaptiveThresholds(repoId);

        thresholds.ignoreMinorThreshold = adaptiveThresholds.ignoreMinorThreshold;
        thresholds.ignoreMajorThreshold = adaptiveThresholds.ignoreMajorThreshold;
      }

      return thresholds;
    } catch (error) {
      console.error('❌ Failed to get effective thresholds:', error);
      return {
        ignoreMinorThreshold: 0.7,
        ignoreMajorThreshold: 0.3,
        maxCommentsPerReview: 20,
        enabledSeverities: ['critical', 'major', 'minor']
      };
    }
  }

  /**
   * Filter comments based on repository configuration
   */
  static async filterComments(
    comments: any[],
    repoId: number
  ): Promise<any[]> {
    try {
      const thresholds = await this.getEffectiveThresholds(repoId);
      const config = await this.getOrCreateConfig(repoId, '');

      let filteredComments = comments.filter(comment =>
        thresholds.enabledSeverities.includes(comment.severity)
      );

      const finalComments: any[] = [];

      for (const comment of filteredComments) {
        let shouldInclude = true;

        if (comment.severity === 'minor') {
          shouldInclude = Math.random() > thresholds.ignoreMinorThreshold;
        } else if (comment.severity === 'major') {
          shouldInclude = Math.random() > thresholds.ignoreMajorThreshold;
        }

        if (shouldInclude) {
          finalComments.push(comment);
        }
      }

      if (finalComments.length > thresholds.maxCommentsPerReview) {
        finalComments.sort((a: any, b: any) => {
          const severityOrder: Record<'critical' | 'major' | 'minor', number> = { critical: 3, major: 2, minor: 1 };
          return severityOrder[b.severity as 'critical' | 'major' | 'minor'] - severityOrder[a.severity as 'critical' | 'major' | 'minor'];
        });

        filteredComments = finalComments.slice(0, thresholds.maxCommentsPerReview);
      } else {
        filteredComments = finalComments;
      }

      console.log(`🔍 Filtered ${comments.length} comments to ${filteredComments.length} based on repo config`);
      return filteredComments;
    } catch (error) {
      console.error('❌ Failed to filter comments:', error);
      return comments;
    }
  }
}
