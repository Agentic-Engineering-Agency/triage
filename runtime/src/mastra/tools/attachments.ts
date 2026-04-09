import { createTool } from '@mastra/core/tools';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { MODELS } from '../../lib/config';
import { processAttachmentsInputSchema, processAttachmentsOutputSchema } from '../../lib/schemas';

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export const processAttachmentsTool = createTool({
  id: 'process-attachments',
  description: 'Processes incident attachments (images, PDFs, text files) and returns an enriched description combining the original text with extracted attachment content.',
  inputSchema: processAttachmentsInputSchema,
  outputSchema: processAttachmentsOutputSchema,
  execute: async (input) => {
    try {
      const { description, attachments } = input;
      if (!attachments || attachments.length === 0) {
        return { enrichedDescription: description };
      }

      const attachmentDescriptions: string[] = [];

      for (const attachment of attachments) {
        switch (attachment.type) {
          case 'image': {
            // Use Gemma 4 31B vision model
            const result = await generateText({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              model: openrouter(MODELS.vision) as any,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'image',
                      image: attachment.content, // base64
                    },
                    {
                      type: 'text',
                      text: `Describe this image in the context of an SRE incident report. Focus on error messages, stack traces, dashboard metrics, or any technical details visible. Filename: ${attachment.filename}`,
                    },
                  ],
                },
              ],
            });
            attachmentDescriptions.push(`[Image: ${attachment.filename}]\n${result.text}`);
            break;
          }

          case 'pdf': {
            // Use OpenRouter file-parser plugin with Cloudflare AI engine
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: MODELS.mercury,
                messages: [
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'file',
                        file: {
                          filename: attachment.filename,
                          file_data: `data:application/pdf;base64,${attachment.content}`,
                        },
                      },
                      {
                        type: 'text',
                        text: 'Extract and summarize the key technical details from this document relevant to SRE incident triage. Focus on error details, affected services, timelines, and root cause indicators.',
                      },
                    ],
                  },
                ],
                plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }],
              }),
            });

            const data = await response.json();
            const pdfText = data?.choices?.[0]?.message?.content ?? 'Unable to extract PDF content';
            attachmentDescriptions.push(`[PDF: ${attachment.filename}]\n${pdfText}`);
            break;
          }

          case 'text':
          case 'log': {
            // Pass-through for text and logs
            attachmentDescriptions.push(`[${attachment.type.toUpperCase()}: ${attachment.filename}]\n${attachment.content}`);
            break;
          }
        }
      }

      const enrichedDescription = attachmentDescriptions.length > 0
        ? `${description}\n\n[ATTACHMENTS]\n${attachmentDescriptions.join('\n\n')}`
        : description;

      return { enrichedDescription };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[process-attachments] Error: ${message}`);
      return { enrichedDescription: input.description };
    }
  },
});
