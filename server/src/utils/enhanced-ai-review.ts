import { PRContext, StructuredAIReview, ReviewComment } from '../types';
import {
  validateStructuredAIReviewData,
  createFallbackComment
} from './schema-validation';
import { PromptBuilder } from './prompt-builder';
import { RepoConfigService } from '../models/repo-config';
import { FrameworkDetector } from './framework-detector';
import { HistoricalReviewService } from './historical-review-service';
import { GeminiLLMService } from './gemini-llm';


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


export class EnhancedAIReviewService {

  
  static async generateEnhancedReview(
    prContext: PRContext,
    repoId: number
  ): Promise<EnhancedAIReviewResponse> {
    const repoConfig = await RepoConfigService.getOrCreateConfig(repoId, prContext.repo);

    
    const frameworkInfo = await FrameworkDetector.detectFrameworks(prContext.changedFiles, prContext.repo);

    
    const historicalReviews = await HistoricalReviewService.getHistoricalReviews(repoId);

    
    const repoStats = await HistoricalReviewService.getRepoStats(repoId);

    console.log('🤖 Enhanced Gemini AI Review Context:', {
      frameworks: frameworkInfo.frameworks,
      languages: frameworkInfo.languages,
      historicalReviewsCount: historicalReviews.length,
      repoStats
    });

    
    const geminiResponse = await GeminiLLMService.generateEnhancedReview(prContext, repoId, {
      frameworkInfo,
      historicalReviews,
      repoConfig,
      promptBuilder: PromptBuilder
    });

    
    let finalComments: ReviewComment[] = [];

    if (geminiResponse.response.parsed) {
      finalComments = await RepoConfigService.filterComments(geminiResponse.response.parsed.comments, repoId);
    } else if (geminiResponse.response.fallbackComments.length > 0) {
      finalComments = await RepoConfigService.filterComments(geminiResponse.response.fallbackComments, repoId);
    }

    const enhancedResponse: EnhancedAIReviewResponse = {
      request: geminiResponse.request,
      response: {
        raw: geminiResponse.response.raw,
        parsed: geminiResponse.response.parsed,
        validationErrors: geminiResponse.response.validationErrors,
        fallbackComments: geminiResponse.response.fallbackComments,
        timestamp: geminiResponse.response.timestamp,
        processingTimeMs: geminiResponse.response.processingTimeMs,
        retryCount: geminiResponse.response.retryCount
      },
      metadata: {
        success: geminiResponse.metadata.success,
        error: geminiResponse.metadata.error,
        apiCallDuration: geminiResponse.metadata.apiCallDuration,
        totalDuration: geminiResponse.metadata.totalDuration,
        schemaValidationPassed: geminiResponse.metadata.schemaValidationPassed,
        memorySnippetsUsed: geminiResponse.metadata.memorySnippetsUsed,
        finalCommentsCount: finalComments.length
      }
    };

    
    if (enhancedResponse.response.parsed) {
      enhancedResponse.response.parsed.comments = finalComments;
    }

    console.log('📊 Enhanced Gemini review completion summary:', {
      success: enhancedResponse.metadata.success,
      apiCallDuration: `${enhancedResponse.metadata.apiCallDuration}ms`,
      totalDuration: `${enhancedResponse.metadata.totalDuration}ms`,
      responseLength: enhancedResponse.response.raw.length,
      parsedSuccessfully: enhancedResponse.response.parsed !== null,
      validationErrors: enhancedResponse.response.validationErrors?.length || 0,
      finalCommentsCount: finalComments.length,
      retriesUsed: enhancedResponse.response.retryCount
    });

    return enhancedResponse;
  }

  
  static async testEnhancedReviewConfig(): Promise<{ isValid: boolean; errors: string[] }> {
    return await GeminiLLMService.testGeminiConfig();
  }
}


export async function generatePRReview(prContext: PRContext): Promise<any> {
  console.warn('⚠️ Using legacy generatePRReview function - consider migrating to GeminiLLMService');

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
