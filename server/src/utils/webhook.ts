import crypto from 'crypto';

export interface GitHubWebhookJob {
  jobId: string;
  installationId: number;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  action: string;
}

/**
 * Verifies the HMAC signature of a GitHub webhook payload
 */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', secret);
  const digest = Buffer.from('sha256=' + hmac.update(payload).digest('hex'), 'utf8');
  const checksum = Buffer.from(signature, 'utf8');

  return crypto.timingSafeEqual(digest, checksum);
}

/**
 * Extracts job data from GitHub pull_request webhook payload
 */
export function extractPullRequestJob(payload: any): GitHubWebhookJob | null {
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
