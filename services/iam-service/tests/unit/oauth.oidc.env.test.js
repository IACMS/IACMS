import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadJwks } from '../../src/oauth/oidc.config.js';

describe('OIDC JWKS and Environment Validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OIDC_JWKS_JSON;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws descriptive error if OIDC_JWKS_JSON is not defined', () => {
    delete process.env.OIDC_JWKS_JSON;
    expect(() => loadJwks()).toThrow('[oidc.config] OIDC_JWKS_JSON env var is missing');
  });

  it('throws descriptive error if OIDC_JWKS_JSON is an empty string', () => {
    process.env.OIDC_JWKS_JSON = '';
    expect(() => loadJwks()).toThrow('[oidc.config] OIDC_JWKS_JSON env var is missing');
  });

  it('throws descriptive error if OIDC_JWKS_JSON is invalid JSON', () => {
    process.env.OIDC_JWKS_JSON = 'not-a-json-string';
    expect(() => loadJwks()).toThrow('[oidc.config] OIDC_JWKS_JSON is not valid JSON');
  });

  it('successfully parses valid JWKS JSON', () => {
    const validJwks = {
      keys: [
        {
          kty: 'RSA',
          use: 'sig',
          alg: 'RS256',
          kid: 'test-key-id',
          n: 'sample-modulus',
          e: 'AQAB',
        },
      ],
    };
    process.env.OIDC_JWKS_JSON = JSON.stringify(validJwks);

    const parsed = loadJwks();
    expect(parsed).toEqual(validJwks);
    expect(parsed.keys).toHaveLength(1);
    expect(parsed.keys[0].kid).toBe('test-key-id');
  });
});

