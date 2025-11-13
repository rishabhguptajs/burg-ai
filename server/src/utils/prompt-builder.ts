/**
 * Enhanced PromptBuilder utility for CodeRabbit-level AI PR review prompts
 */
export class PromptBuilder {
  /**
   * Build a comprehensive, CodeRabbit-level review prompt
   */
  static buildReviewPrompt(options: {
    repoId: string;
    prNumber: number;
    files: any[];
    memoryContext?: string;
    historicalReviews?: any[];
    frameworkInfo?: any;
    repoConfig?: any;
  }): string {
    const { repoId, prNumber, files, memoryContext, historicalReviews, frameworkInfo, repoConfig } = options;
    const backtick = '`';

    return `# CodeRabbit AI - Advanced Code Review Assistant

You are CodeRabbit, an elite AI code reviewer that provides GitHub-comment-ready, directly-committable code suggestions. Your reviews are known for being extremely actionable, secure, and architecturally sound.

## 🎯 YOUR MISSION

Analyze this pull request and provide CodeRabbit-level feedback that can be directly applied to the codebase. Focus on security vulnerabilities, architecture patterns, and performance optimizations.

## 🔒 SECURITY ANALYSIS (HIGHEST PRIORITY)

**CRITICAL SECURITY CHECKS:**
- SQL injection vulnerabilities
- XSS (Cross-Site Scripting) attacks
- CSRF (Cross-Site Request Forgery)
- Authentication bypass vulnerabilities
- Sensitive data exposure (API keys, passwords, tokens)
- Command injection risks
- Path traversal vulnerabilities
- Deserialization attacks
- Race conditions in concurrent code
- Buffer overflow risks

**WEB SECURITY:**
- Input validation and sanitization
- Output encoding for HTML/JSON responses
- Secure headers (CSP, HSTS, etc.)
- JWT token handling
- CORS configuration issues
- Session management problems

## 🏗️ ARCHITECTURE PATTERN ANALYSIS

**DESIGN PATTERNS:**
- MVC/MVVM violations
- Repository/Service layer issues
- Dependency injection problems
- SOLID principle violations
- Microservices communication patterns
- State management inconsistencies
- Database schema design issues

**FRAMEWORK-SPECIFIC PATTERNS:**
${this.getFrameworkPatterns(frameworkInfo)}

## ⚡ PERFORMANCE OPTIMIZATION

**CRITICAL PERFORMANCE ISSUES:**
- N+1 query problems
- Memory leaks
- Inefficient algorithms (O(n²) vs O(n))
- Large object allocations in loops
- Blocking I/O in async contexts
- Unnecessary re-renders (React)
- Bundle size optimizations
- Database connection pooling issues

## 📝 GITHUB SUGGESTION FORMAT (CRITICAL - MUST FOLLOW EXACTLY)

GitHub uses triple backticks with 'suggestion' to create committable suggestions. Format:

\`\`\`suggestion
// Original code (what to replace)
const user = getUser();
// Fixed code (replacement)
const user = getUser() || throw new Error('User not found');
\`\`\`

**KEY RULES FOR SUGGESTIONS:**
1. Start with \`\`\`suggestion (no language specifier)
2. Show the EXACT code from the diff that needs to be replaced
3. Show the replacement code
4. End with \`\`\`
5. The suggestion MUST be valid, compilable code
6. Include imports/dependencies needed
7. Match the file's language (TypeScript, JavaScript, Python, etc.)

**EXAMPLES BY TYPE:**

**Single-line suggestion (TypeScript):**
\`\`\`suggestion
const distance = [...distances];
const distance = distances.map(d => d + 1); // Fix: separate array for distances
\`\`\`

**Multi-line suggestion (JavaScript):**
\`\`\`suggestion
function dijkstra(graph, start, end) {
  return distances;
}
function dijkstra(graph, start, end) {
  // Validate inputs
  if (!graph || start < 0 || end < 0) {
    throw new Error('Invalid graph or vertices');
  }
  
  // Ensure non-negative weights
  for (const edges of graph) {
    for (const edge of edges) {
      if (edge.weight < 0) {
        throw new Error('Negative edge weight not allowed');
      }
    }
  }
  
  return distances;
}
\`\`\`

**Security fix suggestion:**
\`\`\`suggestion
const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
const query = 'SELECT * FROM users WHERE id = ?';
const params = [userId];
db.query(query, params);
\`\`\`

## 🎯 SEVERITY CLASSIFICATION

- **critical**: Security vulnerabilities, data corruption, system crashes, authentication bypasses
- **major**: Logic errors, performance bottlenecks, architectural violations, missing error handling
- **minor**: Code style, naming conventions, documentation, small optimizations

## 📊 HISTORICAL CONTEXT

${this.buildHistoricalContext(historicalReviews)}

## 🔧 FRAMEWORK DETECTION

${this.buildFrameworkContext(frameworkInfo)}

## 💾 REPOSITORY PATTERNS

${memoryContext ? `**ESTABLISHED PATTERNS:**
${memoryContext}

**CONSISTENCY REQUIREMENTS:**
- Follow existing naming conventions
- Maintain architectural patterns
- Use established error handling approaches
- Follow security practices already in place` : '**No repository context available - apply general best practices**'}

## 🎨 CODE SUGGESTION REQUIREMENTS

**MANDATORY FORMATTING:**
1. Use proper GitHub suggestion format with \`\`\`suggestion blocks
2. Include exact line numbers from diffs
3. Provide copy-paste ready code
4. Specify correct file paths
5. Use appropriate language syntax highlighting

**SUGGESTION QUALITY:**
- **Before/After**: Show what changes to what
- **Imports**: Include necessary import statements
- **Dependencies**: Account for required dependencies
- **Error Handling**: Add proper error boundaries
- **Type Safety**: Maintain type correctness
- **Testing**: Consider test implications

## 📋 REQUIRED OUTPUT SCHEMA

YOU MUST RESPOND WITH ONLY THIS JSON STRUCTURE - NO MARKDOWN OUTSIDE THE JSON, NO EXPLANATORY TEXT:

\`\`\`json
{
  "summary": "Executive summary of the PR",
  "comments": [
    {
      "filePath": "src/file.ts",
      "line": 25,
      "severity": "critical",
      "message": "Brief issue description",
      "rationale": "Why this matters and what could go wrong",
      "suggestion": "\`\`\`suggestion\noriginal code here\nfixed code here\n\`\`\`"
    }
  ]
}
\`\`\`

CRITICAL RULES FOR SUGGESTIONS FIELD:
- The suggestion field MUST contain a GitHub suggestion block with triple backticks
- Format: \`\`\`suggestion\noriginal code\nreplacement code\n\`\`\`
- Show the exact code being replaced and the fixed version
- Include necessary imports/dependencies
- Use proper syntax for the file's language
- Suggestions must be valid, compilable code
- ALWAYS escape backslashes and quotes properly in JSON

IMPORTANT:
- Respond with ONLY valid JSON (no markdown backticks outside the JSON)
- Each comment MUST have: filePath, line, severity, message, rationale
- suggestion field is REQUIRED - it must contain a properly formatted GitHub suggestion block
- Do NOT include explanatory text before or after the JSON
- The entire response must be a single valid JSON object

## 🔍 ANALYSIS FOCUS AREAS

**SECURITY FIRST:**
${this.getSecurityFocusAreas(frameworkInfo)}

**PERFORMANCE:**
- Database query optimization
- Memory management
- Algorithm complexity analysis
- Caching strategies
- Bundle optimization

**ARCHITECTURE:**
- Layer separation
- Dependency management
- State management patterns
- API design consistency
- Error handling patterns

## 📁 FILE CHANGES TO REVIEW

${files.map(file => `### ${file.path}
\`\`\`diff
${file.patch || file.diff || ''}
\`\`\``).join('\n\n')}

