/**
 * Unit tests — workflow validators.
 */
import { describe, it, expect } from 'vitest';
import { tenantIdHeader, parseUuidList } from '../../src/utils/validators.js';

describe('workflow validators', () => {
  it('tenantIdHeader returns trimmed header', () => {
    expect(tenantIdHeader({ headers: { 'x-tenant-id': '  abc  ' } })).toBe('abc');
    expect(tenantIdHeader({ headers: {} })).toBeNull();
  });

  it('parseUuidList maps strings', () => {
    expect(parseUuidList(['a', 'b'])).toEqual(['a', 'b']);
    expect(parseUuidList(null)).toEqual([]);
  });

  it('parseUuidList rejects non-arrays', () => {
    expect(() => parseUuidList('bad')).toThrow(/array/);
  });
});
