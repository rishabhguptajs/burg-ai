import mongoose, { Schema, Document } from 'mongoose';

export interface IInstallation extends Document {
  installationId: number;
  accountType: 'User' | 'Organization';
  accountLogin: string;
  repositories: string[];
  accessToken?: string;
  accessTokenExpiresAt?: Date;
  user?: mongoose.Types.ObjectId; 
  createdAt: Date;
  updatedAt: Date;
}

const InstallationSchema: Schema = new Schema({
  installationId: { type: Number, required: true, unique: true },
  accountType: { type: String, enum: ['User', 'Organization'], required: true },
  accountLogin: { type: String, required: true },
  repositories: [{ type: String, required: true }],
  accessToken: { type: String },
  accessTokenExpiresAt: { type: Date },
  user: { type: Schema.Types.ObjectId, ref: 'User' }, 
}, { timestamps: true });

export const Installation = mongoose.model<IInstallation>('Installation', InstallationSchema);
