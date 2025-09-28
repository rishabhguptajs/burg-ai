import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  coerceTypes: false,
  useDefaults: false,
  strict: true
});
addFormats(ajv);

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

const reviewCommentSchema = {
  type: 'object',
  properties: {
    filePath: {
      type: 'string',
      minLength: 1,
      description: 'Relative path to the file being reviewed'
    },
    line: {
      type: 'integer',
      minimum: 1,
      description: 'Line number in the file where the issue occurs'
    },
    severity: {
      type: 'string',
      enum: ['critical', 'major', 'minor'],
      description: 'Severity level: critical (security/bugs), major (performance/maintainability), minor (style/nits)'
    },
    message: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
      description: 'Concise description of the issue or improvement'
    },
    rationale: {
      type: 'string',
      minLength: 10,
      maxLength: 1000,
      description: 'Explanation of why this matters, including risks if unfixed'
    },
    suggestion: {
      type: 'string',
      maxLength: 2000,
      description: 'Optional concrete code suggestion or approach to fix the issue'
    }
  },
  required: ['filePath', 'line', 'severity', 'message', 'rationale'],
  additionalProperties: false
};

const structuredAIReviewSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      minLength: 10,
      maxLength: 2000,
      description: 'Overall assessment of the pull request'
    },
    comments: {
      type: 'array',
      items: reviewCommentSchema,
      maxItems: 50,
      description: 'Array of review comments with structured feedback'
    },
    metadata: {
      type: 'object',
      properties: {
        totalComments: {
          type: 'integer',
          minimum: 0,
          description: 'Total number of comments generated'
        },
        severityBreakdown: {
          type: 'object',
          properties: {
            critical: { type: 'integer', minimum: 0 },
            major: { type: 'integer', minimum: 0 },
            minor: { type: 'integer', minimum: 0 }
          },
          required: ['critical', 'major', 'minor'],
          additionalProperties: false
        },
        analysisTime: {
          type: 'integer',
          minimum: 0,
          description: 'Time taken for analysis in milliseconds'
        }
      },
      additionalProperties: false
    }
  },
  required: ['summary', 'comments'],
  additionalProperties: false
};

const validateReviewComment = ajv.compile(reviewCommentSchema);
const validateStructuredAIReview = ajv.compile(structuredAIReviewSchema);

/**
 * Validate a single review comment
 */
export function validateReviewCommentData(data: unknown): { isValid: boolean; errors?: string[]; comment?: ReviewComment } {
  const valid = validateReviewComment(data);

  if (!valid) {
    const errors = validateReviewComment.errors?.map(err => {
      const path = err.instancePath || err.schemaPath;
      return `${path}: ${err.message}`;
    }) || ['Unknown validation error'];

    return { isValid: false, errors };
  }

  return { isValid: true, comment: data as unknown as ReviewComment };
}

/**
 * Validate complete AI review response
 */
export function validateStructuredAIReviewData(data: unknown): { isValid: boolean; errors?: string[]; review?: StructuredAIReview } {
  const valid = validateStructuredAIReview(data);

  if (!valid) {
    const errors = validateStructuredAIReview.errors?.map(err => {
      const path = err.instancePath || err.schemaPath;
      return `${path}: ${err.message}`;
    }) || ['Unknown validation error'];

    return { isValid: false, errors };
  }

  const review = data as unknown as StructuredAIReview;
  if (!review.metadata) {
    const severityBreakdown = review.comments.reduce(
      (acc, comment) => {
        acc[comment.severity]++;
        return acc;
      },
      { critical: 0, major: 0, minor: 0 }
    );

    review.metadata = {
      totalComments: review.comments.length,
      severityBreakdown,
      analysisTime: 0
    };
  }

  return { isValid: true, review };
}

/**
 * Get severity classification rules
 */
export function getSeverityClassification(): Record<string, 'critical' | 'major' | 'minor'> {
  return {
    security: 'critical',
    vulnerability: 'critical',
    'security-issue': 'critical',
    bug: 'critical',
    error: 'critical',
    'runtime-error': 'critical',
    'null-pointer': 'critical',
    'infinite-loop': 'critical',
    crash: 'critical',
    deadlock: 'critical',

    performance: 'major',
    'memory-leak': 'major',
    optimization: 'major',
    complexity: 'major',
    maintainability: 'major',
    'code-smell': 'major',
    'technical-debt': 'major',
    scalability: 'major',
    reliability: 'major',
    'error-handling': 'major',

    style: 'minor',
    formatting: 'minor',
    naming: 'minor',
    documentation: 'minor',
    comment: 'minor',
    'code-style': 'minor',
    convention: 'minor',
    'best-practice': 'minor',
    nitpick: 'minor',
    suggestion: 'minor'
  };
}

/**
 * Classify issue severity based on keywords in the message
 */
export function classifySeverity(message: string, rationale: string): 'critical' | 'major' | 'minor' {
  const text = `${message} ${rationale}`.toLowerCase();
  const classifications = getSeverityClassification();

  for (const [keyword, severity] of Object.entries(classifications)) {
    if (severity === 'critical' && text.includes(keyword)) {
      return 'critical';
    }
  }

  for (const [keyword, severity] of Object.entries(classifications)) {
    if (severity === 'major' && text.includes(keyword)) {
      return 'major';
    }
  }

  return 'minor';
}

/**
 * Create a fallback review comment when validation fails
 */
export function createFallbackComment(
  filePath: string,
  line: number,
  rawMessage: string
): ReviewComment {
  return {
    filePath,
    line,
    severity: 'minor',
    message: 'Unable to parse AI suggestion',
    rationale: 'The AI provided feedback that could not be properly structured. Manual review recommended.',
    suggestion: rawMessage.substring(0, 500) 
  };
}
