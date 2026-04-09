import { createTool } from '@mastra/core/tools';
import { displayDuplicateInputSchema } from '../../lib/schemas';

export const displayDuplicateTool = createTool({
  id: 'displayDuplicate',
  description: 'Renders a duplicate detection prompt in the frontend when a similar existing ticket is found. Shows the existing ticket details and lets the user choose to update it or create a new one.',
  inputSchema: displayDuplicateInputSchema,
  execute: async (input) => {
    return input;
  },
});
