


export function getPrimaryLLMModel(): string {
  const model = process.env.PRIMARY_GEMINI_MODEL;
  if (!model) {
    console.warn('⚠️ PRIMARY_GEMINI_MODEL environment variable not set. Using fallback model: gemini-1.5-flash');
    return 'gemini-1.5-flash';
  }
  return model;
}


export function getSecondaryLLMModel(): string {
  const model = process.env.SECONDARY_GEMINI_MODEL;
  if (!model) {
    console.warn('⚠️ SECONDARY_GEMINI_MODEL environment variable not set. Using fallback model: gemini-1.5-pro');
    return 'gemini-1.5-pro';
  }
  return model;
}


export function validatePrimaryLLMModel(): { isValid: boolean; errors: string[] } {
  const model = process.env.PRIMARY_GEMINI_MODEL;
  const errors: string[] = [];

  if (!model) {
    errors.push('PRIMARY_GEMINI_MODEL environment variable is required');
    return { isValid: false, errors };
  }

  if (model.trim().length === 0) {
    errors.push('PRIMARY_GEMINI_MODEL environment variable cannot be empty');
    return { isValid: false, errors };
  }

  return { isValid: true, errors: [] };
}


export function validateSecondaryLLMModel(): { isValid: boolean; errors: string[] } {
  const model = process.env.SECONDARY_GEMINI_MODEL;
  const errors: string[] = [];

  if (!model) {
    errors.push('SECONDARY_GEMINI_MODEL environment variable is required');
    return { isValid: false, errors };
  }

  if (model.trim().length === 0) {
    errors.push('SECONDARY_GEMINI_MODEL environment variable cannot be empty');
    return { isValid: false, errors };
  }

  return { isValid: true, errors: [] };
}


export function validateGeminiAPIKey(): { isValid: boolean; errors: string[] } {
  const apiKey = process.env.GEMINI_API_KEY;
  const errors: string[] = [];

  if (!apiKey) {
    errors.push('GEMINI_API_KEY environment variable is required');
    return { isValid: false, errors };
  }

  if (apiKey.trim().length === 0) {
    errors.push('GEMINI_API_KEY environment variable cannot be empty');
    return { isValid: false, errors };
  }

  return { isValid: true, errors: [] };
}
