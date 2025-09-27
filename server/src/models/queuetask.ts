import mongoose, { Schema, Document } from 'mongoose';

export interface IQueueTask extends Document {
  type: 'AI_REVIEW';
  pullRequest: mongoose.Types.ObjectId;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const QueueTaskSchema: Schema = new Schema({
  type: { type: String, enum: ['AI_REVIEW'], required: true },
  pullRequest: { type: Schema.Types.ObjectId, ref: 'PullRequest', required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
  error: { type: String },
}, { timestamps: true });

export const QueueTask = mongoose.model<IQueueTask>('QueueTask', QueueTaskSchema);
