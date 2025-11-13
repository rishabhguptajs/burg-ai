import axios from 'axios';
import { PRContext, StructuredAIReview, ReviewComment } from '../types';
import {
  validateStructuredAIReviewData,
  createFallbackComment
} from './schema-validation';
import { PromptBuilder } from './prompt-builder';
import { RepoConfigService } from '../models/repo-config';
import { FrameworkDetector } from './framework-detector';
import { HistoricalReviewService } from './historical-review-service';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-20b:free';

/**
 * Enhanced AI review response with comprehensive metadata
 */
export interface EnhancedAIReviewResponse {
  request: {
    prContext: any;
    prompt: string;
    timestamp: string;
    model: string;
    temperature: number;
    maxTokens: number;
    repoConfig: any;
    frameworkInfo?: any;
    historicalReviews?: any[];
    repoStats?: any;
  };
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
}

/**
 * Enhanced AI Review Service with structured output and validation
 */
export class EnhancedAIReviewService {
  private static readonly MAX_RETRIES = 8;
  private static readonly RETRY_DELAY_MS = 3000;
  private static readonly MAX_RATE_LIMIT_RETRIES = 5;
  private static readonly RATE_LIMIT_BACKOFF_MS = 8000;

  /**
   * Generate enhanced AI-powered PR review with structured validation
   */
  static async generateEnhancedReview(
    prContext: PRContext,
    repoId: number
  ): Promise<EnhancedAIReviewResponse> {
    const startTime = Date.now();
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;

    if (!openRouterApiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }

    console.log('🤖 Starting enhanced AI PR review generation:', {
      repo: prContext.repo,
      prNumber: prContext.prNumber,
      filesChanged: prContext.changedFiles.length,
      timestamp: new Date().toISOString()
    });

    const repoConfig = await RepoConfigService.getOrCreateConfig(repoId, prContext.repo);

    // Detect frameworks and technologies from the codebase
    const frameworkInfo = await FrameworkDetector.detectFrameworks(prContext.changedFiles, prContext.repo);

    // Get historical reviews for context and learning
    const historicalReviews = await HistoricalReviewService.getHistoricalReviews(repoId);

    // Get repository statistics
    const repoStats = await HistoricalReviewService.getRepoStats(repoId);

    console.log('🤖 Enhanced AI Review Context:', {
      frameworks: frameworkInfo.frameworks,
      languages: frameworkInfo.languages,
      historicalReviewsCount: historicalReviews.length,
      repoStats
    });

    const prompt = PromptBuilder.buildReviewPrompt({
      repoId: repoId.toString(),
      prNumber: prContext.prNumber,
      files: prContext.changedFiles,
      frameworkInfo,
      historicalReviews,
      repoConfig
    });

    const requestData = {
      prContext,
      prompt,
      timestamp: new Date().toISOString(),
      model: DEFAULT_MODEL,
      temperature: 0.1,
      maxTokens: 4000,
      repoConfig,
      frameworkInfo,
      historicalReviews: historicalReviews,
      repoStats
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

        const response = await axios.post(
          `${OPENROUTER_BASE_URL}/chat/completions`,
          {
            model: requestData.model,
            messages: [
              {
                role: 'system',
                content: 'You are an expert code reviewer. Respond ONLY with valid JSON matching the schema below. No markdown, no code blocks, no extra text. Just pure JSON.\n\nRESPOND WITH ONLY:\n{"summary":"...","comments":[...]}'
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
          },
          {
            headers: {
              'Authorization': `Bearer ${openRouterApiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.APP_URL || 'http://localhost:8000',
              'X-Title': 'Burg AI PR Reviewer'
            },
            timeout: 90000
          }
        );

        apiCallDuration = Date.now() - apiCallStart;
        responseTimestamp = new Date().toISOString();
        rawResponse = response.data.choices[0]?.message?.content || '';

        if (!rawResponse) {
          throw new Error('No response received from AI model');
        }

        console.log(`✅ AI response received (attempt ${attempt + 1})`);

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
            console.error('❌ Failed to parse AI response and no valid JSON found:', rawResponse.substring(0, 300));
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

        const validation = validateStructuredAIReviewData(parsedJson);

        if (!validation.isValid) {
          console.error('❌ AI response validation failed:', validation.errors);
          validationErrors = validation.errors || null;

          if (attempt === this.MAX_RETRIES) {
            console.log('⚠️ Max retries reached, generating fallback comments...');
            fallbackComments = this.generateFallbackComments(rawResponse, prContext);
          }

          if (attempt < this.MAX_RETRIES) {
            console.log(`🔄 Retrying after validation failure (attempt ${attempt + 1}/${this.MAX_RETRIES})...`);
            const delayMs = this.RETRY_DELAY_MS * Math.pow(2, Math.min(attempt, 3));
            await this.delay(delayMs);
            continue;
          }
        } else {
          parsedResponse = validation.review || null;
          validationErrors = null;
          console.log('✅ AI response validation successful');
          break;
        }

      } catch (err) {
        error = err instanceof Error ? err.message : 'Unknown error';

        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          console.error(`❌ AI review generation failed (attempt ${attempt + 1}):`, error);
          console.error('OpenRouter API Error:', {
            status: status,
            statusText: err.response?.statusText,
            data: err.response?.data
          });
          error = `API Error ${status}: ${err.response?.statusText}`;

          // Handle rate limiting (429) with aggressive exponential backoff
          if (status === 429 && attempt < this.MAX_RATE_LIMIT_RETRIES) {
            const backoffDelay = this.RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt);
            console.log(`⏳ Rate limited (429). Retrying after ${backoffDelay}ms (attempt ${attempt + 1}/${this.MAX_RATE_LIMIT_RETRIES})...`);
            await this.delay(backoffDelay);
            continue;
          }

          // Handle timeout and other transient errors with exponential backoff
          if ((status === 503 || status === 502 || status === 500 || err.code === 'ECONNABORTED') && attempt < this.MAX_RETRIES) {
            const delayMs = this.RETRY_DELAY_MS * Math.pow(2, Math.min(attempt, 3));
            console.log(`⏳ Server error (${status}). Retrying after ${delayMs}ms (attempt ${attempt + 1}/${this.MAX_RETRIES})...`);
            await this.delay(delayMs);
            continue;
          }
        } else {
          console.error(`❌ AI review generation failed (attempt ${attempt + 1}):`, error);
        }

        break;
      }
    }

    const totalDuration = Date.now() - startTime;

    let finalComments: ReviewComment[] = [];

    if (parsedResponse) {
      finalComments = await RepoConfigService.filterComments(parsedResponse.comments, repoId);
    } else if (fallbackComments.length > 0) {
      finalComments = await RepoConfigService.filterComments(fallbackComments, repoId);
    }

    const completeResponse: EnhancedAIReviewResponse = {
      request: requestData,
      response: {
        raw: rawResponse,
        parsed: parsedResponse,
        validationErrors: validationErrors,
        fallbackComments: fallbackComments,
        timestamp: responseTimestamp,
        processingTimeMs: processingTimeMs,
        retryCount: retryCount
      },
      metadata: {
        success: !error && !validationErrors && parsedResponse !== null,
        error: error,
        apiCallDuration: apiCallDuration,
        totalDuration: totalDuration,
        schemaValidationPassed: validationErrors === null,
        memorySnippetsUsed: 0, 
        finalCommentsCount: finalComments.length
      }
    };

    if (parsedResponse) {
      parsedResponse.comments = finalComments;
    }

    console.log('📊 Enhanced AI review completion summary:', {
      success: completeResponse.metadata.success,
      apiCallDuration: `${apiCallDuration}ms`,
      totalDuration: `${totalDuration}ms`,
      responseLength: rawResponse.length,
      parsedSuccessfully: parsedResponse !== null,
      validationErrors: validationErrors?.length || 0,
      finalCommentsCount: finalComments.length,
      retriesUsed: retryCount
    });

    return completeResponse;
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
      const fileLines = prContext.changedFiles.flatMap((file: { path: string; patch: string; additions: number; deletions: number }) =>
        file.patch.split('\n')
          .map((line: string, index: number) => ({
            file: file.path,
            line: index + 1,
            content: line
          }))
          .filter((item: { file: string; line: number; content: string }) => item.content.trim().length > 0)
      );

      const uniqueFiles = [...new Set(prContext.changedFiles.map((f: { path: string; patch: string; additions: number; deletions: number }) => f.path))];

      uniqueFiles.forEach((filePath: string) => {
        const fallbackComment = createFallbackComment(
          filePath,
          1,
          `AI analysis completed but response format was invalid. Manual review recommended. Raw response: ${rawResponse.substring(0, 200)}`
        );
        fallbackComments.push(fallbackComment);
      });

    } catch (error) {
      console.error('❌ Failed to generate fallback comments:', error);
      fallbackComments.push({
        filePath: prContext.changedFiles[0]?.path || 'unknown',
        line: 1,
        severity: 'minor',
        message: 'AI review failed - manual review recommended',
        rationale: 'The automated code review system encountered an error and was unable to complete the analysis.',
        suggestion: 'Please conduct a manual code review for this pull request.'
      });
    }

    return fallbackComments;
  }

  /**
   * Extract valid JSON from corrupted or malformed responses
   * Handles cases where the AI model adds markdown or repeated tokens
   */
  private static extractValidJson(response: string): string | null {
    // Remove markdown code blocks and backticks
    let cleaned = response
      .replace(/```json\n?/g, '')
      .replace(/```jsonc\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/`/g, '');

    // Remove common repeated token patterns (like repeated "jsonc")
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

    // Fix common issues:
    // 1. Remove any leading/trailing whitespace
    jsonString = jsonString.trim();

    // 2. Fix escaped newlines in strings (preserve actual newlines in JSON)
    jsonString = jsonString.replace(/\\n/g, '\\n');

    // 3. Handle unescaped quotes inside strings (basic approach)
    // This is tricky - try to balance quotes
    try {
      // Do a quick validation to see if it's valid
      JSON.parse(jsonString);
      return jsonString;
    } catch (e) {
      console.log('⚠️ Extracted JSON is still invalid, attempting repairs...');
      
      // Try to fix common issues
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

      return jsonString;
    }
  }

  /**
   * Utility method for delays between retries
   */
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test the enhanced AI review configuration
   */
  static async testEnhancedReviewConfig(): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      errors.push('OPENROUTER_API_KEY environment variable is required');
      return { isValid: false, errors };
    }

    try {
      console.log('🧪 Testing enhanced AI review configuration...');

      const response = await axios.post(
        `${OPENROUTER_BASE_URL}/chat/completions`,
        {
          model: DEFAULT_MODEL,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.status === 200) {
        console.log('✅ Enhanced AI review configuration is valid');
        return { isValid: true, errors: [] };
      } else {
        errors.push(`API returned status ${response.status}`);
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        errors.push(`API Error: ${error.response?.status} ${error.response?.statusText}`);
      } else {
        errors.push(`Connection Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { isValid: false, errors };
  }
}

/**
 * Legacy compatibility function - maps to enhanced service
 */
export async function generatePRReview(prContext: PRContext): Promise<any> {
  console.warn('⚠️ Using legacy generatePRReview function - consider migrating to EnhancedAIReviewService');

  const repoId = 0;

  const enhancedResponse = await EnhancedAIReviewService.generateEnhancedReview(prContext, repoId);

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
