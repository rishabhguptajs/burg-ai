import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { appLogger } from '../utils/logging';
import { EnhancedAIReviewService } from '../utils/enhanced-ai-review';
import { getPRReviewQueue } from '../utils/queue';
import { validateGitHubAppConfig } from '../utils/github';

const router = Router();

/**
 * Health check endpoint
 * GET /health
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const checks = {
    database: false,
    redis: false,
    github: false,
    ai: false,
    overall: false
  };

  const details: Record<string, any> = {};

  try {
    try {
      if (mongoose.connection.db) {
        await mongoose.connection.db.admin().ping();
        checks.database = true;
        details.database = { status: 'healthy', latency: Date.now() - startTime };
      } else {
        throw new Error('Database connection not established');
      }
    } catch (error) {
      details.database = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    try {
      const queue = getPRReviewQueue();
      await queue.healthCheck();
      checks.redis = true;
      details.redis = { status: 'healthy' };
    } catch (error) {
      details.redis = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    try {
      const configCheck = validateGitHubAppConfig();
      checks.github = configCheck.isValid;
      details.github = {
        status: configCheck.isValid ? 'healthy' : 'unhealthy',
        ...(configCheck.isValid ? {} : { errors: configCheck.errors })
      };
    } catch (error) {
      details.github = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    try {
      const aiCheck = await EnhancedAIReviewService.testEnhancedReviewConfig();
      checks.ai = aiCheck.isValid;
      details.ai = {
        status: aiCheck.isValid ? 'healthy' : 'unhealthy',
        ...(aiCheck.isValid ? {} : { errors: aiCheck.errors })
      };
    } catch (error) {
      details.ai = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    checks.overall = checks.database && checks.redis && checks.github && checks.ai;

    const response = {
      status: checks.overall ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks,
      details,
      metrics: appLogger.getMetrics()
    };

    const statusCode = checks.overall ? 200 : 503;

    appLogger.performance('health_check', Date.now() - startTime, {
      status: response.status,
      checksPassed: Object.values(checks).filter(Boolean).length,
      totalChecks: Object.keys(checks).length
    });

    res.status(statusCode).json(response);

  } catch (error) {
    appLogger.error('health_check_failed', error as Error);

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Health check failed',
      checks: { overall: false },
      details: {
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

/**
 * Detailed metrics endpoint
 * GET /health/metrics
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = appLogger.getMetrics();

    let queueStats = {};
    try {
      const queue = getPRReviewQueue();
      queueStats = await queue.getStats();
    } catch (error) {
      queueStats = { error: 'Failed to get queue stats' };
    }

    let dbStats = {};
    try {
      if (mongoose.connection.db) {
        const stats = await mongoose.connection.db.stats();
        dbStats = {
          collections: stats.collections,
          objects: stats.objects,
          dataSize: stats.dataSize,
          storageSize: stats.storageSize
        };
      } else {
        dbStats = { error: 'Database connection not established' };
      }
    } catch (error) {
      dbStats = { error: 'Failed to get database stats' };
    }

    res.json({
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      metrics,
      queue: queueStats,
      database: dbStats
    });

  } catch (error) {
    appLogger.error('metrics_endpoint_failed', error as Error);
    res.status(500).json({
      error: 'Failed to retrieve metrics',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Readiness probe endpoint
 * GET /health/ready
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    const dbReady = mongoose.connection.readyState === 1;

    if (dbReady) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        reason: 'Database not connected'
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Liveness probe endpoint
 * GET /health/live
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export default router;
