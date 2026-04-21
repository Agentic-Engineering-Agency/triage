import { createTool } from '@mastra/core/tools';
import { generateText } from 'ai';
import { MODELS } from '../../lib/config';
import { resolveKey } from '../../lib/tenant-keys';
import { resolveOpenRouterFromProjectId } from '../../lib/tenant-openrouter';
import { processAttachmentsInputSchema, processAttachmentsOutputSchema } from '../../lib/schemas';

type ToolCtx = { requestContext?: { get: (key: string) => unknown } } | undefined;

export const processAttachmentsTool = createTool({
  id: 'process-attachments',
  description: 'Processes incident attachments (images, PDFs, text files) and returns an enriched description combining the original text with extracted attachment content.',
  inputSchema: processAttachmentsInputSchema,
  outputSchema: processAttachmentsOutputSchema,
  execute: async (
    input: { context: Record<string, unknown> } | Record<string, unknown>,
    toolCtx?: ToolCtx,
  ) => {
    try {
      const ctx = ((input as { context?: Record<string, unknown> })?.context ?? input) as {
        description: string;
        attachments?: Array<{ type: 'image' | 'pdf' | 'text' | 'log'; filename: string; content: string }>;
      };
      const { description, attachments } = ctx;
      if (!attachments || attachments.length === 0) {
        return { enrichedDescription: description };
      }

      // Resolve per-tenant OpenRouter once for this invocation — both branches
      // (image via AI SDK, PDF via raw fetch) share the same key.
      const projectId = toolCtx?.requestContext?.get('projectId') as string | undefined;
      const openrouter = await resolveOpenRouterFromProjectId(projectId);

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
            // Raw fetch uses file-parser plugin + Cloudflare AI engine. The
            // AI SDK wrapper doesn't expose that plugin path, so we hit the
            // chat/completions endpoint directly. Resolve the Bearer token
            // per-tenant to mirror the AI SDK path above — otherwise the PDF
            // branch would always charge the env key even when the image
            // branch (in the same call) uses a tenant key.
            const { key: apiKey } = await resolveKey('openrouter', projectId);
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey ?? ''}`,
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
      const ctx = ((input as { context?: Record<string, unknown> })?.context ?? input) as { description: string };
      return { enrichedDescription: ctx.description };
    }
  },
});
