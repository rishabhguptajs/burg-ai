/**
 * Centralized Mem0-related types and interfaces
 * This file contains all Mem0 types used across the application
 */

import { Document } from 'mongoose';

/**
 * Custom error classes for Mem0 operations
 */
export class Mem0Error extends Error {
  constructor(message: string, public operation: string, public cause?: Error) {
    super(message);
    this.name = 'Mem0Error';
  }
}

export class Mem0ConnectionError extends Mem0Error {
  constructor(message: string, operation: string, cause?: Error) {
    super(message, operation, cause);
    this.name = 'Mem0ConnectionError';
  }
}

export class Mem0TimeoutError extends Mem0Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`, operation);
    this.name = 'Mem0TimeoutError';
  }
}

export class Mem0RateLimitError extends Mem0Error {
  retryAfter?: number;

  constructor(operation: string, retryAfter?: number) {
    super(`Rate limit exceeded for operation '${operation}'`, operation);
    this.name = 'Mem0RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Mem0 service configuration
 */
export type Mem0Config = {
  apiKey: string;
  host?: string;
  organizationName?: string;
  projectName?: string;
  organizationId?: string | number;
  projectId?: string | number;
};

/**
 * Memory collection definition
 */
export type MemoryCollection = {
  name: string;
  description: string;
  metadata?: Record<string, any>;
};

/**
 * Code review memory pattern structure
 */
export type CodeReviewMemory = {
  id?: string;
  repositoryId: string;
  userId?: string;
  pattern: string;
  category: 'naming' | 'error-handling' | 'performance' | 'security' | 'architecture' | 'style';
  confidence: number;
  examples: string[];
  rationale: string;
  metadata: {
    fileTypes?: string[];
    languages?: string[];
    source?: string;
    createdAt?: Date;
    updatedAt?: Date;
  };
};

/**
 * Memory analytics data structure
 */
export type IMemoryAnalytics = Document & {
  repositoryId: string;
  period: {
    start: Date;
    end: Date;
    type: 'daily' | 'weekly' | 'monthly';
  };
  metrics: {
    totalMemories: number;
    memoriesAdded: number;
    memoriesRetrieved: number;
    averageRetrievalTime: number;
    memoryHitRate: number;
    categoryDistribution: {
      naming: number;
      'error-handling': number;
      performance: number;
      security: number;
      architecture: number;
      style: number;
    };
    topPatterns: Array<{
      pattern: string;
      category: string;
      usageCount: number;
      confidence: number;
    }>;
  };
  performance: {
    retrievalSuccessRate: number;
    averageRelevanceScore: number;
    memoryStorageGrowth: number;
    apiCallCount: number;
    errorCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Memory usage tracking in AI review metadata
 */
export type MemoryUsageMetadata = {
  memoryRetrieved: boolean;
  memorySnippetsUsed: number;
  memoryRetrievalTime: number;
  memoryCollectionName?: string;
  memorySearchQuery?: string;
  memoryRelevanceScore?: number;
};

/**
 * Enhanced AI review response with memory tracking
 */
export type EnhancedAIReviewResponse = {
  request: {
    prContext: any; // PRContext type from ai.ts
    prompt: string;
    timestamp: string;
    model: string;
    temperature: number;
    maxTokens: number;
    repoConfig: any;
  };
  response: {
    raw: string;
    parsed: any; // StructuredAIReview type from schema-validation.ts
    validationErrors: string[] | null;
    fallbackComments: any[]; // ReviewComment[] type from schema-validation.ts
    timestamp: string;
    processingTimeMs: number;
    retryCount: number;
  };
  metadata: {
    success: boolean;
    error?: string;
    apiCallDuration: number;
    totalDuration: number;
    schemaValidationPassed: boolean;
    memorySnippetsUsed: number;
    finalCommentsCount: number;
  };
};

/**
 * Memory settings in repository configuration
 */
export type MemorySettings = {
  useMemoryRetrieval: boolean;
  maxMemorySnippets: number;
  memorySimilarityThreshold: number;
};
