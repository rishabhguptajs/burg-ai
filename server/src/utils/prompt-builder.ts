import { BurgAIReviewPrompt } from '../prompts';


export class PromptBuilder {
  
  static buildReviewPrompt(options: {
    repoId: string;
    prNumber: number;
    files: any[];
    memoryContext?: string;
    historicalReviews?: any[];
    frameworkInfo?: any;
    repoConfig?: any;
  }): string {
    return BurgAIReviewPrompt.buildPrompt(options);
  }

}
