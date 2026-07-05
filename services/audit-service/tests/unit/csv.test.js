/**
 * Unit tests — AuditLog CSV export helper.
 */
import { describe, it, expect } from 'vitest';
import { csvEscape } from '../../src/utils/csv.js';

describe('AuditLog export — csvEscape', () => {
  it('quotes fields containing commas', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('escapes double quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('returns empty string for null', () => {
    expect(csvEscape(null)).toBe('');
  });
});
