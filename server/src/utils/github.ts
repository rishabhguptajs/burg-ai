import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from 'octokit';
import { Installation } from '../models/installation';

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

/**
 * Get GitHub App authentication configuration
 */
function getGitHubAppAuth() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error('GITHUB_APP_ID and GITHUB_PRIVATE_KEY environment variables are required');
  }

  return {
    appId: parseInt(appId),
    privateKey: privateKey.replace(/\\n/g, '\n'), // Handle escaped newlines
  };
}

/**
 * Get installation access token for a specific installation
 * First tries to get from database, falls back to JWT authentication
 */
async function getInstallationToken(installationId: number): Promise<string> {
  try {
    console.log(`🔑 Fetching installation token for installation ${installationId}`);

    const installation = await Installation.findOne({ installationId });

    if (installation && installation.accessToken) {
      console.log(`✅ Found stored token for installation ${installationId}`);
      return installation.accessToken;
    }

    console.log(`⚠️ No stored token found, generating new JWT token for ${installationId}`);

    const auth = getGitHubAppAuth();

    const appAuth = createAppAuth({
      appId: auth.appId,
      privateKey: auth.privateKey,
    });

    const installationAuth = await appAuth({
      type: 'installation',
      installationId,
    });

    console.log(`✅ Successfully obtained JWT token for ${installationId}`);
    return installationAuth.token;
  } catch (error) {
    console.error(`❌ Failed to get installation token for ${installationId}:`, error);
    throw new Error(`Failed to authenticate with GitHub installation ${installationId}`);
  }
}

/**
 * Create Octokit instance with installation token
 */
function createOctokitWithToken(token: string): Octokit {
  return new Octokit({
    auth: token,
  });
}

/**
 * Fetch PR metadata and changed files from GitHub
 */
async function fetchPRData(
  octokit: Octokit,
  repoFullName: string,
  prNumber: number
): Promise<PRContext> {
  try {
    console.log(`📥 Fetching PR data for ${repoFullName}#${prNumber}`);
    console.log(`🔍 Octokit instance received:`, !!octokit, typeof octokit);

    // Split repo name
    const [owner, repo] = repoFullName.split('/');

    // Fetch PR details
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Fetch changed files
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100, // Limit to 100 files for now
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

    console.log(`✅ Successfully fetched PR data: ${pr.title} (${changedFiles.length} files changed)`);
    return prContext;

  } catch (error) {
    console.error(`❌ Failed to fetch PR data for ${repoFullName}#${prNumber}:`, error);
    throw new Error(`Failed to fetch PR data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Process a PR review job by fetching data from GitHub
 */
export async function processPRReviewJob(jobData: {
  jobId: string;
  installationId: number;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  action: string;
}): Promise<PRContext> {
  const { jobId, installationId, repoFullName, prNumber, action } = jobData;

  console.log(`🚀 Starting PR review job: ${jobId} - ${repoFullName}#${prNumber} (${action})`);

  try {
    // Get installation token
    const token = await getInstallationToken(installationId);

    // Create Octokit instance
    const octokit = createOctokitWithToken(token);
    console.log(`🔧 Created Octokit instance:`, !!octokit, typeof octokit);

    // Fetch PR data
    const prContext = await fetchPRData(octokit, repoFullName, prNumber);

    console.log(`🎉 Successfully processed PR review job: ${jobId}`);
    return prContext;

  } catch (error) {
    console.error(`💥 Failed to process PR review job ${jobId}:`, error);
    throw error;
  }
}

/**
 * Validate GitHub App configuration
 */
export function validateGitHubAppConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  console.log(appId, privateKey);

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

/**
 * Find the diff position for a specific line number in a Git diff patch
 * This is crucial for production systems to ensure comments appear on the correct lines
 */
export function findDiffPosition(patch: string, targetLine: number): number | null {
  if (!patch) return null;

  const lines = patch.split('\n');
  let currentLine = 0; // Line number in the new file
  let position = 0; // Position in the diff (starts from 1 for first diff line)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('@@')) {
      // Parse hunk header: @@ -start,length +start,length @@
      const hunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[3]); // Start line in new file
        // Don't increment position for hunk header
        continue;
      }
    }

    // Increment position for all diff lines (after hunk header)
    position++;

    if (line.startsWith(' ')) {
      // Context line (unchanged)
      currentLine++;
    } else if (line.startsWith('+')) {
      // Addition line
      if (currentLine === targetLine) {
        return position;
      }
      currentLine++;
    } else if (line.startsWith('-')) {
      // Deletion line (doesn't count towards new file line numbers)
      // We skip deletions for line number mapping
    }
  }

  // If we can't find the exact line, try to find the closest addition line
  // This is a fallback for cases where line numbers might be slightly off
  return findClosestAdditionLine(patch, targetLine);
}

/**
 * Fallback function to find the closest addition line when exact mapping fails
 */
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

    // Increment position for diff lines only
    position++;

    if (line.startsWith('+')) {
      // Addition line
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

  // Only return if the closest line is within 5 lines
  return closestDistance <= 5 ? closestPosition : null;
}

/**
 * Post AI review to GitHub pull request
 */
export async function postAIReviewToGitHub(
  installationId: number,
  repoFullName: string,
  prNumber: number,
  aiReview: AIReview
): Promise<void> {
  console.log(`📝 Starting to post AI review to GitHub: ${repoFullName}#${prNumber}`);

  try {
    const token = await getInstallationToken(installationId);

    const octokit = createOctokitWithToken(token);

    const [owner, repo] = repoFullName.split('/');

    // Get PR data to check if author is the same as the repo owner (self-review)
    const { data: prData } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const isSelfReview = prData.user?.login === owner;
    const hasHighSeverity = aiReview.comments.some(comment => comment.severity === 'high');

    // Can't request changes on your own PR, so use COMMENT instead
    const event = (hasHighSeverity && !isSelfReview) ? 'REQUEST_CHANGES' : 'COMMENT';

    console.log(`🔍 Review event: ${event} (${hasHighSeverity ? 'has high severity issues' : 'no high severity issues'}${isSelfReview ? ', self-review (using COMMENT)' : ''})`);

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

    console.log(`✅ Successfully posted AI review to ${repoFullName}#${prNumber} (${aiReview.comments.length} comments)`);

    if (aiReview.comments.length > 0) {
      console.log(`💬 Posting ${aiReview.comments.length} inline comments with production diff position mapping...`);

      // PR data already fetched above, reuse it

      // Get individual file diffs for each file we need to comment on
      const filesToComment = [...new Set(aiReview.comments.map(c => c.filePath))];

      for (const filePath of filesToComment) {
        try {
          // Get the diff for this specific file
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

          // Process comments for this file
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
                side: 'RIGHT' // Comment on the right side (new code)
              });

              console.log(`✅ Posted inline comment on ${filePath}:${comment.line}`);
            } catch (commentError) {
              console.error(`❌ Failed to post inline comment on ${filePath}:${comment.line}:`, commentError);
              // Continue with other comments even if one fails
            }
          }

        } catch (fileError) {
          console.error(`❌ Failed to process comments for file ${filePath}:`, fileError);
          // Continue with other files
        }
      }

      console.log(`✅ Finished posting inline comments`);
    }

  } catch (error) {
    console.error(`❌ Failed to post AI review to GitHub ${repoFullName}#${prNumber}:`, error);

    if (error instanceof Error) {
      throw new Error(`Failed to post review to GitHub: ${error.message}`);
    }

    throw new Error('Failed to post review to GitHub: Unknown error');
  }
}
