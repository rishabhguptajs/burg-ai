import mongoose, { Schema, Document } from 'mongoose';

export interface IInstallation extends Document {
  installationId: number;       
  accountType: 'User' | 'Organization';
  accountLogin: string;        
  repositories: string[];      
  accessToken?: string;         
  accessTokenExpiresAt?: Date;
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
}, { timestamps: true });

export const Installation = mongoose.model<IInstallation>('Installation', InstallationSchema);
