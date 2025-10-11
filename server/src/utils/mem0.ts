import { MemoryClient, Memory, Message, MemoryOptions, SearchOptions } from 'mem0ai';
import { appLogger, withRetry, withTimeout } from './logging';

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
  constructor(operation: string, retryAfter?: number) {
    super(`Rate limit exceeded for operation '${operation}'`, operation);
    this.name = 'Mem0RateLimitError';
    this.retryAfter = retryAfter;
  }

  retryAfter?: number;
}

export interface Mem0Config {
  apiKey: string;
  host?: string;
  organizationName?: string;
  projectName?: string;
  organizationId?: string | number;
  projectId?: string | number;
}

export interface MemoryCollection {
  name: string;
  description: string;
  metadata?: Record<string, any>;
}

export interface CodeReviewMemory {
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
}

class Mem0Service {
  private client: MemoryClient | null = null;
  private config: Mem0Config | null = null;
  private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
  private circuitBreakerFailures = 0;
  private circuitBreakerLastFailureTime = 0;
  private readonly circuitBreakerThreshold = 5;
  private readonly circuitBreakerTimeout = 60000;
  private readonly defaultTimeout = 30000;
  private readonly defaultRetries = 3;

  /**
   * Initialize the Mem0 client with configuration
   */
  initialize(config: Mem0Config): void {
    const startTime = Date.now();

    try {
      this.config = config;
      this.client = new MemoryClient({
        apiKey: config.apiKey,
        host: config.host || 'https://api.mem0.ai',
        organizationName: config.organizationName,
        projectName: config.projectName,
        organizationId: config.organizationId?.toString(),
        projectId: config.projectId?.toString(),
      });

      const duration = Date.now() - startTime;
      appLogger.performance('mem0_initialization', duration, {
        success: true,
        host: config.host,
        organizationName: config.organizationName,
        projectName: config.projectName
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      appLogger.error('mem0_initialization_failed', error as Error, {
        duration,
        host: config.host
      });
      throw new Mem0ConnectionError('Failed to initialize Mem0 client', 'initialize', error as Error);
    }
  }

  /**
   * Get the Mem0 client instance with circuit breaker check
   */
  private getClient(): MemoryClient {
    if (!this.client) {
      throw new Mem0Error('Mem0 client not initialized. Call initialize() first.', 'getClient');
    }

    // Check circuit breaker
    if (this.circuitBreakerState === 'open') {
      const timeSinceLastFailure = Date.now() - this.circuitBreakerLastFailureTime;
      if (timeSinceLastFailure < this.circuitBreakerTimeout) {
        throw new Mem0Error('Circuit breaker is open. Mem0 service temporarily unavailable.', 'circuit_breaker');
      } else {
        this.circuitBreakerState = 'half-open';
        appLogger.performance('circuit_breaker_half_open', 0, { service: 'mem0' });
      }
    }

    return this.client;
  }

  /**
   * Execute operation with retry logic and circuit breaker
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    timeoutMs: number = this.defaultTimeout,
    maxRetries: number = this.defaultRetries
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await withRetry(
        () => withTimeout(operation(), timeoutMs, `mem0_${operationName}`),
        maxRetries,
        1000,
        `mem0_${operationName}`
      );

      // Success - reset circuit breaker
      if (this.circuitBreakerState === 'half-open') {
        this.circuitBreakerState = 'closed';
        this.circuitBreakerFailures = 0;
        appLogger.performance('circuit_breaker_closed', 0, { service: 'mem0' });
      }

      const duration = Date.now() - startTime;
      appLogger.performance(`mem0_${operationName}`, duration, { success: true });
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.handleOperationError(error as Error, operationName, duration);
      throw error;
    }
  }

  /**
   * Handle operation errors and manage circuit breaker
   */
  private handleOperationError(error: Error, operationName: string, duration: number): void {
    // Update circuit breaker
    this.circuitBreakerFailures++;
    this.circuitBreakerLastFailureTime = Date.now();

    if (this.circuitBreakerFailures >= this.circuitBreakerThreshold) {
      this.circuitBreakerState = 'open';
      appLogger.error('circuit_breaker_opened', `Circuit breaker opened after ${this.circuitBreakerFailures} failures`, {
        service: 'mem0',
        operation: operationName
      });
    }

    // Classify error type
    let mem0Error: Mem0Error;

    if (error.message.includes('timeout') || error.name === 'TimeoutError') {
      mem0Error = new Mem0TimeoutError(operationName, this.defaultTimeout);
    } else if (error.message.includes('rate limit') || error.message.includes('429')) {
      mem0Error = new Mem0RateLimitError(operationName);
    } else if (error.message.includes('network') || error.message.includes('ECONNREFUSED')) {
      mem0Error = new Mem0ConnectionError(error.message, operationName, error);
    } else {
      mem0Error = new Mem0Error(error.message, operationName, error);
    }

    appLogger.error(`mem0_${operationName}_failed`, mem0Error, {
      duration,
      circuitBreakerFailures: this.circuitBreakerFailures,
      circuitBreakerState: this.circuitBreakerState
    });
  }

  /**
   * Test the connection to Mem0 with retry logic
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.executeWithRetry(
        async () => {
          const client = this.getClient();
          await client.ping();
        },
        'connection_test',
        10000,
        2
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get current configuration (without sensitive data)
   */
  getConfig(): Partial<Mem0Config> {
    if (!this.config) {
      return {};
    }

    const { apiKey, ...safeConfig } = this.config;
    return {
      ...safeConfig,
      apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : undefined,
    };
  }

  /**
   * Check if the service is initialized and circuit breaker status
   */
  isInitialized(): boolean {
    return this.client !== null;
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): { state: string; failures: number; lastFailureTime: number } {
    return {
      state: this.circuitBreakerState,
      failures: this.circuitBreakerFailures,
      lastFailureTime: this.circuitBreakerLastFailureTime
    };
  }

  /**
   * Force reset circuit breaker (admin function)
   */
  resetCircuitBreaker(): void {
    this.circuitBreakerState = 'closed';
    this.circuitBreakerFailures = 0;
    this.circuitBreakerLastFailureTime = 0;
    appLogger.performance('circuit_breaker_reset', 0, { service: 'mem0' });
  }

  /**
   * Get predefined memory collections for code review system
   */
  getMemoryCollections(): MemoryCollection[] {
    return [
      {
        name: 'burg-ai-code-review',
        description: 'Main memory collection for Burg AI code review patterns and preferences',
        metadata: {
          system: 'burg-ai',
          purpose: 'code-review',
          version: '1.0'
        }
      },
      {
        name: 'burg-ai-user-patterns',
        description: 'User-specific coding patterns and preferences',
        metadata: {
          system: 'burg-ai',
          purpose: 'user-patterns',
          version: '1.0'
        }
      },
      {
        name: 'burg-ai-repo-patterns',
        description: 'Repository-specific coding standards and patterns',
        metadata: {
          system: 'burg-ai',
          purpose: 'repo-patterns',
          version: '1.0'
        }
      }
    ];
  }

  /**
   * Store a code review memory with retry logic and monitoring
   */
  async storeCodeReviewMemory(memory: CodeReviewMemory): Promise<Memory[]> {
    return this.executeWithRetry(
      async () => {
        const client = this.getClient();

        const messages: Message[] = [{
          role: 'user',
          content: `Pattern: ${memory.pattern}\nCategory: ${memory.category}\nRationale: ${memory.rationale}\nExamples: ${memory.examples.join(', ')}`
        }];

        const options: MemoryOptions = {
          user_id: memory.userId || 'system',
          metadata: {
            repositoryId: memory.repositoryId,
            category: memory.category,
            confidence: memory.confidence,
            fileTypes: memory.metadata.fileTypes,
            languages: memory.metadata.languages,
            source: memory.metadata.source,
            createdAt: memory.metadata.createdAt || new Date(),
            updatedAt: memory.metadata.updatedAt || new Date()
          }
        };

        const result = await client.add(messages, options);
        appLogger.performance('mem0_memory_stored', 0, {
          repositoryId: memory.repositoryId,
          category: memory.category,
          confidence: memory.confidence,
          patternLength: memory.pattern.length
        });

        return result;
      },
      'store_memory',
      45000,
      2
    );
  }

  /**
   * Search for relevant memories for a code review with retry logic and monitoring
   */
  async searchCodeReviewMemories(
    repositoryId: string,
    query: string,
    options?: {
      userId?: string;
      categories?: string[];
      limit?: number;
    }
  ): Promise<Memory[]> {
    return this.executeWithRetry(
      async () => {
        const client = this.getClient();

        const searchOptions: SearchOptions = {
          user_id: options?.userId,
          filters: {
            repositoryId: repositoryId,
            ...(options?.categories && { category: { $in: options.categories } })
          },
          limit: options?.limit || 10
        };

        const result = await client.search(query, searchOptions);
        appLogger.performance('mem0_memory_search', 0, {
          repositoryId,
          queryLength: query.length,
          categories: options?.categories?.length || 0,
          resultsCount: result.length,
          limit: options?.limit || 10
        });

        return result;
      },
      'search_memories',
      30000,
      3
    );
  }

  /**
   * Get all memories for a repository with retry logic and monitoring
   */
  async getRepositoryMemories(repositoryId: string, options?: { limit?: number }): Promise<Memory[]> {
    return this.executeWithRetry(
      async () => {
        const client = this.getClient();

        const searchOptions: SearchOptions = {
          filters: {
            repositoryId: repositoryId
          },
          limit: options?.limit || 50
        };

        const result = await client.getAll(searchOptions);
        appLogger.performance('mem0_repository_memories_fetched', 0, {
          repositoryId,
          resultsCount: result.length,
          limit: options?.limit || 50
        });

        return result;
      },
      'get_repository_memories',
      30000,
      3
    );
  }
}

export const mem0Service = new Mem0Service();
export default mem0Service; 