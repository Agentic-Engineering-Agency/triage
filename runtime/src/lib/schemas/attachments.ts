import { z } from 'zod';

// ---------------------------------------------------------------------------
// Attachment type — supported file types for incident attachments
// ---------------------------------------------------------------------------

/** Supported attachment file types */
export const attachmentTypeSchema = z
  .enum(['image', 'pdf', 'text', 'log'])
  .describe('Type of attached file: image, pdf, text, or log');

export type AttachmentType = z.infer<typeof attachmentTypeSchema>;

// ---------------------------------------------------------------------------
// Single attachment — one file attached to an incident report
// ---------------------------------------------------------------------------

/** A single file attachment with its content */
export const singleAttachmentSchema = z.object({
  /** Type of the attached file */
  type: attachmentTypeSchema,

  /** Original filename of the attachment */
  filename: z.string().describe('Original filename of the attachment'),

  /** File content — base64 for binary formats, raw text for text/logs */
  content: z
    .string()
    .describe('base64 encoded content for images/PDFs, raw text for text/logs'),

  /** MIME type of the attachment (e.g., image/png, application/pdf) */
  mimeType: z
    .string()
    .optional()
    .describe('MIME type of the attachment (e.g., image/png, application/pdf)'),
});

export type SingleAttachment = z.infer<typeof singleAttachmentSchema>;

// ---------------------------------------------------------------------------
// Process attachments input — incident description + attached files
// ---------------------------------------------------------------------------

/** Input for the process-attachments tool */
export const processAttachmentsInputSchema = z.object({
  /** Original incident description from the user */
  description: z
    .string()
    .describe('Original incident description from user'),

  /** Files attached to the incident report */
  attachments: z
    .array(singleAttachmentSchema)
    .describe('Files attached to the incident report'),
});

export type ProcessAttachmentsInput = z.infer<typeof processAttachmentsInputSchema>;

// ---------------------------------------------------------------------------
// Process attachments output — enriched description after analysis
// ---------------------------------------------------------------------------

/** Output from the process-attachments tool */
export const processAttachmentsOutputSchema = z.object({
  /** Original description enriched with insights extracted from attachments */
  enrichedDescription: z
    .string()
    .describe('Original description enriched with attachment analysis'),
});

export type ProcessAttachmentsOutput = z.infer<typeof processAttachmentsOutputSchema>;
