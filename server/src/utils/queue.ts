import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import crypto from 'crypto';
import { QueueTask } from '../models/queuetask';
import { PullRequest } from '../models/pr';
import { AIReview } from '../models/review';
import { PRReviewJob } from '../types';
import { getRedisConfig } from './redis-config';

class PRReviewQueue {
  private queue: Queue<PRReviewJob>;
  private worker: Worker<PRReviewJob>;
  private queueEvents: QueueEvents;

  constructor() {
    const redisConfig = getRedisConfig();

    this.queue = new Queue<PRReviewJob>('pr-review-queue', {
      connection: redisConfig,
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
        connection: redisConfig,
        concurrency: 5,
      }
    );

    this.queueEvents = new QueueEvents('pr-review-queue', {
      connection: redisConfig,
    });

    this.setupEventListeners();
    this.setupWorkerEventListeners();
  }

  
  private async processPRReviewJob(job: Job<PRReviewJob>): Promise<void> {
    const { jobId, installationId, repoFullName, prNumber, headSha, action } = job.data;

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
          const prContext = await processPRReviewJob({
            jobId: crypto.randomUUID(),
            installationId,
            repoFullName,
            prNumber,
            headSha,
            action,
          });

          const [owner, repo] = repoFullName.split('/');
          const repoRecord = await PullRequest.findOne({ repoFullName, prNumber });
          const repoId = repoRecord?.repoId || 0;

          const { EnhancedAIReviewService: EnhancedReviewService } = await import('./enhanced-ai-review');
          const enhancedAIResponse = await EnhancedReviewService.generateEnhancedReview(prContext, repoId);

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
                    (acc: { critical: number; major: number; minor: number }, comment: { severity: 'critical' | 'major' | 'minor' }) => {
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
          const updatedPrContext = await processPRReviewJob({
            jobId: crypto.randomUUID(),
            installationId,
            repoFullName,
            prNumber,
            headSha,
            action,
          });

          const [updatedOwner, updatedRepo] = repoFullName.split('/');
          const updatedRepoRecord = await PullRequest.findOne({ repoFullName, prNumber });
          const updatedRepoId = updatedRepoRecord?.repoId || 0;

          const { EnhancedAIReviewService: UpdatedEnhancedReviewService } = await import('./enhanced-ai-review');
          const updatedEnhancedAIResponse = await UpdatedEnhancedReviewService.generateEnhancedReview(updatedPrContext, updatedRepoId);

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
                    (acc: { critical: number; major: number; minor: number }, comment: { severity: 'critical' | 'major' | 'minor' }) => {
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
          break;

        default:
          // Handle unknown action types silently
      }

    } catch (error) {
      console.error(`❌ Error processing PR ${repoFullName}#${prNumber}:`, error);

      throw error;
    }
  }

  
  private setupEventListeners(): void {
    // Queue event listeners for monitoring - keeping them silent for production
    this.queueEvents.on('waiting', () => {});
    this.queueEvents.on('active', () => {});
    this.queueEvents.on('completed', () => {});
    this.queueEvents.on('failed', () => {});
    this.queueEvents.on('stalled', () => {});
  }

  
  private setupWorkerEventListeners(): void {
    this.worker.on('completed', () => {
      // Job completion logged silently
    });

    this.worker.on('failed', (job, err) => {
      console.error(`💥 Worker failed job ${job?.id}:`, err.message);
    });

    this.worker.on('error', (err) => {
      console.error('🚨 Worker error:', err);
    });
  }

  
  async addJob(jobData: PRReviewJob): Promise<Job<PRReviewJob>> {
    try {
      const job = await this.queue.add('processPR', jobData, {
        jobId: jobData.jobId,
        priority: this.getJobPriority(jobData.action),
      });

      return job;
    } catch (error) {
      console.error('Error adding job to queue:', error);
      throw error;
    }
  }

  
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

  
  async close(): Promise<void> {
    console.log('🛑 Closing PR Review Queue...');
    await this.worker.close();
    await this.queue.close();
    await this.queueEvents.close();
    console.log('✅ PR Review Queue closed');
  }
}

let prReviewQueue: PRReviewQueue | null = null;


export function getPRReviewQueue(): PRReviewQueue {
  if (!prReviewQueue) {
    prReviewQueue = new PRReviewQueue();
  }
  return prReviewQueue;
}


export function initializeQueue(): PRReviewQueue {
  console.log('🚀 Initializing PR Review Queue System...');
  return getPRReviewQueue();
}


export async function shutdownQueue(): Promise<void> {
  if (prReviewQueue) {
    await prReviewQueue.close();
    prReviewQueue = null;
  }
}
