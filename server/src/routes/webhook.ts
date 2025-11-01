import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getPRReviewQueue } from '../utils/queue';
import { PullRequest } from '../models/pr';
import { Installation } from '../models/installation';
import { GitHubWebhookJob } from '../types';

const router = Router();


/**
 * Verify HMAC signature of GitHub webhook payload
 */
function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', secret);
  const digest = Buffer.from('sha256=' + hmac.update(payload).digest('hex'), 'utf8');
  const checksum = Buffer.from(signature, 'utf8');

  return crypto.timingSafeEqual(digest, checksum);
}

/**
 * Extract job data from GitHub pull_request webhook payload
 */
function extractPullRequestJob(payload: any): GitHubWebhookJob | null {
  if (!payload.action || !payload.pull_request) return null;

  const installationId = payload.installation?.id;
  const repoFullName = payload.repository?.full_name;
  const prNumber = payload.pull_request?.number;
  const headSha = payload.pull_request?.head?.sha;
  const action = payload.action;

  if (!installationId || !repoFullName || !prNumber || !headSha || !action) return null;

  const jobId = crypto
    .createHash('sha256')
    .update(`${installationId}${repoFullName}${prNumber}${headSha}`)
    .digest('hex');

  return {
    jobId,
    installationId,
    repoFullName,
    prNumber,
    headSha,
    action,
  };
}

/**
 * GitHub Webhook Handler
 * Endpoint: POST /webhook/github
 */
router.post('/github', async (req: Request, res: Response) => {
  const event = req.headers['x-github-event'] as string;
  const deliveryId = req.headers['x-github-delivery'] as string;
  const signature = req.headers['x-hub-signature-256'] as string;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  console.log('📥 Incoming GitHub webhook received:', {
    event,
    deliveryId,
    signature: signature ? signature.substring(0, 10) + '...' : 'none',
    timestamp: new Date().toISOString()
  });

  try {
    if (!secret) {
      console.error('❌ GITHUB_WEBHOOK_SECRET not configured');
      return res.status(500).send('Server configuration error');
    }

    if (event !== 'pull_request') {
      console.log('⚠️ Ignoring non-pull_request event:', event);
      return res.status(400).send('Unsupported event type');
    }

    const payload = JSON.stringify(req.body);
    if (!verifyWebhookSignature(payload, signature, secret)) {
      console.error('❌ HMAC verification failed for delivery:', deliveryId);
      return res.status(401).send('Invalid signature');
    }

    console.log('✅ HMAC verification successful');

    const job = extractPullRequestJob(req.body);
    if (!job) {
      console.error('❌ Invalid pull_request payload structure');
      return res.status(400).send('Invalid pull_request payload');
    }

    const installation = await Installation.findOne({ installationId: job.installationId });
    if (!installation) {
      console.error(`❌ Installation ${job.installationId} not found in database`);
      return res.status(400).send('Installation not found');
    }

    const prData = req.body.pull_request;
    const repoId = req.body.repository?.id;

    if (!repoId) {
      console.error('❌ Repository ID not found in webhook payload');
      return res.status(400).send('Invalid repository data');
    }

    const prRecord = await PullRequest.findOneAndUpdate(
      {
        repoId,
        repoFullName: job.repoFullName,
        prNumber: job.prNumber
      },
      {
        repoId,
        repoFullName: job.repoFullName,
        prNumber: job.prNumber,
        installation: installation._id,
        title: prData.title || '',
        author: prData.user?.login || '',
        merged: prData.merged || false,
        state: prData.state || 'open'
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    console.log(`📋 PullRequest record ${prRecord.isNew ? 'created' : 'updated'}: ${job.repoFullName}#${job.prNumber}`);

    const queue = getPRReviewQueue();
    await queue.addJob(job);

    console.log('📋 Job enqueued to pr-review-queue:', {
      jobId: job.jobId,
      installationId: job.installationId,
      repoFullName: job.repoFullName,
      prNumber: job.prNumber,
      action: job.action,
      headSha: job.headSha.substring(0, 8) + '...'
    });

    return res.status(200).json({
      success: true,
      message: 'Pull request job enqueued successfully',
      data: {
        jobId: job.jobId,
        status: 'enqueued'
      }
    });

  } catch (error) {
    console.error('❌ Error processing GitHub webhook:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing webhook'
    });
  }
});

export default router;
