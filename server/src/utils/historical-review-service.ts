import { AIReview } from '../models/review';

/**
 * Service for retrieving historical review data to provide context for new reviews
 */
export class HistoricalReviewService {

  /**
   * Get historical reviews for a repository to provide context
   */
  static async getHistoricalReviews(repoId: number, limit: number = 10): Promise<any[]> {
    try {
      // Find all PRs for this repo and get their AI reviews
      const historicalReviews = await AIReview
        .find({
          'pullRequest.repoId': repoId,
          status: 'completed'
        })
        .populate({
          path: 'pullRequest',
          match: { repoId: repoId }
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return historicalReviews.filter(review => review.pullRequest); // Filter out reviews without PR data
    } catch (error) {
      console.error('Failed to fetch historical reviews:', error);
      return [];
    }
  }

  /**
   * Get common issues and patterns from historical reviews
   */
  static async getCommonPatterns(repoId: number, limit: number = 20): Promise<{
    securityIssues: Array<{ pattern: string; count: number; severity: string }>;
    performanceIssues: Array<{ pattern: string; count: number; severity: string }>;
    architectureIssues: Array<{ pattern: string; count: number; severity: string }>;
    codeQualityIssues: Array<{ pattern: string; count: number; severity: string }>;
  }> {
    try {
      const reviews = await this.getHistoricalReviews(repoId, limit);

      const patterns = {
        securityIssues: [] as Array<{ pattern: string; count: number; severity: string }>,
        performanceIssues: [] as Array<{ pattern: string; count: number; severity: string }>,
        architectureIssues: [] as Array<{ pattern: string; count: number; severity: string }>,
        codeQualityIssues: [] as Array<{ pattern: string; count: number; severity: string }>
      };

      const securityPatterns = new Map<string, { count: number; severity: string }>();
      const performancePatterns = new Map<string, { count: number; severity: string }>();
      const architecturePatterns = new Map<string, { count: number; severity: string }>();
      const codeQualityPatterns = new Map<string, { count: number; severity: string }>();

      for (const review of reviews) {
        if (!review.comments) continue;

        for (const comment of review.comments) {
          const message = comment.message?.toLowerCase() || '';
          const key = this.normalizeMessage(message);

          // Categorize by content
          if (this.isSecurityRelated(message)) {
            const existing = securityPatterns.get(key) || { count: 0, severity: comment.severity };
            securityPatterns.set(key, {
              count: existing.count + 1,
              severity: comment.severity
            });
          } else if (this.isPerformanceRelated(message)) {
            const existing = performancePatterns.get(key) || { count: 0, severity: comment.severity };
            performancePatterns.set(key, {
              count: existing.count + 1,
              severity: comment.severity
            });
          } else if (this.isArchitectureRelated(message)) {
            const existing = architecturePatterns.get(key) || { count: 0, severity: comment.severity };
            architecturePatterns.set(key, {
              count: existing.count + 1,
              severity: comment.severity
            });
          } else {
            const existing = codeQualityPatterns.get(key) || { count: 0, severity: comment.severity };
            codeQualityPatterns.set(key, {
              count: existing.count + 1,
              severity: comment.severity
            });
          }
        }
      }

      // Convert maps to arrays and sort by frequency
      patterns.securityIssues = Array.from(securityPatterns.entries())
        .map(([pattern, data]) => ({ pattern, count: data.count, severity: data.severity }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      patterns.performanceIssues = Array.from(performancePatterns.entries())
        .map(([pattern, data]) => ({ pattern, count: data.count, severity: data.severity }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      patterns.architectureIssues = Array.from(architecturePatterns.entries())
        .map(([pattern, data]) => ({ pattern, count: data.count, severity: data.severity }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      patterns.codeQualityIssues = Array.from(codeQualityPatterns.entries())
        .map(([pattern, data]) => ({ pattern, count: data.count, severity: data.severity }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return patterns;
    } catch (error) {
      console.error('Failed to analyze common patterns:', error);
      return {
        securityIssues: [],
        performanceIssues: [],
        architectureIssues: [],
        codeQualityIssues: []
      };
    }
  }

  /**
   * Get repository statistics for context
   */
  static async getRepoStats(repoId: number): Promise<{
    totalReviews: number;
    averageCommentsPerReview: number;
    commonSeverities: { critical: number; major: number; minor: number };
    reviewFrequency: string;
  }> {
    try {
      const reviews = await AIReview
        .find({
          'pullRequest.repoId': repoId,
          status: 'completed'
        })
        .populate('pullRequest')
        .lean();

      const totalReviews = reviews.length;
      const totalComments = reviews.reduce((sum, review) => sum + (review.comments?.length || 0), 0);
      const averageCommentsPerReview = totalReviews > 0 ? totalComments / totalReviews : 0;

      const severities = reviews.reduce(
        (acc, review) => {
          review.comments?.forEach(comment => {
            acc[comment.severity as keyof typeof acc]++;
          });
          return acc;
        },
        { critical: 0, major: 0, minor: 0 }
      );

      // Calculate review frequency (simple heuristic)
      let reviewFrequency = 'Unknown';
      if (reviews.length >= 2) {
        const sortedReviews = reviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const timeDiff = new Date(sortedReviews[0].createdAt).getTime() - new Date(sortedReviews[sortedReviews.length - 1].createdAt).getTime();
        const avgTimeBetweenReviews = timeDiff / (sortedReviews.length - 1);
        const daysBetween = avgTimeBetweenReviews / (1000 * 60 * 60 * 24);

        if (daysBetween < 1) reviewFrequency = 'Daily';
        else if (daysBetween < 7) reviewFrequency = 'Weekly';
        else if (daysBetween < 30) reviewFrequency = 'Monthly';
        else reviewFrequency = 'Infrequent';
      }

      return {
        totalReviews,
        averageCommentsPerReview: Math.round(averageCommentsPerReview * 10) / 10,
        commonSeverities: severities,
        reviewFrequency
      };
    } catch (error) {
      console.error('Failed to get repo stats:', error);
      return {
        totalReviews: 0,
        averageCommentsPerReview: 0,
        commonSeverities: { critical: 0, major: 0, minor: 0 },
        reviewFrequency: 'Unknown'
      };
    }
  }

  private static normalizeMessage(message: string): string {
    // Normalize similar messages by removing specific details
    return message
      .toLowerCase()
      .replace(/\b\d+\b/g, 'N') // Replace numbers with N
      .replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, 'VAR') // Replace variable names
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private static isSecurityRelated(message: string): boolean {
    const securityKeywords = [
      'security', 'vulnerability', 'injection', 'xss', 'csrf', 'authentication',
      'authorization', 'encrypt', 'decrypt', 'token', 'password', 'secret',
      'sanitize', 'validate', 'escape', 'sql injection', 'nosql injection',
      'command injection', 'path traversal', 'deserialization'
    ];

    return securityKeywords.some(keyword => message.includes(keyword));
  }

  private static isPerformanceRelated(message: string): boolean {
    const performanceKeywords = [
      'performance', 'optimization', 'efficiency', 'slow', 'fast', 'speed',
      'memory', 'leak', 'cpu', 'bottleneck', 'n+1', 'query', 'database',
      'cache', 'async', 'blocking', 'render', 're-render', 'bundle'
    ];

    return performanceKeywords.some(keyword => message.includes(keyword));
  }

  private static isArchitectureRelated(message: string): boolean {
    const architectureKeywords = [
      'architecture', 'pattern', 'design', 'layer', 'separation', 'coupling',
      'cohesion', 'abstraction', 'interface', 'dependency', 'injection',
      'service', 'repository', 'controller', 'model', 'view', 'component',
      'state', 'management', 'structure', 'organization'
    ];

    return architectureKeywords.some(keyword => message.includes(keyword));
  }
}
