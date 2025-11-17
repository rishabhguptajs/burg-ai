import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getPRReviewQueue } from '../utils/queue';
import { PullRequest } from '../models/pr';
import { Installation } from '../models/installation';
import { GitHubWebhookJob } from '../types';
import { checkUsageLimits, trackUsage } from '../middleware/usage';
import { User } from '../models/user';

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
 * Handle GitHub App installation events
 */
async function handleInstallationEvent(req: Request, res: Response) {
  const action = req.body.action;
  const installation = req.body.installation;
  const repositories = req.body.repositories || [];

  console.log(`🔧 Installation ${action}:`, {
    installationId: installation?.id,
    account: installation?.account?.login,
    repositoryCount: repositories.length
  });

  try {
    if (action === 'created') {

      const installationRecord = await Installation.findOneAndUpdate(
        { installationId: installation.id },
        {
          installationId: installation.id,
          accountType: installation.account.type,
          accountLogin: installation.account.login,
          repositories: repositories.map((repo: any) => repo.full_name),
          accessToken: null, 
          accessTokenExpiresAt: null,
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );

      console.log(`✅ Installation ${installation.id} created/updated`);

      return res.status(200).json({
        success: true,
        message: 'Installation processed',
        data: {
          installationId: installation.id,
          account: installation.account.login
        }
      });

    } else if (action === 'deleted') {
      await Installation.findOneAndDelete({ installationId: installation.id });
      console.log(`🗑️ Installation ${installation.id} deleted`);

      return res.status(200).json({
        success: true,
        message: 'Installation deleted'
      });
    }

    return res.status(200).json({ success: true, message: 'Installation event processed' });

  } catch (error) {
    console.error('❌ Error processing installation event:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing installation event'
    });
  }
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

    if (event !== 'pull_request' && event !== 'installation') {
      return res.status(400).send('Unsupported event type');
    }

    if (event === 'installation') {
      return handleInstallationEvent(req, res);
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

    const installation = await Installation.findOne({ installationId: job.installationId }).populate('user');
    if (!installation) {
      console.error(`❌ Installation ${job.installationId} not found in database`);
      return res.status(400).send('Installation not found');
    }

    if (!installation.user) {
      console.error(`❌ Installation ${job.installationId} not associated with any user`);
      return res.status(403).json({
        error: 'Installation not authorized',
        message: 'This GitHub App installation is not associated with an authenticated user. Please authenticate first.'
      });
    }

    const user = installation.user as any;
    const usageCheck = await checkUsageLimits(user.githubId);
    if (!usageCheck.allowed) {
      console.warn(`⚠️ Usage limit exceeded for user ${user.githubId}: monthly ${usageCheck.monthlyCount}/${usageCheck.monthlyLimit}, daily ${usageCheck.dailyCount}/${usageCheck.dailyLimit}`);

      return res.status(429).json({
        error: 'Usage limit exceeded',
        message: `Monthly limit: ${usageCheck.monthlyCount}/${usageCheck.monthlyLimit} reviews used. Daily limit: ${usageCheck.dailyCount}/${usageCheck.dailyLimit} reviews used.`,
        limits: {
          monthly: {
            used: usageCheck.monthlyCount,
            limit: usageCheck.monthlyLimit
          },
          daily: {
            used: usageCheck.dailyCount,
            limit: usageCheck.dailyLimit
          }
        }
      });
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

    const queue = getPRReviewQueue();
    await queue.addJob(job);

    await trackUsage({ user } as any);

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
