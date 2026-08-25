import { describe, it, expect } from 'vitest';
import { validateRequest } from '../../src/engine/queryValidator.js';
import { InvalidQueryError } from '../../../../shared/common/errors.js';

describe('queryValidator', () => {
  it('should validate a valid query request', () => {
    const validQuery = {
      operation: 'query',
      entity: 'cases',
      select: ['id', 'status'],
      filter: { status: 'OPEN' },
      pagination: { limit: 10, offset: 0 }
    };
    
    const result = validateRequest(validQuery);
    expect(result).toMatchObject({
      type: 'query',
      entity: 'cases',
      select: ['id', 'status']
    });
  });

  it('should validate a valid mutation request', () => {
    const validMutation = {
      operation: 'mutate',
      action: 'createCase',
      data: { title: 'Test Case' }
    };
    
    const result = validateRequest(validMutation);
    expect(result).toMatchObject({
      type: 'mutate',
      action: 'createCase'
    });
  });

  it('should throw InvalidQueryError for invalid payload', () => {
    expect(() => {
      validateRequest('not-an-object');
    }).toThrow(InvalidQueryError);
  });

  it('should throw InvalidQueryError for missing operation', () => {
    expect(() => {
      validateRequest({ entity: 'cases' });
    }).toThrow(InvalidQueryError);
  });

  it('should throw InvalidQueryError for unknown operation', () => {
    expect(() => {
      validateRequest({ operation: 'delete' });
    }).toThrow(InvalidQueryError);
  });

  it('should throw InvalidQueryError for missing fields in query', () => {
    expect(() => {
      validateRequest({ operation: 'query', entity: 'cases' }); // missing select
    }).toThrow(InvalidQueryError);
  });

  it('should throw InvalidQueryError for missing fields in mutation', () => {
    expect(() => {
      validateRequest({ operation: 'mutate', action: 'test' }); // missing data
    }).toThrow(InvalidQueryError);
  });
});
