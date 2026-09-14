import type { z } from 'zod';

export { MAIN_MODEL_COUNT, MAX_MODELS, MODEL_ID, aiSettingsSchema, type AiSettings } from '@/lib/spiel-ai';

export const firstIssueOf = (error: z.ZodError) => {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(' ')}: ${issue.message}` : 'Check the settings.';
};
