import OpenAI from 'openai';
import { z } from 'zod';
import { config } from 'dotenv';
import { PRContext, AIReviewComment, AIReview, CompleteAIResponse, StructuredAIReview, ReviewComment } from '../types';
import { GeminiReviewPrompts } from '../prompts';

config();

/**
 * Gemini LLM Utility using OpenAI SDK
 * Provides unified interface for Gemini models with advanced features
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PRIMARY_GEMINI_MODEL = process.env.PRIMARY_GEMINI_MODEL || 'gemini-1.5-flash';
const SECONDARY_GEMINI_MODEL = process.env.SECONDARY_GEMINI_MODEL || 'gemini-1.5-pro';

let geminiClient: OpenAI | null = null;

function getGeminiClient(): OpenAI {
  if (!geminiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    geminiClient = new OpenAI({
      apiKey: GEMINI_API_KEY,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  }
  return geminiClient;
}

/**
 * AI Review Response Schema for validation - more lenient
 * Transforms Gemini's response format (with 'code') to AIReviewComment format (with 'suggestion')
 */
const RawAIReviewSchema = z.object({
  summary: z.string(),
  comments: z.array(z.object({
    filePath: z.string(),
    line: z.number(),
    code: z.string(),
    severity: z.preprocess((val) => {
      // Handle cases where Gemini returns objects, invalid values, or missing severity
      if (typeof val === 'object' || !val) return 'medium';
      if (typeof val !== 'string') return 'medium';
      const lowerVal = val.toLowerCase().trim();
      // Check for exact matches first
      if (['low', 'medium', 'high'].includes(lowerVal)) return lowerVal;
      // Map common variations and keywords
      if (lowerVal.includes('critical') || lowerVal.includes('severe') || lowerVal.includes('security') || lowerVal === 'high') return 'high';
      if (lowerVal.includes('major') || lowerVal === 'medium') return 'medium';
      if (lowerVal.includes('minor') || lowerVal.includes('low') || lowerVal.includes('style')) return 'low';
      // Default fallback
      return 'medium';
    }, z.enum(['low', 'medium', 'high']))
  }))
});

export const AIReviewSchema = RawAIReviewSchema.transform((data) => ({
  summary: data.summary,
  comments: data.comments.map(comment => ({
    filePath: comment.filePath,
    line: comment.line,
    suggestion: comment.code,
    severity: comment.severity
  }))
}));

export type AIReviewResponse = z.infer<typeof AIReviewSchema>;

/**
 * Enhanced Gemini LLM Service with comprehensive features
 */
export class GeminiLLMService {
  private static readonly MAX_RETRIES = 8;
  private static readonly RETRY_DELAY_MS = 3000;
  private static readonly MAX_RATE_LIMIT_RETRIES = 5;
  private static readonly RATE_LIMIT_BACKOFF_MS = 8000;
  private static readonly API_TIMEOUT_MS = 30000; // 30 seconds timeout

  /**
   * Get the primary Gemini model
   */
  static getPrimaryModel(): string {
    return PRIMARY_GEMINI_MODEL;
  }

  /**
   * Get the secondary Gemini model
   */
  static getSecondaryModel(): string {
    return SECONDARY_GEMINI_MODEL;
  }

  /**
   * Validate Gemini API configuration
   */
  static validateConfig(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!GEMINI_API_KEY) {
      errors.push('GEMINI_API_KEY environment variable is required');
    }

