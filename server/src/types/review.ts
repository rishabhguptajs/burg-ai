/**
 * Review-related types and interfaces
 */

export interface ReviewComment {
  filePath: string;
  line: number;
  severity: 'critical' | 'major' | 'minor';
  message: string;
  rationale: string;
  suggestion?: string;
}

export interface StructuredAIReview {
  summary: string;
  comments: ReviewComment[];
  metadata?: {
    totalComments: number;
    severityBreakdown: {
      critical: number;
      major: number;
      minor: number;
    };
    analysisTime: number;
  };
}
