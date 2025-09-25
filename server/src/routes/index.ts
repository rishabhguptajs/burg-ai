import { Application } from 'express';
import exampleRoutes from './api/example';

export const setupRoutes = (app: Application): void => {
  app.use('/api/example', exampleRoutes);

  console.log('📋 Routes setup completed');
};