    if (!PRIMARY_GEMINI_MODEL) {
      errors.push('PRIMARY_GEMINI_MODEL environment variable is required');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Generate AI-powered PR review using Gemini models - Returns EVERYTHING as JSON
   */
  static async generatePRReview(prContext: PRContext): Promise<CompleteAIResponse> {
    const startTime = Date.now();
    const configValidation = this.validateConfig();

    if (!configValidation.isValid) {
      throw new Error(`Gemini LLM configuration invalid: ${configValidation.errors.join(', ')}`);
    }

    console.log('🤖 Starting Gemini AI PR review generation:', {
      repo: prContext.repo,
      prNumber: prContext.prNumber,
      filesChanged: prContext.changedFiles.length,
      model: this.getPrimaryModel(),
      timestamp: new Date().toISOString()
    });

    const prompt = GeminiReviewPrompts.createPRReviewPrompt(prContext);
    const requestTimestamp = new Date().toISOString();

    const requestData = {
      prContext: prContext,
      prompt: prompt,
      timestamp: requestTimestamp,
      model: this.getPrimaryModel(),
      temperature: 0.1,
      maxTokens: 4000
    };

    let apiCallDuration = 0;
    let rawResponse = '';
    let parsedResponse: AIReviewResponse | null = null;
    let validationErrors: string[] | null = null;
    let responseTimestamp = '';
    let processingTimeMs = 0;
    let error: string | undefined;

    try {
      const apiCallStart = Date.now();

      // Add timeout to prevent hanging
      const apiCallPromise = getGeminiClient().chat.completions.create({
        model: this.getPrimaryModel(),
        messages: [
          {
            role: 'system',
            content: 'You are a senior software engineer doing code review. You are direct, professional, and focus only on critical issues. Respond ONLY with valid JSON - no explanations, no markdown, no extra text. Just the JSON object with summary and comments array.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: 'json_object' }
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('API call timed out')), this.API_TIMEOUT_MS);
      });

      const response = await Promise.race([apiCallPromise, timeoutPromise]);

      apiCallDuration = Date.now() - apiCallStart;
      responseTimestamp = new Date().toISOString();

      rawResponse = response.choices[0]?.message?.content || '';

      if (!rawResponse) {
        throw new Error('No response received from Gemini model');
      }

      console.log('✅ Gemini response received, validating...');

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawResponse);
        processingTimeMs = Date.now() - apiCallStart;
      } catch (parseError) {
        console.error('❌ Failed to parse Gemini response as JSON:', rawResponse.substring(0, 500));
        validationErrors = [`Failed to parse as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`];
        processingTimeMs = Date.now() - apiCallStart;
      }

      if (parsedJson && !validationErrors) {
        const validationResult = AIReviewSchema.safeParse(parsedJson);

        if (!validationResult.success) {
          console.error('❌ Gemini response validation failed:', validationResult.error.format());
          validationErrors = validationResult.error.issues.map((err: any) => `${err.path.join('.')}: ${err.message}`);
          parsedResponse = null;
        } else {
          parsedResponse = validationResult.data;
          validationErrors = null;
          console.log('✅ Gemini response validation successful');
        }
      }

    } catch (err) {
      error = err instanceof Error ? err.message : 'Unknown error';
      console.error('❌ Gemini review generation failed:', error);

      if (err instanceof OpenAI.APIError) {
        console.error('Gemini API Error:', {
          status: err.status,
          code: err.code,
          type: err.type,
          message: err.message
        });
        error = `API Error ${err.status}: ${err.message}`;
      }
    }

    const totalDuration = Date.now() - startTime;

    const completeResponse: CompleteAIResponse = {
      request: requestData,
      response: {
        raw: rawResponse,
        parsed: parsedResponse,
        validationErrors: validationErrors,
        timestamp: responseTimestamp,
        processingTimeMs: processingTimeMs
      },
      metadata: {
        success: !error && !validationErrors && parsedResponse !== null,
        error: error,
        apiCallDuration: apiCallDuration,
        totalDuration: totalDuration
      }
    };

    console.log('📊 Complete Gemini interaction summary:', {
      success: completeResponse.metadata.success,
      apiCallDuration: `${apiCallDuration}ms`,
      totalDuration: `${totalDuration}ms`,
      responseLength: rawResponse.length,
      parsedSuccessfully: parsedResponse !== null,
      validationErrors: validationErrors?.length || 0
    });

