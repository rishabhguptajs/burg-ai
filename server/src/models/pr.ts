import mongoose, { Schema, Document } from 'mongoose';

export interface IPullRequest extends Document {
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

const PullRequestSchema: Schema = new Schema({
  repoFullName: { type: String, required: true },
  prNumber: { type: Number, required: true },
  installation: { type: Schema.Types.ObjectId, ref: 'Installation', required: true },
  title: { type: String },
  author: { type: String },
  merged: { type: Boolean, default: false },
  state: { type: String, enum: ['open', 'closed', 'merged'], default: 'open' },
  aiReviews: [{ type: Schema.Types.ObjectId, ref: 'AIReview' }],
}, { timestamps: true });

export const PullRequest = mongoose.model<IPullRequest>('PullRequest', PullRequestSchema);
