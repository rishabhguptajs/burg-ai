import { Application } from 'express';
import exampleRoutes from './api/example';
import githubRoutes from './api/github';
import webhookRoutes from './webhook';
import healthRoutes from './health';
import authRoutes from './auth';

export const setupRoutes = (app: Application): void => {
  app.use('/api/example', exampleRoutes);
  app.use('/api/github', githubRoutes);
  app.use('/auth', authRoutes);
  app.use('/webhook', webhookRoutes);
  app.use('/health', healthRoutes);

  console.log('📋 Routes setup completed');
};
