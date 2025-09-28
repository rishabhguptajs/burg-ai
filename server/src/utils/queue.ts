import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import crypto from 'crypto';
import { QueueTask } from '../models/queuetask';
import { PullRequest } from '../models/pr';
import { AIReview } from '../models/review';

export interface PRReviewJob {
  jobId: string;
  installationId: number;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  action: string;
}

class PRReviewQueue {
  private queue: Queue<PRReviewJob>;
  private worker: Worker<PRReviewJob>;
  private queueEvents: QueueEvents;

  constructor() {
    this.queue = new Queue<PRReviewJob>('pr-review-queue', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,  
        attempts: 3,    
        backoff: {
          type: 'exponential',
          delay: 2000,     
        },
      },
    });

    this.worker = new Worker<PRReviewJob>(
      'pr-review-queue',
      this.processPRReviewJob.bind(this),
      {
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        },
        concurrency: 5,
      }
    );

    this.queueEvents = new QueueEvents('pr-review-queue', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    });

    this.setupEventListeners();
    this.setupWorkerEventListeners();
  }

  /**
   * Process a PR review job
   */
  private async processPRReviewJob(job: Job<PRReviewJob>): Promise<void> {
    const { jobId, installationId, repoFullName, prNumber, headSha, action } = job.data;

    console.log(`🔄 Starting PR review job: ${jobId} - ${repoFullName}#${prNumber} (${action})`);

    let queueTask: any = null;

    try {
      const prRecord = await PullRequest.findOne({
        repoFullName,
        prNumber,
      });

      if (!prRecord) {
        throw new Error(`PullRequest record not found for ${repoFullName}#${prNumber}`);
      }

      queueTask = await QueueTask.findOneAndUpdate(
        { pullRequest: prRecord._id },
        {
          type: 'AI_REVIEW',
          pullRequest: prRecord._id,
          status: 'processing'
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );

      console.log(`📋 QueueTask created/updated: ${queueTask._id}`);

      await this.performPRReview({
        installationId,
        repoFullName,
        prNumber,
        headSha,
        action,
      });

      await QueueTask.findByIdAndUpdate(queueTask._id, {
        status: 'completed',
        error: undefined
      });

      console.log(`✅ Completed PR review job: ${jobId} - ${repoFullName}#${prNumber}`);

    } catch (error) {
      console.error(`❌ Failed PR review job: ${jobId} - ${repoFullName}#${prNumber}`, error);

      if (queueTask) {
        await QueueTask.findByIdAndUpdate(queueTask._id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      throw error;
    }
  }

  /**
   * Process PR review by fetching data from GitHub and performing analysis
   */
  private async performPRReview(data: Omit<PRReviewJob, 'jobId'>): Promise<void> {
    const { installationId, repoFullName, prNumber, headSha, action } = data;

    try {
      const { processPRReviewJob, validateGitHubAppConfig } = await import('./github');

      const configValidation = validateGitHubAppConfig();
      if (!configValidation.isValid) {
        throw new Error(`GitHub App configuration invalid: ${configValidation.errors.join(', ')}`);
      }

      switch (action) {
        case 'opened':
          console.log(`📝 Processing opened PR: ${repoFullName}#${prNumber}`);

          const prContext = await processPRReviewJob({
            jobId: crypto.randomUUID(),
            installationId,
            repoFullName,
            prNumber,
            headSha,
            action,
          });

          console.log(`📊 PR Context fetched:`, {
            title: prContext.title,
            filesChanged: prContext.changedFiles.length,
            totalAdditions: prContext.changedFiles.reduce((sum, f) => sum + f.additions, 0),
            totalDeletions: prContext.changedFiles.reduce((sum, f) => sum + f.deletions, 0),
          });

          const [owner, repo] = repoFullName.split('/');
          const repoRecord = await PullRequest.findOne({ repoFullName, prNumber });
          const repoId = repoRecord?.repoId || 0;

          const { EnhancedAIReviewService: EnhancedReviewService } = await import('./enhanced-ai-review');
          const enhancedAIResponse = await EnhancedReviewService.generateEnhancedReview(prContext, repoId);

          console.log(`🎯 Enhanced AI Review completed:`, {
            success: enhancedAIResponse.metadata.success,
            commentsCount: enhancedAIResponse.response.parsed?.comments.length || 0,
            validationErrors: enhancedAIResponse.response.validationErrors?.length || 0,
            retriesUsed: enhancedAIResponse.response.retryCount
          });

          let aiReviewRecord: any = null;
          if (enhancedAIResponse.response.parsed || enhancedAIResponse.response.fallbackComments.length > 0) {
            const prRecord = await PullRequest.findOne({
              repoFullName,
              prNumber
            });

            if (prRecord) {
              const reviewData = enhancedAIResponse.response.parsed || {
                summary: 'AI review completed with validation issues',
                comments: enhancedAIResponse.response.fallbackComments
              };

              aiReviewRecord = await AIReview.create({
                pullRequest: prRecord._id,
                reviewer: 'AI',
                summary: reviewData.summary,
                comments: reviewData.comments,
                metadata: {
                  totalComments: reviewData.comments.length,
                  severityBreakdown: reviewData.comments.reduce(
                    (acc, comment) => {
                      acc[comment.severity]++;
                      return acc;
                    },
                    { critical: 0, major: 0, minor: 0 }
                  ),
                  analysisTime: enhancedAIResponse.response.processingTimeMs,
                  validationErrors: enhancedAIResponse.response.validationErrors
                },
                status: enhancedAIResponse.metadata.success ? 'completed' : 'failed'
              });

              await PullRequest.findByIdAndUpdate(prRecord._id, {
                $push: { aiReviews: aiReviewRecord._id }
              });

              console.log(`💾 Enhanced AI Review stored in database: ${aiReviewRecord._id}`);
            }
          }

          if (enhancedAIResponse.response.parsed || enhancedAIResponse.response.fallbackComments.length > 0) {
            const { postStructuredAIReviewToGitHub } = await import('./github');
            const reviewToPost = enhancedAIResponse.response.parsed || {
              summary: 'AI review completed with validation issues - manual review recommended',
              comments: enhancedAIResponse.response.fallbackComments
            };

            await postStructuredAIReviewToGitHub(
              installationId,
              repoFullName,
              prNumber,
              reviewToPost
            );
          }

          break;

        case 'synchronize':
          console.log(`🔄 Processing updated PR: ${repoFullName}#${prNumber}`);

          const updatedPrContext = await processPRReviewJob({
            jobId: crypto.randomUUID(),
            installationId,
            repoFullName,
            prNumber,
            headSha,
            action,
          });

          console.log(`📊 Updated PR Context:`, {
            title: updatedPrContext.title,
            filesChanged: updatedPrContext.changedFiles.length,
          });

          const [updatedOwner, updatedRepo] = repoFullName.split('/');
          const updatedRepoRecord = await PullRequest.findOne({ repoFullName, prNumber });
          const updatedRepoId = updatedRepoRecord?.repoId || 0;

          const { EnhancedAIReviewService: UpdatedEnhancedReviewService } = await import('./enhanced-ai-review');
          const updatedEnhancedAIResponse = await UpdatedEnhancedReviewService.generateEnhancedReview(updatedPrContext, updatedRepoId);

          console.log(`🔄 Updated Enhanced AI Review completed:`, {
            success: updatedEnhancedAIResponse.metadata.success,
            commentsCount: updatedEnhancedAIResponse.response.parsed?.comments.length || 0,
            validationErrors: updatedEnhancedAIResponse.response.validationErrors?.length || 0,
            retriesUsed: updatedEnhancedAIResponse.response.retryCount
          });

          if (updatedEnhancedAIResponse.response.parsed || updatedEnhancedAIResponse.response.fallbackComments.length > 0) {
            const prRecord = await PullRequest.findOne({
              repoFullName,
              prNumber
            });

            if (prRecord) {
              const updatedReviewData = updatedEnhancedAIResponse.response.parsed || {
                summary: 'Updated AI review completed with validation issues',
                comments: updatedEnhancedAIResponse.response.fallbackComments
              };

              const updatedAiReviewRecord = await AIReview.create({
                pullRequest: prRecord._id,
                reviewer: 'AI',
                summary: updatedReviewData.summary,
                comments: updatedReviewData.comments,
                metadata: {
                  totalComments: updatedReviewData.comments.length,
                  severityBreakdown: updatedReviewData.comments.reduce(
                    (acc, comment) => {
                      acc[comment.severity]++;
                      return acc;
                    },
                    { critical: 0, major: 0, minor: 0 }
                  ),
                  analysisTime: updatedEnhancedAIResponse.response.processingTimeMs,
                  validationErrors: updatedEnhancedAIResponse.response.validationErrors
                },
                status: updatedEnhancedAIResponse.metadata.success ? 'completed' : 'failed'
              });

              await PullRequest.findByIdAndUpdate(prRecord._id, {
                $push: { aiReviews: updatedAiReviewRecord._id }
              });

              console.log(`💾 Updated Enhanced AI Review stored in database: ${updatedAiReviewRecord._id}`);
            }
          }

          if (updatedEnhancedAIResponse.response.parsed || updatedEnhancedAIResponse.response.fallbackComments.length > 0) {
            const { postStructuredAIReviewToGitHub } = await import('./github');
            const updatedReviewToPost = updatedEnhancedAIResponse.response.parsed || {
              summary: 'Updated AI review completed with validation issues - manual review recommended',
              comments: updatedEnhancedAIResponse.response.fallbackComments
            };

            await postStructuredAIReviewToGitHub(
              installationId,
              repoFullName,
              prNumber,
              updatedReviewToPost
            );
          }

          break;

        case 'closed':
          console.log(`🔒 Processing closed PR: ${repoFullName}#${prNumber}`);
          break;

        default:
          console.log(`📋 Processing PR ${action}: ${repoFullName}#${prNumber}`);
      }

    } catch (error) {
      console.error(`❌ Error processing PR ${repoFullName}#${prNumber}:`, error);

      throw error;
    }
  }

  /**
   * Setup queue event listeners for monitoring
   */
  private setupEventListeners(): void {
    this.queueEvents.on('waiting', ({ jobId }) => {
      console.log(`⏳ Job ${jobId} is waiting in queue`);
    });

    this.queueEvents.on('active', ({ jobId, prev }) => {
      console.log(`🚀 Job ${jobId} started processing`);
    });

    this.queueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`✅ Job ${jobId} completed successfully`);
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      console.log(`❌ Job ${jobId} failed: ${failedReason}`);
    });

    this.queueEvents.on('stalled', ({ jobId }) => {
      console.log(`⚠️ Job ${jobId} stalled`);
    });
  }

  /**
   * Setup worker event listeners
   */
  private setupWorkerEventListeners(): void {
    this.worker.on('completed', (job) => {
      console.log(`🎉 Worker completed job ${job.id}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`💥 Worker failed job ${job?.id}:`, err.message);
    });

    this.worker.on('error', (err) => {
      console.error('🚨 Worker error:', err);
    });
  }

  /**
   * Add a job to the queue
   */
  async addJob(jobData: PRReviewJob): Promise<Job<PRReviewJob>> {
    try {
      const job = await this.queue.add('processPR', jobData, {
        jobId: jobData.jobId,
        priority: this.getJobPriority(jobData.action),
      });

      console.log(`📋 Added job ${jobData.jobId} to queue for ${jobData.repoFullName}#${jobData.prNumber}`);
      return job;
    } catch (error) {
      console.error('Error adding job to queue:', error);
      throw error;
    }
  }

  /**
   * Get job priority based on action type
   */
  private getJobPriority(action: string): number {
    switch (action) {
      case 'opened':
        return 10;
      case 'synchronize':
        return 5;
      case 'closed':
        return 1;
      default:
        return 5;
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActive(),
      this.queue.getCompleted(),
      this.queue.getFailed(),
      this.queue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Health check for queue connectivity
   */
  async healthCheck(): Promise<{ isHealthy: boolean; details: any }> {
    try {
      await this.queue.getWaiting();
      return { isHealthy: true, details: { status: 'connected' } };
    } catch (error) {
      return {
        isHealthy: false,
        details: {
          status: 'disconnected',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Gracefully close the queue and worker
   */
  async close(): Promise<void> {
    console.log('🛑 Closing PR Review Queue...');
    await this.worker.close();
    await this.queue.close();
    await this.queueEvents.close();
    console.log('✅ PR Review Queue closed');
  }
}

let prReviewQueue: PRReviewQueue | null = null;

/**
 * Get the PR review queue instance (singleton)
 */
export function getPRReviewQueue(): PRReviewQueue {
  if (!prReviewQueue) {
    prReviewQueue = new PRReviewQueue();
  }
  return prReviewQueue;
}

/**
 * Initialize the queue system
 */
export function initializeQueue(): PRReviewQueue {
  console.log('🚀 Initializing PR Review Queue System...');
  return getPRReviewQueue();
}

/**
 * Gracefully shutdown the queue system
 */
export async function shutdownQueue(): Promise<void> {
  if (prReviewQueue) {
    await prReviewQueue.close();
    prReviewQueue = null;
  }
}
