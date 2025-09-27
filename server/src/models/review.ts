import mongoose, { Schema, Document } from 'mongoose';

export interface IAIReview extends Document {
  pullRequest: mongoose.Types.ObjectId;
  reviewer: 'AI'; 
  comments: {
    filePath: string;
    line: number;
    comment: string;
    severity: 'low' | 'medium' | 'high';
  }[];
  status: 'pending' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}

const AIReviewSchema: Schema = new Schema({
  pullRequest: { type: Schema.Types.ObjectId, ref: 'PullRequest', required: true },
  reviewer: { type: String, enum: ['AI'], default: 'AI' },
  comments: [{
    filePath: { type: String, required: true },
    line: { type: Number, required: true },
    comment: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  }],
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
}, { timestamps: true });

export const AIReview = mongoose.model<IAIReview>('AIReview', AIReviewSchema);
