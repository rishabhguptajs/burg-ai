/**
 * Framework and Technology Detection Utility
 * Analyzes repository files and changes to detect frameworks, languages, and technologies
 */
export class FrameworkDetector {

  /**
   * Detect frameworks and technologies from file changes and repository structure
   */
  static async detectFrameworks(files: any[], repoFullName?: string): Promise<{
    isReact: boolean;
    isNode: boolean;
    isTypeScript: boolean;
    isExpress: boolean;
    isNextJS: boolean;
    isMongoDB: boolean;
    isPostgreSQL: boolean;
    isRedis: boolean;
    isDocker: boolean;
    isKubernetes: boolean;
    languages: string[];
    hasTests: boolean;
    hasCI: boolean;
    frameworks: string[];
  }> {
    const detection = {
      isReact: false,
      isNode: false,
      isTypeScript: false,
      isExpress: false,
      isNextJS: false,
      isMongoDB: false,
      isPostgreSQL: false,
      isRedis: false,
      isDocker: false,
      isKubernetes: false,
      languages: new Set<string>(),
      hasTests: false,
      hasCI: false,
      frameworks: new Set<string>()
    };

    // Analyze file extensions and paths
    for (const file of files) {
      const filePath = file.path?.toLowerCase() || '';
      const fileName = file.filename?.toLowerCase() || '';

      // Language detection
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        detection.languages.add('TypeScript');
        detection.isTypeScript = true;
      }
      if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
        detection.languages.add('JavaScript');
      }
      if (filePath.endsWith('.py')) {
        detection.languages.add('Python');
      }
      if (filePath.endsWith('.java')) {
        detection.languages.add('Java');
      }
      if (filePath.endsWith('.go')) {
        detection.languages.add('Go');
      }
      if (filePath.endsWith('.rs')) {
        detection.languages.add('Rust');
      }

      // Framework detection from file paths and names
      if (filePath.includes('/components/') || filePath.includes('/hooks/') || fileName.includes('.jsx') || fileName.includes('.tsx')) {
        detection.isReact = true;
        detection.frameworks.add('React');
      }

      if (filePath.includes('/pages/') && filePath.includes('/api/')) {
        detection.isNextJS = true;
        detection.frameworks.add('Next.js');
      }

      if (filePath.includes('/src/app/') || filePath.includes('/app/') && detection.isTypeScript) {
        // Could be Next.js 13+ app router
        detection.isNextJS = true;
        detection.frameworks.add('Next.js');
      }

      if (fileName === 'package.json' || filePath.includes('node_modules')) {
        detection.isNode = true;
      }

      if (filePath.includes('/test/') || filePath.includes('/tests/') || filePath.includes('.test.') || filePath.includes('.spec.')) {
        detection.hasTests = true;
      }

      if (filePath.includes('.github/workflows/') || filePath.includes('ci.yml') || filePath.includes('ci.yaml')) {
        detection.hasCI = true;
      }

      if (filePath.includes('dockerfile') || filePath.includes('docker-compose')) {
        detection.isDocker = true;
        detection.frameworks.add('Docker');
      }

