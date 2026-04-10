import { createTool } from '@mastra/core/tools';
import { displayTriageInputSchema } from '../../lib/schemas';

export const displayTriageTool = createTool({
  id: 'displayTriage',
  description: 'Renders a triage card in the frontend showing incident severity, summary, and proposed actions. Call this after analyzing an incident to present findings to the user.',
  inputSchema: displayTriageInputSchema,
  execute: async (input) => {
    return input;
  },
});
