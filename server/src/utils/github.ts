import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from 'octokit';
import { Installation } from '../models/installation';
import { StructuredAIReview, ReviewComment } from '../types';

export interface PRContext {
  repo: string;
  prNumber: number;
  title: string;
  description: string;
  changedFiles: {
    path: string;
    patch: string;
    additions: number;
    deletions: number;
  }[];
}

export interface AIReviewComment {
  filePath: string;
  line: number;
  suggestion: string;
  severity: 'low' | 'medium' | 'high';
}

export interface AIReview {
  summary: string;
  comments: AIReviewComment[];
}


function getGitHubAppAuth() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error('GITHUB_APP_ID and GITHUB_PRIVATE_KEY environment variables are required');
  }

  let processedKey = privateKey;
  if (privateKey.includes('\\n')) {
    processedKey = privateKey.replace(/\\n/g, '\n');
  } else if (!privateKey.includes('\n') && privateKey.length > 64) {
    processedKey = privateKey.replace(/\\n/g, '\n');
  }

  return {
    appId: parseInt(appId),
    privateKey: processedKey,
  };
}


async function getInstallationToken(installationId: number): Promise<string> {
  try {
    const installation = await Installation.findOne({ installationId });

    if (installation && installation.accessToken && installation.accessTokenExpiresAt) {
      const now = new Date();
      const expiresAt = new Date(installation.accessTokenExpiresAt);

      if (expiresAt > now) {
        return installation.accessToken;
      }
    }

    const auth = getGitHubAppAuth();

    const appAuth = createAppAuth({
      appId: auth.appId,
      privateKey: auth.privateKey,
    });

    const installationAuth = await appAuth({
      type: 'installation',
      installationId,
    });

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await Installation.findOneAndUpdate(
      { installationId },
      {
        accessToken: installationAuth.token,
        accessTokenExpiresAt: expiresAt
      },
      { upsert: true, new: true }
    );

    return installationAuth.token;
  } catch (error) {
    console.error(`❌ Failed to get installation token for ${installationId}:`, error);
    throw new Error(`Failed to authenticate with GitHub installation ${installationId}`);
  }
}


function createOctokitWithToken(token: string): Octokit {
  return new Octokit({
    auth: token,
  });
}