    return completeResponse;
  }

  /**
   * Enhanced Gemini AI Review with structured validation and advanced features
   */
  static async generateEnhancedReview(
    prContext: PRContext,
    repoId: number,
    options: {
      frameworkInfo?: any;
      historicalReviews?: any[];
      repoConfig?: any;
      promptBuilder?: any;
    } = {}
  ): Promise<{
    request: any;
    response: {
      raw: string;
      parsed: StructuredAIReview | null;
      validationErrors: string[] | null;
      fallbackComments: ReviewComment[];
      timestamp: string;
      processingTimeMs: number;
      retryCount: number;
    };
    metadata: {
      success: boolean;
      error?: string;
      apiCallDuration: number;
      totalDuration: number;
      schemaValidationPassed: boolean;
      memorySnippetsUsed: number;
      finalCommentsCount: number;
    };
  }> {
    const startTime = Date.now();
    const configValidation = this.validateConfig();

    if (!configValidation.isValid) {
      throw new Error(`Gemini LLM configuration invalid: ${configValidation.errors.join(', ')}`);
    }

    console.log('🤖 Starting enhanced Gemini AI PR review generation:', {
      repo: prContext.repo,
      prNumber: prContext.prNumber,
      filesChanged: prContext.changedFiles.length,
      model: this.getPrimaryModel(),
      timestamp: new Date().toISOString()
    });

    // Use provided prompt or create default one
    const prompt = options.promptBuilder?.buildReviewPrompt ?
      options.promptBuilder.buildReviewPrompt({
        repoId: repoId.toString(),
        prNumber: prContext.prNumber,
        files: prContext.changedFiles,
        frameworkInfo: options.frameworkInfo,
        historicalReviews: options.historicalReviews,
        repoConfig: options.repoConfig
      }) : GeminiReviewPrompts.createEnhancedPRReviewPrompt(prContext, options);

    const requestData = {
      prContext,
      prompt,
      timestamp: new Date().toISOString(),
      model: this.getPrimaryModel(),
      temperature: 0.1,
      maxTokens: 4000,
      repoConfig: options.repoConfig,
      frameworkInfo: options.frameworkInfo,
      historicalReviews: options.historicalReviews
    };

    let apiCallDuration = 0;
    let rawResponse = '';
    let parsedResponse: StructuredAIReview | null = null;
    let validationErrors: string[] | null = null;
    let fallbackComments: ReviewComment[] = [];
    let responseTimestamp = '';
    let processingTimeMs = 0;
    let retryCount = 0;
    let error: string | undefined;

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        retryCount = attempt;

        const apiCallStart = Date.now();

        // Add timeout to prevent hanging
        const apiCallPromise = getGeminiClient().chat.completions.create({
          model: this.getPrimaryModel(),
          messages: [
            {
              role: 'system',
              content: 'You are a senior software engineer doing code review. You are direct, professional, and focus only on critical issues. Respond ONLY with valid JSON - no explanations, no markdown, no extra text. Just the JSON object with summary and comments array.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          top_p: 0.9,
          max_tokens: 4096,
          response_format: { type: 'json_object' }
        });

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('API call timed out')), this.API_TIMEOUT_MS);
        });

        const response = await Promise.race([apiCallPromise, timeoutPromise]);

        apiCallDuration = Date.now() - apiCallStart;
        responseTimestamp = new Date().toISOString();
        rawResponse = response.choices[0]?.message?.content || '';

        if (!rawResponse) {
          throw new Error('No response received from Gemini model');
        }

        console.log(`✅ Gemini response received (attempt ${attempt + 1})`);

        let parsedJson: unknown;
        try {
          // Try direct parsing first
          parsedJson = JSON.parse(rawResponse);
          processingTimeMs = Date.now() - apiCallStart;
        } catch (parseError) {
          console.log(`⚠️ Direct JSON parse failed, attempting extraction...`);

          // Try to extract JSON from corrupted response
          const extractedJson = this.extractValidJson(rawResponse);
          if (extractedJson) {
            try {
              parsedJson = JSON.parse(extractedJson);
              processingTimeMs = Date.now() - apiCallStart;
              console.log(`✅ Successfully extracted valid JSON from corrupted response`);
            } catch (extractError) {
              console.error('❌ Failed to parse extracted JSON:', extractedJson.substring(0, 200));
              validationErrors = [`Failed to parse extracted JSON: ${extractError instanceof Error ? extractError.message : 'Unknown error'}`];

              if (attempt < this.MAX_RETRIES) {
                console.log(`🔄 Retrying after JSON extraction failure...`);
                const delayMs = this.RETRY_DELAY_MS * Math.pow(2, attempt);
                await this.delay(delayMs);
                continue;
              }
              break;
            }
          } else {
            console.error('❌ Failed to parse Gemini response and no valid JSON found:', rawResponse.substring(0, 300));
            validationErrors = [`Failed to parse as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`];

            if (attempt < this.MAX_RETRIES) {
              console.log(`🔄 Retrying after JSON parse failure...`);
              const delayMs = this.RETRY_DELAY_MS * Math.pow(2, attempt);
              await this.delay(delayMs);
              continue;
            }
            break;
          }
        }

        // Validate against AIReview schema with more lenient parsing
        const validationResult = AIReviewSchema.safeParse(parsedJson);

        if (!validationResult.success) {
          console.error('❌ Gemini response validation failed:', validationResult.error.format());
          validationErrors = validationResult.error.issues.map((err: any) => `${err.path.join('.')}: ${err.message}`);

          // Try to fix common issues and retry
          if (attempt < this.MAX_RETRIES) {
            console.log(`🔄 Retrying after validation failure (attempt ${attempt + 1}/${this.MAX_RETRIES})...`);
            const delayMs = this.RETRY_DELAY_MS * Math.pow(2, Math.min(attempt, 3));
            await this.delay(delayMs);
            continue;
          } else {
            console.log('⚠️ Max retries reached, generating fallback comments...');
            fallbackComments = this.generateFallbackComments(rawResponse, prContext);
          }
        } else {
          // Convert AIReviewResponse to StructuredAIReview format with validation
          const aiReview = validationResult.data;
          parsedResponse = {
            summary: aiReview.summary || 'Code review completed with automated analysis',
            comments: aiReview.comments.map(comment => this.validateAndRepairComment(comment))
          };
          validationErrors = null;
          console.log('✅ Gemini response validation successful');
          break;
        }

      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error';

        if (err instanceof OpenAI.APIError) {
          const status = err.status;
          console.error(`❌ Gemini review generation failed (attempt ${attempt + 1}):`, error);
          console.error('Gemini API Error:', {
            status: status,
            code: err.code,
            type: err.type,
            message: err.message
          });
          error = `API Error ${status}: ${err.message}`;

          // Handle rate limiting (429) with aggressive exponential backoff
          if (status === 429 && attempt < this.MAX_RATE_LIMIT_RETRIES) {
            const backoffDelay = this.RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt);
            console.log(`⏳ Rate limited (429). Retrying after ${backoffDelay}ms (attempt ${attempt + 1}/${this.MAX_RATE_LIMIT_RETRIES})...`);
            await this.delay(backoffDelay);
            continue;
          }

          // Handle timeout and other transient errors with exponential backoff
          if ((status === 503 || status === 502 || status === 500) && attempt < this.MAX_RETRIES) {
            const delayMs = this.RETRY_DELAY_MS * Math.pow(2, Math.min(attempt, 3));
            console.log(`⏳ Server error (${status}). Retrying after ${delayMs}ms (attempt ${attempt + 1}/${this.MAX_RETRIES})...`);
            await this.delay(delayMs);
            continue;
          }
        } else {
          console.error(`❌ Gemini review generation failed (attempt ${attempt + 1}):`, error);

          // Retry for empty responses, timeouts, and other non-API errors
          if (attempt < this.MAX_RETRIES) {
            const delayMs = this.RETRY_DELAY_MS * Math.pow(2, Math.min(attempt, 3));
            console.log(`🔄 Empty response, timeout, or general error. Retrying after ${delayMs}ms (attempt ${attempt + 1}/${this.MAX_RETRIES + 1})...`);
            await this.delay(delayMs);
            continue;
          }
        }

        break;
      }
    }

    const totalDuration = Date.now() - startTime;

    const finalValidation = this.performFinalValidation(parsedResponse, fallbackComments);

    const completeResponse = {
      request: requestData,
      response: {
        raw: rawResponse,
        parsed: finalValidation.validatedResponse,
        validationErrors: validationErrors,
        fallbackComments: finalValidation.fallbackUsed ? finalValidation.validatedResponse.comments : fallbackComments,
        timestamp: responseTimestamp,
        processingTimeMs: processingTimeMs,
        retryCount: retryCount
      },
      metadata: {
        success: !error && finalValidation.isValid,
        error: error,
        apiCallDuration: apiCallDuration,
        totalDuration: totalDuration,
        schemaValidationPassed: finalValidation.isValid,
        memorySnippetsUsed: 0,
        finalCommentsCount: finalValidation.validatedResponse.comments.length,
        fallbackUsed: finalValidation.fallbackUsed
      }
    };

    console.log('📊 Enhanced Gemini review completion summary:', {
      success: completeResponse.metadata.success,
      apiCallDuration: `${apiCallDuration}ms`,
      totalDuration: `${totalDuration}ms`,
      responseLength: rawResponse.length,
      parsedSuccessfully: parsedResponse !== null,
      validationErrors: validationErrors?.length || 0,
      finalCommentsCount: completeResponse.metadata.finalCommentsCount,
      retriesUsed: retryCount
    });

    return completeResponse;
  }

  /**
   * Test Gemini API configuration
   */
  static async testGeminiConfig(): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const configValidation = this.validateConfig();

    if (!configValidation.isValid) {
      return configValidation;
    }

    try {
      console.log('🧪 Testing Gemini API connection...');

      const response = await getGeminiClient().chat.completions.create({
        model: this.getPrimaryModel(),
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 10
      });

      if (response) {
        console.log('✅ Gemini API connection successful');
        return { isValid: true, errors: [] };
      } else {
        errors.push('API returned empty response');
      }
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        errors.push(`API Error: ${error.status} ${error.message}`);
      } else {
        errors.push(`Connection Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { isValid: false, errors };
  }


  /**
   * Generate fallback comments when AI response parsing/validation fails
   */
  private static generateFallbackComments(
    rawResponse: string,
    prContext: PRContext
  ): ReviewComment[] {
    const fallbackComments: ReviewComment[] = [];

    try {
      const uniqueFiles = [...new Set(prContext.changedFiles.map((f: { path: string; patch: string; additions: number; deletions: number }) => f.path))];

      // Analyze the raw response to see if we can extract any useful information
      const hasPartialResponse = rawResponse.includes('"summary"') || rawResponse.includes('"comments"');
      const responseLength = rawResponse.length;
      const isLongResponse = responseLength > 1000;

      uniqueFiles.forEach((filePath: string, index: number) => {
        const fileInfo = prContext.changedFiles.find(f => f.path === filePath);
        const fileName = filePath.split('/').pop() || 'file';
        const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
        const additions = fileInfo?.additions || 0;
        const deletions = fileInfo?.deletions || 0;

        // Generate context-aware fallback message
        let message: string;
        let severity: 'critical' | 'major' | 'minor';
        let rationale: string;

        if (hasPartialResponse && isLongResponse) {
          // Partial response suggests the AI was working but got cut off
          message = `AI analysis partially completed for ${fileName}. The response was truncated but indicates potential issues exist.`;
          severity = additions > 50 || deletions > 50 ? 'major' : 'minor';
          rationale = 'The AI model generated a response but it was incomplete or malformed. Manual review is strongly recommended.';
        } else if (responseLength < 100) {
          // Very short response suggests API issues
          message = `AI review failed for ${fileName} due to API communication issues. Manual inspection required.`;
          severity = 'major';
          rationale = 'The AI service returned an incomplete or empty response, indicating a technical issue with the analysis.';
        } else {
          // Standard fallback for parsing failures
          message = this.generateFileSpecificFallbackMessage(fileName, fileExtension, additions, deletions);
          severity = this.determineFallbackSeverity(additions, deletions, fileExtension);
          rationale = 'Automated code review encountered a parsing error. Manual code review is recommended to ensure code quality.';
        }

        const fallbackComment: ReviewComment = {
          filePath,
          line: Math.max(1, Math.floor((index + 1) * 10)), // Distribute comments across different lines
          severity,
          message,
          rationale,
          suggestion: `Please manually review ${fileName} for potential issues, especially in areas with significant changes (${additions} additions, ${deletions} deletions).`
        };
        fallbackComments.push(fallbackComment);
      });

      // Ensure we always have at least one comment
      if (fallbackComments.length === 0) {
        fallbackComments.push({
          filePath: prContext.changedFiles[0]?.path || 'unknown',
          line: 1,
          severity: 'minor',
          message: 'Automated code review encountered technical difficulties. Manual review recommended.',
          rationale: 'The AI review system was unable to complete analysis due to technical issues.',
          suggestion: 'Please conduct a comprehensive manual code review for this pull request.'
        });
      }

    } catch (error) {
      console.error('❌ Failed to generate fallback comments:', error);
      fallbackComments.push({
        filePath: prContext.changedFiles[0]?.path || 'unknown',
        line: 1,
        severity: 'minor',
        message: 'Gemini AI review failed - manual review recommended',
        rationale: 'The automated code review system encountered an error and was unable to complete the analysis.',
        suggestion: 'Please conduct a manual code review for this pull request.'
      });
    }

    return fallbackComments;
  }

  /**
   * Generate file-specific fallback messages based on file type and changes
   */
  private static generateFileSpecificFallbackMessage(
    fileName: string,
    fileExtension: string,
    additions: number,
    deletions: number
  ): string {
    const totalChanges = additions + deletions;

    // File type specific messages
    switch (fileExtension) {
      case 'ts':
      case 'tsx':
        return `TypeScript file ${fileName} has ${totalChanges} changes. Manual review recommended for type safety and code quality.`;
      case 'js':
      case 'jsx':
        return `JavaScript file ${fileName} has ${totalChanges} changes. Manual review recommended for potential runtime issues.`;
      case 'py':
        return `Python file ${fileName} has ${totalChanges} changes. Manual review recommended for code quality and best practices.`;
      case 'java':
        return `Java file ${fileName} has ${totalChanges} changes. Manual review recommended for object-oriented design.`;
      case 'go':
        return `Go file ${fileName} has ${totalChanges} changes. Manual review recommended for concurrency and error handling.`;
      case 'rs':
        return `Rust file ${fileName} has ${totalChanges} changes. Manual review recommended for memory safety and performance.`;
      case 'json':
      case 'yaml':
      case 'yml':
        return `Configuration file ${fileName} has ${totalChanges} changes. Manual review recommended for correctness.`;
      case 'md':
        return `Documentation file ${fileName} has ${totalChanges} changes. Manual review recommended for accuracy.`;
      default:
        return `File ${fileName} has ${totalChanges} changes. Manual review recommended for code quality.`;
    }
  }

  /**
   * Determine appropriate severity for fallback comments
   */
  private static determineFallbackSeverity(
    additions: number,
    deletions: number,
    fileExtension: string
  ): 'critical' | 'major' | 'minor' {
    const totalChanges = additions + deletions;

    // High-risk file types get higher severity
    const highRiskExtensions = ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs'];
    const isHighRisk = highRiskExtensions.includes(fileExtension);

    // Large changes in high-risk files are critical
    if (isHighRisk && totalChanges > 100) {
      return 'critical';
    }

    // Medium changes in high-risk files are major
    if (isHighRisk && totalChanges > 20) {
      return 'major';
    }

    // Large changes in any file are major
    if (totalChanges > 200) {
      return 'major';
    }

    // Default to minor for small changes or low-risk files
    return 'minor';
  }

  /**
   * Extract valid JSON from corrupted or malformed responses
   */
  private static extractValidJson(response: string): string | null {
    // Remove markdown code blocks and backticks
    let cleaned = response
      .replace(/```json\n?/g, '')
      .replace(/```jsonc\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/`/g, '');

    // Remove common repeated token patterns
    cleaned = cleaned.replace(/(\w+)(jsonc)+/g, '$1');
    cleaned = cleaned.replace(/json(\w+)+/g, 'json');

    // Try to find the JSON object by looking for opening and closing braces
    const openBraceIndex = cleaned.indexOf('{');
    const lastCloseBraceIndex = cleaned.lastIndexOf('}');

    if (openBraceIndex === -1 || lastCloseBraceIndex === -1) {
      console.log('❌ No JSON object delimiters found in response');
      return null;
    }

    let jsonString = cleaned.substring(openBraceIndex, lastCloseBraceIndex + 1);

    // Fix common issues
    jsonString = jsonString.trim();

    // Fix escaped newlines in strings
    jsonString = jsonString.replace(/\\n/g, '\\n');

    try {
      // Do a quick validation to see if it's valid
      JSON.parse(jsonString);
      return jsonString;
    } catch (e) {
      console.log('⚠️ Extracted JSON is still invalid, attempting repairs...');

      // Fix missing quotes around keys
      jsonString = jsonString.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');

      // Fix trailing commas
      jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');

      // Remove any lines that aren't JSON
      const lines = jsonString.split('\n');
      const validLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.length === 0 ||
               trimmed.startsWith('{') ||
               trimmed.startsWith('}') ||
               trimmed.startsWith('"') ||
               trimmed.startsWith('[') ||
               trimmed.startsWith(']') ||
               trimmed.match(/^[,\w]/) ||
               trimmed.endsWith(':') ||
               trimmed.endsWith(',');
      });
      jsonString = validLines.join('\n');

      try {
        JSON.parse(jsonString);
        return jsonString;
      } catch (finalError) {
        console.log('❌ Final JSON repair failed, attempting manual reconstruction...');
        return this.reconstructJsonFromFragments(response);
      }
    }
  }

  /**
   * Reconstruct JSON from fragmented or incomplete responses
   */
  private static reconstructJsonFromFragments(response: string): string | null {
    try {
      // Look for summary field
      const summaryMatch = response.match(/"summary"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
      const summary = summaryMatch ? summaryMatch[1] : "Code review completed with automated analysis";

      // Look for comments array patterns
      const commentsPattern = /"comments"\s*:\s*\[([\s\S]*?)\]/;
      const commentsMatch = response.match(commentsPattern);

      if (!commentsMatch) {
        // If no comments found, create a minimal valid response
        return JSON.stringify({
          summary: summary,
          comments: [{
            filePath: "unknown",
            line: 1,
            code: "Manual review recommended due to incomplete AI response",
            severity: "medium"
          }]
        });
      }

      // Parse individual comment objects
      const commentsText = commentsMatch[1];
      const commentMatches = commentsText.match(/\{[^}]*\}/g) || [];

      const validComments = commentMatches
        .map(commentStr => {
          try {
            // Extract basic fields from comment string
            const fileMatch = commentStr.match(/"filePath"\s*:\s*"([^"]+)"/);
            const lineMatch = commentStr.match(/"line"\s*:\s*(\d+)/);
            const codeMatch = commentStr.match(/"code"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
            const severityMatch = commentStr.match(/"severity"\s*:\s*"([^"]+)"/);

            if (fileMatch && lineMatch) {
              return {
                filePath: fileMatch[1],
                line: parseInt(lineMatch[1], 10),
                code: codeMatch ? codeMatch[1] : "Review this code section for potential improvements",
                severity: severityMatch ? severityMatch[1] : "medium"
              };
            }
            return null;
          } catch (e) {
            return null;
          }
        })
        .filter(comment => comment !== null);

      // Ensure we have at least one comment
      if (validComments.length === 0) {
        validComments.push({
          filePath: "unknown",
          line: 1,
          code: "Manual review recommended due to incomplete AI response",
          severity: "medium"
        });
      }

      return JSON.stringify({
        summary: summary,
        comments: validComments
      });

    } catch (error) {
      console.error('❌ JSON reconstruction failed:', error);
      return null;
    }
  }

  /**
   * Validate and repair individual comment fields to ensure all required fields are present
   */
  private static validateAndRepairComment(comment: any): ReviewComment {
    // Ensure all required fields are present and non-empty
    const filePath = comment.filePath || 'unknown';
    const line = typeof comment.line === 'number' && comment.line > 0 ? comment.line : 1;

    // Map severity from AI response format to ReviewComment format
    let severity: 'critical' | 'major' | 'minor';
    switch (comment.severity) {
      case 'high':
        severity = 'critical';
        break;
      case 'medium':
        severity = 'major';
        break;
      case 'low':
        severity = 'minor';
        break;
      default:
        severity = 'minor'; // Default to minor for unknown severities
    }

    // Ensure message is present and meaningful
    let message = comment.suggestion || comment.code || '';
    if (!message || message.trim().length === 0) {
      message = this.generateFallbackMessage(filePath, severity);
    }

    // Ensure rationale is present
    const rationale = 'AI-generated code review suggestion based on automated analysis';

    // Ensure suggestion is present (can be same as message)
    const suggestion = comment.suggestion || comment.code || message;

    return {
      filePath,
      line,
      severity,
      message: message.trim(),
      rationale,
      suggestion: suggestion.trim()
    };
  }

  /**
   * Generate fallback message when AI doesn't provide meaningful content
   */
  private static generateFallbackMessage(filePath: string, severity: 'critical' | 'major' | 'minor'): string {
    const fileName = filePath.split('/').pop() || 'file';

    switch (severity) {
      case 'critical':
        return `Critical issue detected in ${fileName}. Manual review required for security, performance, or correctness concerns.`;
      case 'major':
        return `Major improvement opportunity identified in ${fileName}. Consider refactoring for better maintainability or performance.`;
      case 'minor':
        return `Minor code quality improvement suggested for ${fileName}. Consider following coding best practices.`;
      default:
        return `Code review suggestion for ${fileName}. Manual inspection recommended.`;
    }
  }

  /**
   * Perform final validation to ensure response is database-ready
   */
  private static performFinalValidation(
    parsedResponse: StructuredAIReview | null,
    fallbackComments: ReviewComment[]
  ): {
    isValid: boolean;
    validatedResponse: StructuredAIReview;
    fallbackUsed: boolean;
  } {
    // If we have a valid parsed response, validate it thoroughly
    if (parsedResponse) {
      const validation = this.validateStructuredReview(parsedResponse);
      if (validation.isValid) {
        return {
          isValid: true,
          validatedResponse: validation.validatedResponse,
          fallbackUsed: false
        };
      }
      console.warn('⚠️ Parsed response failed final validation, using fallback');
    }

    // Generate a guaranteed valid fallback response
    const fallbackResponse: StructuredAIReview = {
      summary: 'Automated code review encountered technical difficulties. Manual review recommended.',
      comments: fallbackComments.length > 0 ? fallbackComments : [{
        filePath: 'unknown',
        line: 1,
        severity: 'minor',
        message: 'Automated code review system encountered an error. Manual review required.',
        rationale: 'The AI review system was unable to complete analysis due to technical issues.',
        suggestion: 'Please conduct a comprehensive manual code review for this pull request.'
      }]
    };

    // Ensure the fallback is also valid
    const fallbackValidation = this.validateStructuredReview(fallbackResponse);
    if (!fallbackValidation.isValid) {
      console.error('🚨 CRITICAL: Even fallback response is invalid! Using emergency fallback.');
      // Emergency fallback - guaranteed to be valid
      fallbackResponse.comments = [{
        filePath: 'unknown',
        line: 1,
        severity: 'minor',
        message: 'Code review system error occurred',
        rationale: 'Technical issue prevented automated analysis',
        suggestion: 'Manual review required'
      }];
    }

    return {
      isValid: false, // We're using fallback, so original response was invalid
      validatedResponse: fallbackResponse,
      fallbackUsed: true
    };
  }

  /**
   * Validate a StructuredAIReview to ensure it meets database requirements
   */
  private static validateStructuredReview(review: StructuredAIReview): {
    isValid: boolean;
    validatedResponse: StructuredAIReview;
    errors: string[];
  } {
    const errors: string[] = [];
    const validatedComments: ReviewComment[] = [];

    // Validate summary
    if (!review.summary || typeof review.summary !== 'string' || review.summary.trim().length === 0) {
      errors.push('Summary is required and must be a non-empty string');
      review.summary = 'Code review completed with automated analysis';
    }

    // Validate comments array
    if (!Array.isArray(review.comments)) {
      errors.push('Comments must be an array');
      review.comments = [];
    }

    // Validate each comment
    for (let i = 0; i < review.comments.length; i++) {
      const comment = review.comments[i];
      const commentErrors: string[] = [];

      // Required fields validation
      if (!comment.filePath || typeof comment.filePath !== 'string') {
        commentErrors.push('filePath is required');
      }

      if (!comment.message || typeof comment.message !== 'string' || comment.message.trim().length === 0) {
        commentErrors.push('message is required and must be non-empty');
      }

      if (!comment.rationale || typeof comment.rationale !== 'string' || comment.rationale.trim().length === 0) {
        commentErrors.push('rationale is required and must be non-empty');
      }

      if (!['critical', 'major', 'minor'].includes(comment.severity)) {
        commentErrors.push('severity must be critical, major, or minor');
      }

      if (typeof comment.line !== 'number' || comment.line < 1) {
        commentErrors.push('line must be a positive number');
      }

      // If comment is valid, add it; otherwise skip it
      if (commentErrors.length === 0) {
        validatedComments.push({
          ...comment,
          message: comment.message.trim(),
          rationale: comment.rationale.trim(),
          suggestion: comment.suggestion?.trim() || comment.message
        });
      } else {
        console.warn(`⚠️ Comment ${i} has validation errors:`, commentErrors.join(', '));
      }
    }

    const validatedResponse: StructuredAIReview = {
      summary: review.summary.trim(),
      comments: validatedComments
    };

    return {
      isValid: errors.length === 0 && validatedComments.length > 0,
      validatedResponse,
      errors
    };
  }

  /**
   * Utility method for delays between retries
   */
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Legacy compatibility functions - maintain existing interfaces
 */

