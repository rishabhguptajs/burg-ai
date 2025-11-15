import { PRContext, AIReviewComment, AIReview, CompleteAIResponse } from '../types';
import {
  GeminiLLMService,
  AIReviewSchema,
  AIReviewResponse,
  generatePRReview as geminiGeneratePRReview,
  validateAIReview as geminiValidateAIReview,
  testOpenRouterConfig as geminiTestConfig
} from './gemini-llm';


export async function generatePRReview(prContext: PRContext): Promise<CompleteAIResponse> {
  return await geminiGeneratePRReview(prContext);
}


export function validateAIReview(data: unknown): AIReviewResponse {
  return geminiValidateAIReview(data);
}


export async function testOpenRouterConfig(): Promise<{ isValid: boolean; errors: string[] }> {
  return await geminiTestConfig();
}
