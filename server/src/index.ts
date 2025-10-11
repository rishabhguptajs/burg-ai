import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { setupRoutes } from './routes/index';
import { notFoundHandler } from './middleware/notFoundHandler';
import { errorHandler } from './middleware/errorHandler';
import db from './config/db';
import { initializeQueue, shutdownQueue } from './utils/queue';
import mem0Service from './utils/mem0';

dotenv.config();

db.connect();

// Initialize Mem0 service
if (process.env.MEM0_API_KEY) {
  try {
    mem0Service.initialize({
      apiKey: process.env.MEM0_API_KEY,
      host: process.env.MEM0_HOST,
      organizationName: process.env.MEM0_ORG_NAME,
      projectName: process.env.MEM0_PROJECT_NAME,
      organizationId: process.env.MEM0_ORG_ID,
      projectId: process.env.MEM0_PROJECT_ID,
    });

    // Test connection in development
    if (process.env.NODE_ENV === 'development') {
      mem0Service.testConnection();
    }
  } catch (error) {
    console.error('❌ Failed to initialize Mem0 service:', error);
  }
} else {
  console.warn('⚠️  MEM0_API_KEY not found in environment variables. Mem0 features will be disabled.');
}

const queue = initializeQueue();

const app = express();
const PORT = process.env.PORT;

app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

setupRoutes(app);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
});

const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

  try {
    server.close(async () => {
      console.log('✅ HTTP server closed');

      await shutdownQueue();

      await db.disconnect();

      console.log('✅ All connections closed. Exiting...');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('❌ Forced shutdown after timeout');
      process.exit(1);
    }, 10000);

  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;