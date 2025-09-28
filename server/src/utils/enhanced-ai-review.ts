import axios from 'axios';
import { PRContext } from './ai';
import {
  StructuredAIReview,
  ReviewComment,
  validateStructuredAIReviewData,
  createFallbackComment
} from './schema-validation';
import { PromptBuilder } from './prompt-builder';
import { RepoConfigService } from '../models/repo-config';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'x-ai/grok-4-fast:free';

/**
 * Enhanced AI review response with comprehensive tracking
 */
export interface EnhancedAIReviewResponse {
  request: {
    prContext: PRContext;
    prompt: string;
    timestamp: string;
    model: string;
    temperature: number;
    maxTokens: number;
    repoConfig: any;
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
  private static readonly MAX_RETRIES = 2;
  private static readonly RETRY_DELAY_MS = 1000;

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

    const prompt = PromptBuilder.buildReviewPrompt({
      repoId: repoId.toString(),
      prNumber: prContext.prNumber,
      files: prContext.changedFiles
    });

    const requestData = {
      prContext,
      prompt,
      timestamp: new Date().toISOString(),
      model: repoConfig.aiSettings?.model || DEFAULT_MODEL,
      temperature: repoConfig.aiSettings?.temperature || 0.1,
      maxTokens: repoConfig.aiSettings?.maxTokens || 4000,
      repoConfig
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
                content: 'You are an expert code reviewer. Analyze the provided code changes and respond with valid JSON matching the specified schema. Do not include any text outside of the JSON structure.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: requestData.temperature,
            max_tokens: requestData.maxTokens,
            response_format: { type: 'json_object' }
          },
          {
            headers: {
              'Authorization': `Bearer ${openRouterApiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.APP_URL || 'http://localhost:8000',
              'X-Title': 'Burg AI PR Reviewer'
            },
            timeout: 60000
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
          parsedJson = JSON.parse(rawResponse);
          processingTimeMs = Date.now() - apiCallStart;
        } catch (parseError) {
          console.error('❌ Failed to parse AI response as JSON:', rawResponse.substring(0, 500));
          validationErrors = [`Failed to parse as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`];

          if (attempt < this.MAX_RETRIES) {
            console.log(`🔄 Retrying after JSON parse failure...`);
            await this.delay(this.RETRY_DELAY_MS);
            continue;
          }
          break;
        }

        const validation = validateStructuredAIReviewData(parsedJson);

        if (!validation.isValid) {
          console.error('❌ AI response validation failed:', validation.errors);
          validationErrors = validation.errors || null;

          if (attempt === this.MAX_RETRIES) {
            fallbackComments = this.generateFallbackComments(rawResponse, prContext);
          }

          if (attempt < this.MAX_RETRIES) {
            console.log(`🔄 Retrying after validation failure...`);
            await this.delay(this.RETRY_DELAY_MS);
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
        console.error(`❌ AI review generation failed (attempt ${attempt + 1}):`, error);

        if (axios.isAxiosError(err)) {
          console.error('OpenRouter API Error:', {
            status: err.response?.status,
            statusText: err.response?.statusText,
            data: err.response?.data
          });
          error = `API Error ${err.response?.status}: ${err.response?.statusText}`;
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
      const fileLines = prContext.changedFiles.flatMap(file =>
        file.patch.split('\n')
          .map((line, index) => ({
            file: file.path,
            line: index + 1,
            content: line
          }))
          .filter(item => item.content.trim().length > 0)
      );

      const uniqueFiles = [...new Set(prContext.changedFiles.map(f => f.path))];

      uniqueFiles.forEach(filePath => {
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