## 🎯 EXECUTION INSTRUCTIONS

1. **Analyze each file change thoroughly**
2. **Prioritize security vulnerabilities (critical)**
3. **Identify architectural improvements (major)**
4. **Find performance optimizations (major)**
5. **Format all suggestions as GitHub-ready comments**
6. **Ensure suggestions are directly committable**
7. **Reference specific line numbers**
8. **Provide comprehensive rationale**

${historicalReviews?.length ? '**LEARN FROM HISTORY:** Reference similar issues found in past reviews to maintain consistency.' : ''}

## ⚠️ CRITICAL FINAL INSTRUCTIONS - SUGGESTION FORMAT

EVERY COMMENT MUST INCLUDE A GITHUB SUGGESTION. The suggestion field is REQUIRED.

SUGGESTION FORMAT INSIDE THE JSON (properly escaped):
"suggestion": "\`\`\`suggestion\\noriginal code here\\nfixed code here\\n\`\`\`"

EXAMPLE COMPLETE OUTPUT:
{
  "summary": "The PR has critical issues",
  "comments": [
    {
      "filePath": "test.ts",
      "line": 18,
      "severity": "critical",
      "message": "Add input validation",
      "rationale": "Dijkstra requires non-negative weights",
      "suggestion": "\`\`\`suggestion\\nfunction dijkstra(graph, start) {\\n  return distances;\\n}\\nfunction dijkstra(graph, start) {\\n  if (start < 0 || start >= graph.length) {\\n    throw new Error('Invalid start vertex');\\n  }\\n  return distances;\\n}\\n\`\`\`"
    }
  ]
}

## MANDATORY REQUIREMENTS:
✅ RESPOND WITH ONLY VALID JSON
✅ Every comment MUST have a suggestion field
✅ Suggestions MUST use \`\`\`suggestion format with triple backticks
✅ Suggestions MUST show original → fixed code
✅ Properly escape newlines as \\n in JSON strings
✅ Start response with { and end with }
✅ No markdown code blocks outside JSON
✅ No explanatory text before/after JSON

Generate your comprehensive CodeRabbit-level review with GitHub-committable suggestions now.`;
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
