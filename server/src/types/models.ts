/**
 * Database model types and interfaces
 */

import mongoose from 'mongoose';
import { ReviewComment } from './review';

export interface IInstallation extends mongoose.Document {
  installationId: number;
  accountType: 'User' | 'Organization';
  accountLogin: string;
  repositories: string[];
  accessToken?: string;
  accessTokenExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPullRequest extends mongoose.Document {
  repoId: number;
  repoFullName: string;
  prNumber: number;
  installation: mongoose.Types.ObjectId;
  title: string;
  author: string;
  merged: boolean;
  state: 'open' | 'closed' | 'merged';
  aiReviews: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IAIReview extends mongoose.Document {
  pullRequest: mongoose.Types.ObjectId;
  reviewer: 'AI';
  summary: string;
  comments: ReviewComment[];
  metadata?: {
    totalComments: number;
    severityBreakdown: {
      critical: number;
      major: number;
      minor: number;
    };
    analysisTime: number;
    validationErrors?: string[];
  };
  status: 'pending' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

export interface IQueueTask extends mongoose.Document {
  type: 'AI_REVIEW';
  pullRequest: mongoose.Types.ObjectId;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReviewFeedback extends mongoose.Document {
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
