import { Router, Request, Response } from 'express';
import { getPRReviewQueue } from '../../utils/queue';
import axios from 'axios';
import { Installation } from '../../models/installation';
import { PullRequest } from '../../models/pr';
import { AIReview } from '../../models/review';
import { QueueTask } from '../../models/queuetask';

const router = Router();

router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, installation_id, state } = req.query as { code?: string; installation_id?: string; state?: string };

    if (!code || !installation_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: code and installation_id are required'
      });
    }

    const codeStr = code;
    const installationIdStr = installation_id;
    const stateStr = state || '';

    if (!codeStr || !installationIdStr) {
      return res.status(400).json({
        success: false,
        message: 'Invalid parameter types: code and installation_id must be strings'
      });
    }

    const installationId = parseInt(installationIdStr);
    if (isNaN(installationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid installation_id: must be a number'
      });
    }

    console.log('🔄 Processing GitHub App Installation:', {
      installationId,
      code: codeStr ? codeStr.substring(0, 10) + '...' : 'undefined',
      state: stateStr,
      timestamp: new Date().toISOString()
    });

    const clientId = process.env.GITHUB_APP_CLIENT_ID;
    const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error('❌ GitHub App client credentials not configured');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error: GitHub App credentials missing'
      });
    }

    console.log('🔑 Exchanging code for access token...');

    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: clientId,
        client_secret: clientSecret,
        code: codeStr
      },
      {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );

    const { access_token, token_type, scope } = tokenResponse.data;

    if (!access_token) {
      console.error('❌ Failed to obtain access token:', tokenResponse.data);
      return res.status(500).json({
        success: false,
        message: 'Failed to obtain access token from GitHub'
      });
    }

    console.log('✅ Access token obtained successfully');

    console.log('💾 Storing installation in database...');

    const installation = await Installation.findOneAndUpdate(
      { installationId },
      {
        installationId,
        accountType: 'unknown',
        accountLogin: 'unknown',
        repositories: [],
        accessToken: access_token,
        accessTokenExpiresAt: null,
        updatedAt: new Date()
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    console.log('✅ Installation stored successfully:', {
      id: installation._id,
      installationId: installation.installationId,
      accessToken: access_token.substring(0, 10) + '...'
    });

    return res.json({
      success: true,
      message: 'GitHub App installation completed successfully',
      data: {
        installationId: installation.installationId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error in GitHub callback:', error);

    if (axios.isAxiosError(error)) {
      console.error('GitHub API Error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });

      if (error.response?.status === 401) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired installation code'
        });
      }

      if (error.response?.status === 404) {
        return res.status(404).json({
          success: false,
          message: 'Installation not found'
        });
      }
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error during GitHub callback processing'
    });
  }
});

router.get('/queue/stats', async (req: Request, res: Response) => {
  try {
    const queue = getPRReviewQueue();
    const stats = await queue.getStats();

    res.json({
      success: true,
      message: 'Queue statistics retrieved successfully',
      data: {
        stats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error retrieving queue stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving queue statistics'
    });
  }
});

router.get('/installations', async (req: Request, res: Response) => {
  try {
    const installations = await Installation.find({}, {
      accessToken: 0,
      accessTokenExpiresAt: 0
    });

    res.json({
      success: true,
      message: 'Installations retrieved successfully',
      data: {
        installations,
        count: installations.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error retrieving installations:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving installations'
    });
  }
});

router.get('/setup', (req: Request, res: Response) => {
  const appId = process.env.GITHUB_APP_ID;
  const clientId = process.env.GITHUB_APP_CLIENT_ID;

  if (!appId || !clientId) {
    return res.status(500).json({
      success: false,
      message: 'GitHub App not configured on server',
      data: {
        configured: false,
        missing: {
          appId: !appId,
          clientId: !clientId
        }
      }
    });
  }

  const installUrl = `https://github.com/apps/${process.env.GITHUB_APP_SLUG || 'your-app-slug'}/installations/new`;

  return res.json({
    success: true,
    message: 'GitHub App setup information',
    data: {
      configured: true,
      appId: parseInt(appId),
      clientId,
      installUrl,
      setupInstructions: [
        '1. Visit the install URL above',
        '2. Select repositories to install the app on',
        '3. Complete the installation',
        '4. The app will automatically redirect back to the callback URL'
      ],
      timestamp: new Date().toISOString()
    }
  });
});

router.get('/pull-requests', async (req: Request, res: Response) => {
  try {
    const { repo, installationId, status, limit = 50 } = req.query;

    const query: any = {};
    if (repo) query.repoFullName = repo;
    if (installationId) query.installation = installationId;
    if (status) query.state = status;

    const prs = await PullRequest.find(query)
      .populate('installation', 'accountLogin accountType')
      .populate('aiReviews', 'status createdAt')
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit as string));

    res.json({
      success: true,
      message: 'Pull requests retrieved successfully',
      data: {
        pullRequests: prs,
        count: prs.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error retrieving pull requests:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving pull requests'
    });
  }
});

router.get('/reviews', async (req: Request, res: Response) => {
  try {
    const { prId, status, limit = 50 } = req.query;

    const query: any = {};
    if (prId) query.pullRequest = prId;
    if (status) query.status = status;

    const reviews = await AIReview.find(query)
      .populate('pullRequest', 'repoFullName prNumber title')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string));

    res.json({
      success: true,
      message: 'AI reviews retrieved successfully',
      data: {
        reviews,
        count: reviews.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error retrieving AI reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving AI reviews'
    });
  }
});

router.get('/queue-tasks', async (req: Request, res: Response) => {
  try {
    const { status, limit = 50 } = req.query;

    const query: any = {};
    if (status) query.status = status;

    const tasks = await QueueTask.find(query)
      .populate('pullRequest', 'repoFullName prNumber title')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string));

    res.json({
      success: true,
      message: 'Queue tasks retrieved successfully',
      data: {
        tasks,
        count: tasks.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error retrieving queue tasks:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving queue tasks'
    });
  }
});

router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'GitHub routes are operational',
    data: {
      timestamp: new Date().toISOString(),
      endpoints: {
        callback: '/api/github/callback',
        'queue/stats': '/api/github/queue/stats',
        installations: '/api/github/installations',
        'pull-requests': '/api/github/pull-requests',
        reviews: '/api/github/reviews',
        'queue-tasks': '/api/github/queue-tasks',
        setup: '/api/github/setup',
        health: '/api/github/health'
      }
    }
  });
});

export default router;
