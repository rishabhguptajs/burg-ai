/**
 * Queue-related types and interfaces
 */

export interface PRReviewJob {
  jobId: string;
  installationId: number;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  action: string;
}

export interface GitHubWebhookJob {
  jobId: string;
  installationId: number;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  action: string;
}