async function fetchPRData(
  octokit: Octokit,
  repoFullName: string,
  prNumber: number
): Promise<PRContext> {
  try {
    const [owner, repo] = repoFullName.split('/');

    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    const changedFiles = files.map((file: any) => ({
      path: file.filename,
      patch: file.patch || '',
      additions: file.additions,
      deletions: file.deletions,
    }));

    const prContext: PRContext = {
      repo: repoFullName,
      prNumber,
      title: pr.title,
      description: pr.body || '',
      changedFiles,
    };

    return prContext;

  } catch (error) {
    console.error(`❌ Failed to fetch PR data for ${repoFullName}#${prNumber}:`, error);
    throw new Error(`Failed to fetch PR data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}


export async function processPRReviewJob(jobData: {
  jobId: string;
  installationId: number;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  action: string;
}): Promise<PRContext> {
  const { jobId, installationId, repoFullName, prNumber, action } = jobData;

  try {
    const token = await getInstallationToken(installationId);

    const octokit = createOctokitWithToken(token);

    const prContext = await fetchPRData(octokit, repoFullName, prNumber);

    return prContext;

  } catch (error) {
    console.error(`💥 Failed to process PR review job ${jobId}:`, error);
    throw error;
  }
}


export function validateGitHubAppConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId) {
    errors.push('GITHUB_APP_ID environment variable is required');
  } else if (isNaN(parseInt(appId))) {
    errors.push('GITHUB_APP_ID must be a valid number');
  }

  if (!privateKey) {
    errors.push('GITHUB_PRIVATE_KEY environment variable is required');
  } else if (!privateKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    errors.push('GITHUB_PRIVATE_KEY does not appear to be a valid RSA private key');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}


export function findDiffPosition(patch: string, targetLine: number): number | null {
  if (!patch) return null;

  const lines = patch.split('\n');
  let currentLine = 0;
  let position = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('@@')) {
      const hunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[3]);
        continue;
      }
    }

    position++;

    if (line.startsWith(' ')) {
      currentLine++;
    } else if (line.startsWith('+')) {
      if (currentLine === targetLine) {
        return position;
      }
      currentLine++;
    } else if (line.startsWith('-')) {
    }
  }

  return findClosestAdditionLine(patch, targetLine);
}


function findClosestAdditionLine(patch: string, targetLine: number): number | null {
  if (!patch) return null;

  const lines = patch.split('\n');
  let currentLine = 0;
  let position = 0;
  let closestPosition: number | null = null;
  let closestDistance = Infinity;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('@@')) {
      const hunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[3]);
        continue;
      }
    }

    position++;

    if (line.startsWith('+')) {
      const distance = Math.abs(currentLine - targetLine);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPosition = position;
      }
      currentLine++;
    } else if (line.startsWith(' ')) {
      currentLine++;
    }
  }

  return closestDistance <= 5 ? closestPosition : null;
}


export async function postAIReviewToGitHub(
  installationId: number,
  repoFullName: string,
  prNumber: number,
  aiReview: AIReview
): Promise<void> {

  try {
    const token = await getInstallationToken(installationId);

    const octokit = createOctokitWithToken(token);

    const [owner, repo] = repoFullName.split('/');

    const { data: prData } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const isSelfReview = prData.user?.login === owner;
    const hasHighSeverity = aiReview.comments.some(comment => comment.severity === 'high');

    const event = (hasHighSeverity && !isSelfReview) ? 'REQUEST_CHANGES' : 'COMMENT';

    let reviewBody = `## AI Code Review Summary\n\n${aiReview.summary}\n\n`;

    if (aiReview.comments.length > 0) {
      reviewBody += `### Found ${aiReview.comments.length} issue${aiReview.comments.length === 1 ? '' : 's'}:\n\n`;
      aiReview.comments.forEach((comment, index) => {
        const severityEmoji = comment.severity === 'high' ? '🔴' :
                             comment.severity === 'medium' ? '🟡' : '🟢';
        reviewBody += `${index + 1}. **${comment.severity.toUpperCase()}** ${severityEmoji}: ${comment.suggestion}\n`;
      });
      reviewBody += '\n---\n*This review was generated by AI. Please review the suggestions carefully.*';
    }

            await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body: reviewBody,
      event: event as 'COMMENT' | 'REQUEST_CHANGES'
    });

    if (aiReview.comments.length > 0) {


      const filesToComment = [...new Set(aiReview.comments.map(c => c.filePath))];

      for (const filePath of filesToComment) {
        try {
          const { data: fileDiff } = await octokit.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: prNumber,
            per_page: 100
          });

          const fileDiffData = fileDiff.find((f: any) => f.filename === filePath);

          if (!fileDiffData?.patch) {
            console.warn(`⚠️ No diff available for ${filePath}, using fallback line-based comments`);
            continue;
          }

          const fileComments = aiReview.comments.filter(c => c.filePath === filePath);

          for (const comment of fileComments) {
            try {
              await octokit.rest.pulls.createReviewComment({
                owner,
                repo,
                pull_number: prNumber,
                body: `**${comment.severity.toUpperCase()}**: ${comment.suggestion}`,
                commit_id: prData.head.sha,
                path: filePath,
                line: comment.line,
                side: 'RIGHT'
              });

              // Comment posted successfully
            } catch (commentError) {
              console.error(`❌ Failed to post inline comment on ${filePath}:${comment.line}:`, commentError);
            }
          }

        } catch (fileError) {
          console.error(`❌ Failed to process comments for file ${filePath}:`, fileError);
        }
      }
    }

  } catch (error) {
    console.error(`❌ Failed to post AI review to GitHub ${repoFullName}#${prNumber}:`, error);

    if (error instanceof Error) {
      throw new Error(`Failed to post review to GitHub: ${error.message}`);
    }

    throw new Error('Failed to post review to GitHub: Unknown error');
  }
}


