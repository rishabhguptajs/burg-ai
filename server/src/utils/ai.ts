import axios from 'axios';
import { z } from 'zod';
import { PRContext, AIReviewComment, AIReview, CompleteAIResponse } from '../types';


export const AIReviewSchema = z.object({
  summary: z.string(),
  comments: z.array(z.object({
    filePath: z.string(),
    line: z.number(),
    suggestion: z.string(),
    severity: z.enum(['low', 'medium', 'high'])
  }))
});

export type AIReviewResponse = z.infer<typeof AIReviewSchema>;


const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MODEL = 'x-ai/grok-4-fast:free';

/**
 * Generate AI-powered PR review using OpenRouter API - Returns EVERYTHING as JSON
 */
export async function generatePRReview(prContext: PRContext): Promise<CompleteAIResponse> {
  const startTime = Date.now();
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;

  if (!openRouterApiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }

  console.log('🤖 Starting AI PR review generation:', {
    repo: prContext.repo,
    prNumber: prContext.prNumber,
    filesChanged: prContext.changedFiles.length,
    timestamp: new Date().toISOString()
  });

  const prompt = createPRReviewPrompt(prContext);
  const requestTimestamp = new Date().toISOString();

  const requestData = {
    prContext: prContext,
    prompt: prompt,
    timestamp: requestTimestamp,
    model: MODEL,
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

    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are an expert code reviewer. Analyze pull requests and provide constructive feedback in JSON format. Focus on code quality, best practices, security, and potential bugs. Always respond with valid JSON matching the specified schema.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 4000,
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

    console.log('✅ AI response received, validating...');

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawResponse);
      processingTimeMs = Date.now() - apiCallStart;
    } catch (parseError) {
      console.error('❌ Failed to parse AI response as JSON:', rawResponse.substring(0, 500));
      validationErrors = [`Failed to parse as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`];
      processingTimeMs = Date.now() - apiCallStart;
    }

    if (parsedJson && !validationErrors) {
      const validationResult = AIReviewSchema.safeParse(parsedJson);

      if (!validationResult.success) {
        console.error('❌ AI response validation failed:', validationResult.error.format());
        validationErrors = validationResult.error.issues.map((err: any) => `${err.path.join('.')}: ${err.message}`);
        parsedResponse = null;
      } else {
        parsedResponse = validationResult.data;
        validationErrors = null;
        console.log('✅ AI response validation successful');
      }
    }

  } catch (err) {
    error = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ AI review generation failed:', error);

    if (axios.isAxiosError(err)) {
      console.error('OpenRouter API Error:', {
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data
      });
      error = `API Error ${err.response?.status}: ${err.response?.statusText}`;
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

  console.log('📊 Complete AI interaction summary:', {
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
 * Create a comprehensive prompt for PR review
 */
function createPRReviewPrompt(prContext: PRContext): string {
  const { repo, prNumber, title, description, changedFiles } = prContext;

  return `
Please analyze this pull request and provide a code review in the following JSON format:

{
  "summary": "Brief overall assessment of the PR",
  "comments": [
    {
      "filePath": "path/to/file.ext",
      "line": 42,
      "suggestion": "Specific suggestion or concern",
      "severity": "low|medium|high"
    }
  ]
}

PULL REQUEST DETAILS:
- Repository: ${repo}
- PR Number: ${prNumber}
- Title: ${title}
- Description: ${description || 'No description provided'}

CHANGED FILES:
${changedFiles.map(file => `
File: ${file.path}
Changes: +${file.additions} -${file.deletions}
Diff:
${file.patch}
`).join('\n')}

REVIEW GUIDELINES:
- Focus on code quality, best practices, security, and potential bugs
- Suggest specific improvements when possible
- Use appropriate severity levels (high for bugs/security issues, medium for important improvements, low for style/best practices)
- Be constructive and helpful
- Only comment on actual issues or improvements, not just differences
- Consider the context and purpose of the changes

Provide your review in valid JSON format only.
`;
}

/**
 * Validate AI review response
 */
export function validateAIReview(data: unknown): AIReviewResponse {
  return AIReviewSchema.parse(data);
}

/**
 * Test OpenRouter API configuration
 */
export async function testOpenRouterConfig(): Promise<{ isValid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    errors.push('OPENROUTER_API_KEY environment variable is required');
    return { isValid: false, errors };
  }

  try {
    console.log('🧪 Testing OpenRouter API connection...');

    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        model: MODEL,
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
      console.log('✅ OpenRouter API connection successful');
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
