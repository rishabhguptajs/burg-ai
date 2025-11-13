import mongoose, { Schema, Document } from 'mongoose';
import { ReviewComment, StructuredAIReview } from '../types';

export interface IAIReview extends Document {
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

const ReviewCommentSchema = new Schema({
  filePath: { type: String, required: true },
  line: { type: Number, required: true },
  severity: { type: String, enum: ['critical', 'major', 'minor'], required: true },
  message: { type: String, required: true },
  rationale: { type: String, required: true },
  suggestion: { type: String }
}, { _id: false });

const AIReviewSchema: Schema = new Schema({
  pullRequest: { type: Schema.Types.ObjectId, ref: 'PullRequest', required: true },
  reviewer: { type: String, enum: ['AI'], default: 'AI' },
  summary: { type: String, required: true },
  comments: [ReviewCommentSchema],
  metadata: {
    totalComments: { type: Number, default: 0 },
    severityBreakdown: {
      critical: { type: Number, default: 0 },
      major: { type: Number, default: 0 },
      minor: { type: Number, default: 0 }
    },
    analysisTime: { type: Number, default: 0 },
    validationErrors: [{ type: String }]
  },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
}, { timestamps: true });

AIReviewSchema.index({ pullRequest: 1, status: 1 });
AIReviewSchema.index({ 'comments.severity': 1 });
AIReviewSchema.index({ createdAt: -1 });

export const AIReview = mongoose.model<IAIReview>('AIReview', AIReviewSchema);
