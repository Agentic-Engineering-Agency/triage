/**
 * Atlassian Document Format (ADF) helpers.
 *
 * Jira Cloud REST API v3 requires ADF for `description` and `comment.body`
 * fields. Sending a plain string will return HTTP 400.
 *
 * These helpers convert between plain text and ADF for simple use cases.
 * For rich content (headings, lists, code blocks), construct ADF manually.
 */

// ============================================================
// Types
// ============================================================

export interface AdfTextNode {
  type: 'text';
  text: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface AdfParagraph {
  type: 'paragraph';
  content: AdfTextNode[];
}

export interface AdfDocument {
  type: 'doc';
  version: 1;
  content: AdfParagraph[];
}

// ============================================================
// Converters
// ============================================================

/**
 * Convert a plain-text string to ADF.
 * Splits on double-newlines into paragraphs. Empty input produces one empty paragraph.
 */
export function textToAdf(text: string): AdfDocument {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
    };
  }

  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((p) => ({
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text: p }],
    })),
  };
}

/**
 * Extract plain text from an ADF document.
 * Joins paragraphs with double-newlines.
 */
export function adfToPlainText(adf: AdfDocument | null | undefined): string {
  if (!adf || !adf.content) return '';
  return adf.content
    .map((block) =>
      block.content?.map((inline) => inline.text || '').join('') || '',
    )
    .join('\n\n');
}
