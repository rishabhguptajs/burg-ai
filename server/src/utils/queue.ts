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
    // Initialize queue with Redis connection
    this.queue = new Queue<PRReviewJob>('pr-review-queue', {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
      defaultJobOptions: {
        removeOnComplete: 50, // Keep last 50 completed jobs
        removeOnFail: 100,    // Keep last 100 failed jobs
        attempts: 3,          // Max 3 attempts per job
        backoff: {
          type: 'exponential',
          delay: 2000,        // Initial delay 2 seconds
        },
      },
    });

    // Initialize worker
    this.worker = new Worker<PRReviewJob>(
      'pr-review-queue',
      this.processPRReviewJob.bind(this),
      {
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        },
        concurrency: 5, // Process up to 5 jobs concurrently
      }
    );

    // Initialize queue events for monitoring
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
      // Import the GitHub service
      const { processPRReviewJob, validateGitHubAppConfig } = await import('./github');

      // Validate GitHub App configuration
      const configValidation = validateGitHubAppConfig();
      if (!configValidation.isValid) {
        throw new Error(`GitHub App configuration invalid: ${configValidation.errors.join(', ')}`);
      }

      // Process based on action
      switch (action) {
        case 'opened':
          console.log(`📝 Processing opened PR: ${repoFullName}#${prNumber}`);

          // Fetch PR data and perform review
          const prContext = await processPRReviewJob({
            jobId: crypto.randomUUID(), // Generate temporary jobId for logging
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

          // Generate AI-powered review - NOW RETURNS EVERYTHING AS JSON
          const { generatePRReview: generateAIReview } = await import('./ai');
          const completeAIResponse = await generateAIReview(prContext);

          console.log(`🎯 AI Review completed:`, completeAIResponse.response.parsed || { error: 'No parsed response' });

          // Store AI review in database if parsing was successful
          let aiReviewRecord: any = null;
          if (completeAIResponse.response.parsed) {
            // Find the PR record to link the review
            const prRecord = await PullRequest.findOne({
              repoFullName,
              prNumber
            });

            if (prRecord) {
              // Create AI review record
              aiReviewRecord = await AIReview.create({
                pullRequest: prRecord._id,
                reviewer: 'AI',
                comments: completeAIResponse.response.parsed.comments.map(comment => ({
                  filePath: comment.filePath,
                  line: comment.line,
                  comment: comment.suggestion,
                  severity: comment.severity
                })),
                status: 'completed'
              });

              // Add the review to the PR's aiReviews array
              await PullRequest.findByIdAndUpdate(prRecord._id, {
                $push: { aiReviews: aiReviewRecord._id }
              });

              console.log(`💾 AI Review stored in database: ${aiReviewRecord._id}`);
            }
          }

          // Post AI review to GitHub PR
          if (completeAIResponse.response.parsed) {
            const { postAIReviewToGitHub } = await import('./github');
            await postAIReviewToGitHub(
              installationId,
              repoFullName,
              prNumber,
              completeAIResponse.response.parsed
            );
          }

          break;

        case 'synchronize':
          console.log(`🔄 Processing updated PR: ${repoFullName}#${prNumber}`);

          // Re-fetch and re-analyze PR data
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

          // Generate updated AI review - NOW RETURNS EVERYTHING AS JSON
          const { generatePRReview: generateUpdatedAIReview } = await import('./ai');
          const updatedCompleteAIResponse = await generateUpdatedAIReview(updatedPrContext);

          console.log(`🔄 Updated AI Review completed:`, updatedCompleteAIResponse.response.parsed || { error: 'No parsed response' });

          // Store updated AI review in database
          if (updatedCompleteAIResponse.response.parsed) {
            // Find the PR record to link the review
            const prRecord = await PullRequest.findOne({
              repoFullName,
              prNumber
            });

            if (prRecord) {
              // Create updated AI review record
              const updatedAiReviewRecord = await AIReview.create({
                pullRequest: prRecord._id,
                reviewer: 'AI',
                comments: updatedCompleteAIResponse.response.parsed.comments.map(comment => ({
                  filePath: comment.filePath,
                  line: comment.line,
                  comment: comment.suggestion,
                  severity: comment.severity
                })),
                status: 'completed'
              });

              // Add the updated review to the PR's aiReviews array
              await PullRequest.findByIdAndUpdate(prRecord._id, {
                $push: { aiReviews: updatedAiReviewRecord._id }
              });

              console.log(`💾 Updated AI Review stored in database: ${updatedAiReviewRecord._id}`);
            }
          }

          // Post updated AI review to GitHub PR
          if (updatedCompleteAIResponse.response.parsed) {
            const { postAIReviewToGitHub } = await import('./github');
            await postAIReviewToGitHub(
              installationId,
              repoFullName,
              prNumber,
              updatedCompleteAIResponse.response.parsed
            );
          }

          break;

        case 'closed':
          console.log(`🔒 Processing closed PR: ${repoFullName}#${prNumber}`);
          // TODO: Cleanup resources, archive review data
          break;

        default:
          console.log(`📋 Processing PR ${action}: ${repoFullName}#${prNumber}`);
      }

    } catch (error) {
      console.error(`❌ Error processing PR ${repoFullName}#${prNumber}:`, error);

      // Re-throw to trigger BullMQ retry logic
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
        jobId: jobData.jobId, // Use custom jobId for deduplication
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
        return 10; // High priority for new PRs
      case 'synchronize':
        return 5;  // Medium priority for updates
      case 'closed':
        return 1;  // Low priority for closed PRs
      default:
        return 5;  // Default medium priority
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

// Singleton instance
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
