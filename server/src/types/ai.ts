/**
 * AI-related types and interfaces
 */

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

export const AIReviewSchema = {
  summary: { type: 'string' },
  comments: {
    type: 'array',
    items: {
      filePath: { type: 'string' },
      line: { type: 'number' },
      suggestion: { type: 'string' },
      severity: { enum: ['low', 'medium', 'high'] }
    }
  }
};

export type AIReviewResponse = {
  summary: string;
  comments: AIReviewComment[];
};

export interface CompleteAIResponse {
  request: {
    prContext: PRContext;
    prompt: string;
    timestamp: string;
    model: string;
    temperature: number;
    maxTokens: number;
  };
  response: {
    raw: string;
    parsed: AIReviewResponse | null;
    validationErrors: string[] | null;
    timestamp: string;
    processingTimeMs: number;
  };
  metadata: {
    success: boolean;
    error?: string;
    apiCallDuration: number;
    totalDuration: number;
  };
}
