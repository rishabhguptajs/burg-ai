import { Application } from 'express';
import exampleRoutes from './api/example';
import githubRoutes from './api/github';
import webhookRoutes from './webhook';

export const setupRoutes = (app: Application): void => {
  app.use('/api/example', exampleRoutes);
  app.use('/api/github', githubRoutes);
  app.use('/webhook', webhookRoutes);

  console.log('📋 Routes setup completed');
};
