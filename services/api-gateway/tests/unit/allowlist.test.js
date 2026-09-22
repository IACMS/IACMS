import { describe, it, expect } from 'vitest';
import { getAllowlist } from '../../src/engine/allowlists/index.js';
import { InvalidQueryError } from '../../../../shared/common/errors.js';

describe('allowlist registry', () => {
  it('should return correct allowlist for valid entity', () => {
    const casesAllowlist = getAllowlist('cases');
    expect(casesAllowlist).toBeDefined();
    expect(casesAllowlist).toHaveProperty('prismaModel', 'case');
  });

  it('should throw InvalidQueryError for unknown entity', () => {
    expect(() => {
      getAllowlist('unknown');
    }).toThrow(InvalidQueryError);
  });
});