/**
 * Generate AI-powered PR review using Gemini (maintains existing interface)
 */
export async function generatePRReview(prContext: PRContext): Promise<CompleteAIResponse> {
  console.warn('⚠️ Using legacy generatePRReview function - consider migrating to GeminiLLMService');
  return await GeminiLLMService.generatePRReview(prContext);
}

/**
 * Validate AI review response (maintains existing interface)
 */
export function validateAIReview(data: unknown): AIReviewResponse {
  return AIReviewSchema.parse(data);
}

/**
 * Test Gemini API configuration (maintains existing interface)
 */
export async function testOpenRouterConfig(): Promise<{ isValid: boolean; errors: string[] }> {
  console.warn('⚠️ testOpenRouterConfig is deprecated - using testGeminiConfig');
  return await GeminiLLMService.testGeminiConfig();
}

/**
 * Enhanced AI Review Service compatibility layer
 */
export class EnhancedAIReviewService {
  static async generateEnhancedReview(
    prContext: PRContext,
    repoId: number
  ): Promise<any> {
    console.warn('⚠️ Using legacy EnhancedAIReviewService - consider migrating to GeminiLLMService');

    const enhancedResponse = await GeminiLLMService.generateEnhancedReview(prContext, repoId);

    return {
      request: enhancedResponse.request,
      response: {
        raw: enhancedResponse.response.raw,
        parsed: enhancedResponse.response.parsed,
        validationErrors: enhancedResponse.response.validationErrors,
        timestamp: enhancedResponse.response.timestamp,
        processingTimeMs: enhancedResponse.response.processingTimeMs
      },
      metadata: enhancedResponse.metadata
    };
  }

  static async testEnhancedReviewConfig(): Promise<{ isValid: boolean; errors: string[] }> {
    console.warn('⚠️ testEnhancedReviewConfig is deprecated - using testGeminiConfig');
    return await GeminiLLMService.testGeminiConfig();
  }
}
