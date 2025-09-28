import winston from 'winston';
import path from 'path';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'burg-ai-review' },
  transports: [
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log')
    }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

import fs from 'fs';
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Enhanced logging utility with structured logging and metrics
 */
export class Logger {
  private static instance: Logger;
  private metrics: Map<string, { count: number; totalTime: number; errors: number }> = new Map();

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Log AI review operations with structured data
   */
  aiReview(operation: string, data: {
    repoFullName?: string;
    prNumber?: number;
    success: boolean;
    duration?: number;
    commentsCount?: number;
    validationErrors?: number;
    retries?: number;
    error?: string;
  }) {
    const logData = {
      operation,
      repo: data.repoFullName,
      pr: data.prNumber,
      success: data.success,
      duration: data.duration,
      comments: data.commentsCount,
      validationErrors: data.validationErrors,
      retries: data.retries,
      error: data.error
    };

    if (data.success) {
      logger.info('AI Review Completed', logData);
    } else {
      logger.error('AI Review Failed', logData);
    }

    this.updateMetrics(`ai_review_${operation}`, data.duration || 0, !data.success);
  }

  /**
   * Log queue operations
   */
  queue(operation: string, data: {
    jobId?: string;
    repoFullName?: string;
    prNumber?: number;
    action?: string;
    success: boolean;
    duration?: number;
    error?: string;
  }) {
    const logData = {
      operation,
      jobId: data.jobId,
      repo: data.repoFullName,
      pr: data.prNumber,
      action: data.action,
      success: data.success,
      duration: data.duration,
      error: data.error
    };

    if (data.success) {
      logger.info('Queue Operation', logData);
    } else {
      logger.error('Queue Operation Failed', logData);
    }

    this.updateMetrics(`queue_${operation}`, data.duration || 0, !data.success);
  }

  /**
   * Log GitHub API operations
   */
  github(operation: string, data: {
    repoFullName?: string;
    prNumber?: number;
    success: boolean;
    duration?: number;
    apiCalls?: number;
    rateLimitRemaining?: number;
    error?: string;
  }) {
    const logData = {
      operation,
      repo: data.repoFullName,
      pr: data.prNumber,
      success: data.success,
      duration: data.duration,
      apiCalls: data.apiCalls,
      rateLimitRemaining: data.rateLimitRemaining,
      error: data.error
    };

    if (data.success) {
      logger.info('GitHub API Operation', logData);
    } else {
      logger.error('GitHub API Operation Failed', logData);
    }

    this.updateMetrics(`github_${operation}`, data.duration || 0, !data.success);
  }

  /**
   * Log validation operations
   */
  validation(operation: string, data: {
    schema: string;
    success: boolean;
    errors?: string[];
    duration?: number;
  }) {
    const logData = {
      operation,
      schema: data.schema,
      success: data.success,
      errors: data.errors,
      duration: data.duration
    };

    if (data.success) {
      logger.debug('Schema Validation', logData);
    } else {
      logger.warn('Schema Validation Failed', logData);
    }

    this.updateMetrics(`validation_${operation}`, data.duration || 0, !data.success);
  }

  /**
   * Log webhook events
   */
  webhook(event: string, data: {
    deliveryId?: string;
    repoFullName?: string;
    prNumber?: number;
    action?: string;
    success: boolean;
    duration?: number;
    error?: string;
  }) {
    const logData = {
      event,
      deliveryId: data.deliveryId,
      repo: data.repoFullName,
      pr: data.prNumber,
      action: data.action,
      success: data.success,
      duration: data.duration,
      error: data.error
    };

    if (data.success) {
      logger.info('Webhook Processed', logData);
    } else {
      logger.error('Webhook Processing Failed', logData);
    }

    this.updateMetrics(`webhook_${event}`, data.duration || 0, !data.success);
  }

  /**
   * Log performance metrics
   */
  performance(operation: string, duration: number, metadata?: Record<string, any>) {
    logger.info('Performance Metric', {
      operation,
      duration,
      ...metadata
    });

    this.updateMetrics(`perf_${operation}`, duration, false);
  }

  /**
   * Log errors with context
   */
  error(context: string, error: Error | string, metadata?: Record<string, any>) {
    const errorMessage = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;

    logger.error('Application Error', {
      context,
      error: errorMessage,
      stack,
      ...metadata
    });
  }

  /**
   * Get current metrics
   */
  getMetrics(): Record<string, { count: number; avgTime: number; errorRate: number }> {
    const result: Record<string, { count: number; avgTime: number; errorRate: number }> = {};

    for (const [key, data] of this.metrics.entries()) {
      result[key] = {
        count: data.count,
        avgTime: data.count > 0 ? data.totalTime / data.count : 0,
        errorRate: data.count > 0 ? (data.errors / data.count) * 100 : 0
      };
    }

    return result;
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics.clear();
  }

  /**
   * Update internal metrics
   */
  private updateMetrics(operation: string, duration: number, isError: boolean): void {
    const existing = this.metrics.get(operation) || { count: 0, totalTime: 0, errors: 0 };

    existing.count++;
    existing.totalTime += duration;
    if (isError) existing.errors++;

    this.metrics.set(operation, existing);
  }
}

export const appLogger = Logger.getInstance();

/**
 * Error handling decorator for async functions
 */
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  context: string
) {
  return async (...args: T): Promise<R> => {
    const startTime = Date.now();

    try {
      const result = await fn(...args);
      const duration = Date.now() - startTime;

      appLogger.performance(context, duration, {
        success: true,
        argsCount: args.length
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      appLogger.error(context, error as Error, {
        duration,
        argsCount: args.length
      });

      throw error;
    }
  };
}

/**
 * Retry utility with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  context: string = 'retry-operation'
): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();

      if (attempt > 0) {
        appLogger.performance(`${context}_retry_success`, 0, {
          attempt,
          maxRetries
        });
      }

      return result;
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        appLogger.performance(`${context}_retry_attempt`, delay, {
          attempt: attempt + 1,
          maxRetries,
          error: lastError.message
        });

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  appLogger.error(`${context}_exhausted_retries`, lastError, {
    maxRetries,
    finalError: lastError.message
  });

  throw lastError;
}

/**
 * Timeout wrapper for operations
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  context: string = 'timeout-operation'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      appLogger.error(`${context}_timeout`, `Operation timed out after ${timeoutMs}ms`);
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    operation
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}