      if (filePath.includes('k8s/') || filePath.includes('kubernetes/') || fileName.includes('deployment.yml')) {
        detection.isKubernetes = true;
        detection.frameworks.add('Kubernetes');
      }
    }

    // Analyze file contents for more detailed detection
    for (const file of files) {
      const content = file.patch || file.diff || '';

      // React detection
      if (content.includes('import React') || content.includes('from "react"') || content.includes("from 'react'")) {
        detection.isReact = true;
        detection.frameworks.add('React');
      }

      // Express detection
      if (content.includes('express') && (content.includes('require(') || content.includes('import'))) {
        detection.isExpress = true;
        detection.frameworks.add('Express');
      }

      // MongoDB detection
      if (content.includes('mongodb') || content.includes('mongoose') || content.includes('mongo')) {
        detection.isMongoDB = true;
        detection.frameworks.add('MongoDB');
      }

      // PostgreSQL detection
      if (content.includes('pg') || content.includes('postgres') || content.includes('postgresql')) {
        detection.isPostgreSQL = true;
        detection.frameworks.add('PostgreSQL');
      }

      // Redis detection
      if (content.includes('redis') || content.includes('ioredis')) {
        detection.isRedis = true;
        detection.frameworks.add('Redis');
      }

      // Next.js detection from content
      if (content.includes('next') && content.includes('import')) {
        detection.isNextJS = true;
        detection.frameworks.add('Next.js');
      }

      // Node.js detection
      if (content.includes('require(') || content.includes('module.exports') || content.includes('process.')) {
        detection.isNode = true;
      }
    }

    // Special case: If we have TypeScript but no explicit Node.js detection, assume Node.js
    if (detection.isTypeScript && !detection.isNode) {
      const hasNodeIndicators = files.some(file =>
        file.path?.includes('package.json') ||
        file.path?.includes('tsconfig.json') ||
        file.path?.includes('node_modules')
      );
      if (hasNodeIndicators) {
        detection.isNode = true;
      }
    }

    return {
      ...detection,
      languages: Array.from(detection.languages),
      frameworks: Array.from(detection.frameworks)
    };
  }

  /**
   * Analyze package.json content for framework detection
   */
  static analyzePackageJson(packageJsonContent: string): {
    dependencies: string[];
    devDependencies: string[];
    detectedFrameworks: string[];
  } {
    try {
      const pkg = JSON.parse(packageJsonContent);
      const dependencies = Object.keys(pkg.dependencies || {});
      const devDependencies = Object.keys(pkg.devDependencies || {});
      const allDeps = [...dependencies, ...devDependencies];

      const detectedFrameworks: string[] = [];

      // Framework detection from dependencies
      if (allDeps.some(dep => dep.includes('react'))) detectedFrameworks.push('React');
      if (allDeps.some(dep => dep.includes('next'))) detectedFrameworks.push('Next.js');
      if (allDeps.some(dep => dep.includes('express'))) detectedFrameworks.push('Express');
      if (allDeps.some(dep => dep.includes('mongoose'))) detectedFrameworks.push('MongoDB');
      if (allDeps.some(dep => dep.includes('pg') || dep.includes('postgres'))) detectedFrameworks.push('PostgreSQL');
      if (allDeps.some(dep => dep.includes('redis'))) detectedFrameworks.push('Redis');
      if (allDeps.some(dep => dep.includes('typescript'))) detectedFrameworks.push('TypeScript');
      if (allDeps.some(dep => dep.includes('jest') || dep.includes('mocha'))) detectedFrameworks.push('Testing');

      return {
        dependencies,
        devDependencies,
        detectedFrameworks
      };
    } catch (error) {
      console.error('Failed to parse package.json:', error);
      return {
        dependencies: [],
        devDependencies: [],
        detectedFrameworks: []
      };
    }
  }

  /**
   * Get security recommendations based on detected frameworks
   */
  static getSecurityRecommendations(frameworkInfo: any): string[] {
    const recommendations: string[] = [];

    if (frameworkInfo.isReact) {
      recommendations.push('Validate JSX props to prevent XSS attacks');
      recommendations.push('Use dangerouslySetInnerHTML carefully');
      recommendations.push('Sanitize user input in forms');
    }

    if (frameworkInfo.isExpress) {
      recommendations.push('Use helmet middleware for security headers');
      recommendations.push('Implement rate limiting');
      recommendations.push('Validate input with middleware like express-validator');
      recommendations.push('Use CORS properly');
    }

    if (frameworkInfo.isMongoDB) {
      recommendations.push('Use mongoose validation schemas');
      recommendations.push('Avoid NoSQL injection with proper query building');
      recommendations.push('Implement field-level encryption for sensitive data');
    }

    if (frameworkInfo.isPostgreSQL) {
      recommendations.push('Use parameterized queries to prevent SQL injection');
      recommendations.push('Implement row-level security');
      recommendations.push('Validate input types and constraints');
    }

    if (frameworkInfo.isNextJS) {
      recommendations.push('Validate API route inputs');
      recommendations.push('Use NextAuth.js securely');
      recommendations.push('Implement proper CORS for API routes');
    }

    if (frameworkInfo.isTypeScript) {
      recommendations.push('Use strict type checking');
      recommendations.push('Avoid any types for user inputs');
      recommendations.push('Use union types for validation');
    }

    return recommendations;
  }

  /**
   * Get performance recommendations based on detected frameworks
   */
  static getPerformanceRecommendations(frameworkInfo: any): string[] {
    const recommendations: string[] = [];

    if (frameworkInfo.isReact) {
      recommendations.push('Use React.memo for expensive components');
      recommendations.push('Implement proper key props in lists');
      recommendations.push('Use useCallback and useMemo for expensive operations');
      recommendations.push('Code-split with React.lazy');
    }

    if (frameworkInfo.isNextJS) {
      recommendations.push('Use Next.js Image component for optimization');
      recommendations.push('Implement proper ISR/SSG strategies');
      recommendations.push('Use dynamic imports for code splitting');
    }

    if (frameworkInfo.isMongoDB) {
      recommendations.push('Add proper indexes for query optimization');
      recommendations.push('Use aggregation pipelines efficiently');
      recommendations.push('Implement connection pooling');
    }

    if (frameworkInfo.isExpress) {
      recommendations.push('Use compression middleware');
      recommendations.push('Implement caching strategies');
      recommendations.push('Use clustering for multi-core utilization');
    }

    if (frameworkInfo.isNode) {
      recommendations.push('Use async/await properly to avoid blocking');
      recommendations.push('Implement proper error handling');
      recommendations.push('Use streams for large data processing');
    }

    return recommendations;
  }
}