export async function postStructuredAIReviewToGitHub(
  installationId: number,
  repoFullName: string,
  prNumber: number,
  aiReview: StructuredAIReview
): Promise<void> {
  try {
    const token = await getInstallationToken(installationId);
    const octokit = createOctokitWithToken(token);
    const [owner, repo] = repoFullName.split('/');

    const { data: prData } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const isSelfReview = prData.user?.login === owner;
    const hasHighSeverity = aiReview.comments.some(comment => comment.severity === 'critical');
    const hasMajorSeverity = aiReview.comments.some(comment => comment.severity === 'major');

    let event: 'COMMENT' | 'REQUEST_CHANGES' = 'COMMENT';
    if ((hasHighSeverity || hasMajorSeverity) && !isSelfReview) {
      event = 'REQUEST_CHANGES';
    }

    let reviewBody = `## 🤖 AI Code Review Summary\n\n${aiReview.summary}\n\n`;

    if (aiReview.comments.length > 0) {
      const criticalComments = aiReview.comments.filter(c => c.severity === 'critical');
      const majorComments = aiReview.comments.filter(c => c.severity === 'major');
      const minorComments = aiReview.comments.filter(c => c.severity === 'minor');

      reviewBody += `### 📊 Review Results\n\n`;
      reviewBody += `**Total Issues Found:** ${aiReview.comments.length}\n`;
      if (criticalComments.length > 0) reviewBody += `🔴 **Critical:** ${criticalComments.length}\n`;
      if (majorComments.length > 0) reviewBody += `🟡 **Major:** ${majorComments.length}\n`;
      if (minorComments.length > 0) reviewBody += `🟢 **Minor:** ${minorComments.length}\n`;

      if (criticalComments.length > 0) {
        reviewBody += `\n#### 🔴 Critical Issues\n`;
        criticalComments.forEach((comment, index) => {
          reviewBody += `${index + 1}. **${comment.message}**\n`;
          reviewBody += `   - *Why it matters:* ${comment.rationale}\n`;
          if (comment.suggestion) {
            reviewBody += `   - *Suggestion:* ${comment.suggestion}\n`;
          }
          reviewBody += `\n`;
        });
      }

      if (majorComments.length > 0) {
        reviewBody += `\n#### 🟡 Major Issues\n`;
        majorComments.forEach((comment, index) => {
          reviewBody += `${index + 1}. **${comment.message}**\n`;
          reviewBody += `   - *Why it matters:* ${comment.rationale}\n`;
          if (comment.suggestion) {
            reviewBody += `   - *Suggestion:* ${comment.suggestion}\n`;
          }
          reviewBody += `\n`;
        });
      }

      if (minorComments.length > 0) {
        reviewBody += `\n#### 🟢 Minor Issues\n`;
        minorComments.forEach((comment, index) => {
          reviewBody += `${index + 1}. **${comment.message}**\n`;
          reviewBody += `   - *Why it matters:* ${comment.rationale}\n`;
          if (comment.suggestion) {
            reviewBody += `   - *Suggestion:* ${comment.suggestion}\n`;
          }
          reviewBody += `\n`;
        });
      }

      reviewBody += `---\n*This review was generated by AI. Please review the suggestions carefully before merging.*`;
    }

    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body: reviewBody,
      event: event as 'COMMENT' | 'REQUEST_CHANGES'
    });

    if (aiReview.comments.length > 0) {

      for (const comment of aiReview.comments) {
        try {
          await octokit.rest.pulls.createReviewComment({
            owner,
            repo,
            pull_number: prNumber,
            body: `**${comment.severity.toUpperCase()}**: ${comment.message}\n\n${comment.rationale}${comment.suggestion ? `\n\n💡 **Suggestion:** ${comment.suggestion}` : ''}`,
            commit_id: prData.head.sha,
            path: comment.filePath,
            line: comment.line,
            side: 'RIGHT'
          });

          // Structured comment posted successfully
        } catch (commentError) {
          console.error(`❌ Failed to post structured inline comment on ${comment.filePath}:${comment.line}:`, commentError);
        }
      }
    }

  } catch (error) {
    console.error('❌ Failed to post structured review to GitHub:', error);

    if (error instanceof Error) {
      if (error.message.includes('Bad credentials')) {
        throw new Error('GitHub authentication failed: Invalid installation token');
      }
      if (error.message.includes('Not Found')) {
        throw new Error(`Pull request ${repoFullName}#${prNumber} not found`);
      }
      if (error.message.includes('Validation Failed')) {
        throw new Error('GitHub API validation failed: Check request parameters');
      }
    }

    throw new Error('Failed to post structured review to GitHub: Unknown error');
  }
}
