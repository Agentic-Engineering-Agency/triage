import { describe, it, expect } from 'vitest';
import { textToAdf, adfToPlainText } from './adf';

describe('ADF helpers', () => {
  describe('textToAdf', () => {
    it('converts single paragraph', () => {
      const result = textToAdf('Hello world');
      expect(result).toEqual({
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello world' }],
          },
        ],
      });
    });

    it('splits double-newlines into separate paragraphs', () => {
      const result = textToAdf('Paragraph one\n\nParagraph two\n\nParagraph three');
      expect(result.content).toHaveLength(3);
      expect(result.content[0].content[0].text).toBe('Paragraph one');
      expect(result.content[1].content[0].text).toBe('Paragraph two');
      expect(result.content[2].content[0].text).toBe('Paragraph three');
    });

    it('handles empty string with one empty paragraph', () => {
      const result = textToAdf('');
      expect(result.type).toBe('doc');
      expect(result.version).toBe(1);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].content[0].text).toBe('');
    });

    it('trims whitespace from paragraphs', () => {
      const result = textToAdf('  hello  \n\n  world  ');
      expect(result.content[0].content[0].text).toBe('hello');
      expect(result.content[1].content[0].text).toBe('world');
    });

    it('version is always integer 1', () => {
      const result = textToAdf('test');
      expect(result.version).toBe(1);
      expect(typeof result.version).toBe('number');
    });
  });

  describe('adfToPlainText', () => {
    it('extracts text from ADF document', () => {
      const adf = {
        type: 'doc' as const,
        version: 1 as const,
        content: [
          { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Hello' }] },
          { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'World' }] },
        ],
      };
      expect(adfToPlainText(adf)).toBe('Hello\n\nWorld');
    });

    it('returns empty string for null/undefined', () => {
      expect(adfToPlainText(null)).toBe('');
      expect(adfToPlainText(undefined)).toBe('');
    });

    it('roundtrips text -> ADF -> text', () => {
      const original = 'First paragraph\n\nSecond paragraph';
      const adf = textToAdf(original);
      const result = adfToPlainText(adf);
      expect(result).toBe(original);
    });
  });
});
