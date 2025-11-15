

export interface BurgAIPromptOptions {
  repoId: string;
  prNumber: number;
  files: any[];
  memoryContext?: string;
  historicalReviews?: any[];
  frameworkInfo?: any;
  repoConfig?: any;
}

export class BurgAIReviewPrompt {
  
  static buildPrompt(options: BurgAIPromptOptions): string {
    const { repoId, prNumber, files, memoryContext, historicalReviews, frameworkInfo, repoConfig } = options;

    return `Burg AI - Code Review Assistant

You are Burg AI, an elite AI code reviewer. Focus on security vulnerabilities, architecture patterns, and performance optimizations.

CRITICAL SECURITY CHECKS:
- SQL injection, XSS, CSRF, authentication bypass, data exposure, command injection, path traversal, race conditions

FRAMEWORK PATTERNS:
${this.getFrameworkPatterns(frameworkInfo)}

PERFORMANCE ISSUES:
- N+1 queries, memory leaks, inefficient algorithms, blocking I/O, unnecessary re-renders

SEVERITY LEVELS:
- critical: Security vulnerabilities, data corruption, crashes
- major: Logic errors, performance bottlenecks, missing error handling
- minor: Code style, naming, documentation

${this.buildHistoricalContext(historicalReviews)}

${this.buildFrameworkContext(frameworkInfo)}

${memoryContext ? `REPOSITORY PATTERNS: ${memoryContext}` : 'No repository context available'}

REQUIRED OUTPUT: ONLY valid JSON with summary and comments array.
Each comment must have: filePath, line, severity, message, rationale, code
Code field contains ONLY replacement code (no markdown, no backticks, valid syntax)

FILE CHANGES:
${files.map(file => `File: ${file.path}
Changes:
${file.patch || file.diff || 'No patch available'}`).join('\n\n')}

Respond ONLY with JSON starting with { and ending with }`;
  }

  private static getFrameworkPatterns(frameworkInfo?: any): string {
    if (!frameworkInfo) return '- General software engineering best practices';

    const patterns = [];
    if (frameworkInfo.isReact) patterns.push('- React hooks rules and lifecycle management');
    if (frameworkInfo.isNode) patterns.push('- Node.js async/await patterns and error handling');
    if (frameworkInfo.isTypeScript) patterns.push('- TypeScript strict type checking and generic usage');
    if (frameworkInfo.isExpress) patterns.push('- Express middleware patterns and route organization');
    if (frameworkInfo.isNextJS) patterns.push('- Next.js SSR/SSG patterns and API routes');
    if (frameworkInfo.isMongoDB) patterns.push('- MongoDB aggregation pipelines and indexing');

    return patterns.length ? patterns.join('\n') : '- General software engineering best practices';
  }

  private static buildHistoricalContext(historicalReviews?: any[]): string {
    if (!historicalReviews?.length) return '**No historical context available**';

    const patterns = historicalReviews
      .filter(review => review.comments?.length)
      .flatMap(review => review.comments)
      .reduce((acc: any, comment: any) => {
        const key = `${comment.severity}:${comment.message.substring(0, 50)}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

    const topPatterns = Object.entries(patterns)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([pattern, count]) => `- ${pattern} (${count} occurrences)`);

    return `**COMMON ISSUES FROM PAST REVIEWS:**
${topPatterns.join('\n')}

**LEARNED PATTERNS:**
- Address previously identified security concerns
- Maintain consistency with past architectural decisions
- Apply fixes similar to those used before`;
  }

  private static buildFrameworkContext(frameworkInfo?: any): string {
    if (!frameworkInfo) return '**Framework: Not detected - applying general best practices**';

    const frameworks = [];
    if (frameworkInfo.isReact) frameworks.push('React');
    if (frameworkInfo.isNode) frameworks.push('Node.js');
    if (frameworkInfo.isTypeScript) frameworks.push('TypeScript');
    if (frameworkInfo.isExpress) frameworks.push('Express');
    if (frameworkInfo.isNextJS) frameworks.push('Next.js');
    if (frameworkInfo.isMongoDB) frameworks.push('MongoDB');

    return `**Detected Frameworks:** ${frameworks.join(', ') || 'None detected'}

**Framework-Specific Checks:**
${frameworks.length ? frameworks.map(fw => `- ${fw} best practices and patterns`).join('\n') : '- General software engineering practices'}`;
  }

  private static getSecurityFocusAreas(frameworkInfo?: any): string {
    const areas = [
      '- Input validation and sanitization',
      '- Authentication and authorization checks',
      '- SQL injection prevention',
      '- XSS protection',
      '- CSRF protection',
      '- Secure data handling'
    ];

    if (frameworkInfo?.isReact) areas.push('- React-specific XSS in JSX');
    if (frameworkInfo?.isNode) areas.push('- Server-side injection attacks');
    if (frameworkInfo?.isExpress) areas.push('- Route protection and middleware security');
    if (frameworkInfo?.isMongoDB) areas.push('- NoSQL injection prevention');

    return areas.join('\n');
  }
}
