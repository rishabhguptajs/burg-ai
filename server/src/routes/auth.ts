import { Router, Request, Response } from 'express';
import axios from 'axios';
import { User } from '../models/user';
import { generateTokenPair, verifyToken, extractTokenFromHeader } from '../utils/jwt';
import { authenticateToken } from '../middleware/auth';
import { Installation } from '../models/installation';

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;

/**
 * GET /auth/github
 * Initiate GitHub OAuth flow
 */
router.get('/github', (req: Request, res: Response) => {
  if (!GITHUB_CLIENT_ID) {
    return res.status(500).json({ error: 'GitHub OAuth not configured' });
  }

  const scopes = ['read:user', 'user:email'];
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=${scopes.join('%20')}&response_type=code`;

  return res.redirect(githubAuthUrl);
});

/**
 * GET /auth/github/callback
 * Handle GitHub OAuth callback
 */
router.get('/github/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/auth/error?error=${error}`);
  }

  if (!code || typeof code !== 'string') {
    return res.redirect(`${FRONTEND_URL}/auth/error?error=no_code`);
  }

  try {
    const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }, {
      headers: {
        Accept: 'application/json',
      },
    });

    const { access_token, token_type } = tokenResponse.data;

    if (!access_token) {
      return res.redirect(`${FRONTEND_URL}/auth/error?error=no_token`);
    }

    const userResponse = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `${token_type} ${access_token}`,
      },
    });

    const githubUser = userResponse.data;

    const emailsResponse = await axios.get('https://api.github.com/user/emails', {
      headers: {
        Authorization: `${token_type} ${access_token}`,
      },
    });

    const primaryEmail = emailsResponse.data.find((email: any) => email.primary)?.email;

    let user = await User.findOne({ githubId: githubUser.id });

    if (user) {
      user.username = githubUser.login;
      user.email = primaryEmail;
      user.avatarUrl = githubUser.avatar_url;
      user.githubAccessToken = access_token;
      user.tokenExpiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    } else {
      user = new User({
        githubId: githubUser.id,
        username: githubUser.login,
        email: primaryEmail,
        avatarUrl: githubUser.avatar_url,
        githubAccessToken: access_token,
        tokenExpiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        monthlyUsageCount: 0,
        monthlyResetDate: new Date(),
        dailyUsageCount: 0,
        dailyResetDate: new Date(),
      });
    }

    await user.save();

    const tokens = generateTokenPair(user);

    const redirectUrl = `${FRONTEND_URL}/auth/success?access_token=${tokens.accessToken}&refresh_token=${tokens.refreshToken}&expires_in=${tokens.expiresIn}`;
    return res.redirect(redirectUrl);

  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.redirect(`${FRONTEND_URL}/auth/error?error=oauth_failed`);
  }
});

/**
 * GET /auth/me
 */
router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  const user = req.user;

  return res.json({
    user: {
      id: user._id,
      githubId: user.githubId,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      usage: {
        monthly: user.monthlyUsageCount,
        monthlyLimit: 10,
        monthlyResetDate: user.monthlyResetDate,
        daily: user.dailyUsageCount,
        dailyLimit: 3,
        dailyResetDate: user.dailyResetDate,
      },
    },
  });
});

/**
 * POST /auth/associate-installations
 * Associate GitHub App installations with the authenticated user
 */
router.post('/associate-installations', authenticateToken, async (req: Request, res: Response) => {
  const user = req.user;

  try {
    const installations = await Installation.find({
      accountLogin: user.username,
      accountType: 'User',
      user: { $exists: false }
    });

    if (installations.length === 0) {
      return res.json({
        message: 'No installations found to associate',
        associated: 0
      });
    }

    const updateResult = await Installation.updateMany(
      {
        accountLogin: user.username,
        accountType: 'User',
        user: { $exists: false }
      },
      { user: user._id }
    );

    const installationIds = installations.map(inst => inst._id);
    await User.findByIdAndUpdate(user._id, {
      $addToSet: { installations: { $each: installationIds } }
    });

    return res.json({
      message: `Successfully associated ${updateResult.modifiedCount} installations`,
      associated: updateResult.modifiedCount
    });

  } catch (error) {
    console.error('Associate installations error:', error);
    return res.status(500).json({ error: 'Failed to associate installations' });
  }
});

/**
 * POST /auth/refresh
 * Refresh access token using refresh token
 */
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  const payload = verifyToken(refreshToken);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  try {
    const user = await User.findById(payload.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const tokens = generateTokenPair(user);
    return res.json(tokens);
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
