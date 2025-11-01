/**
 * Configuration-related types and interfaces
 */

import { Document } from 'mongoose';

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
