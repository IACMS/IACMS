import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertProductionSecrets } from '../utils/validateProductionSecrets.js';

describe('assertProductionSecrets', () => {
  const originalEnv = process.env.NODE_ENV;
  let exitSpy;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('does nothing outside production', () => {
    process.env.NODE_ENV = 'development';
    assertProductionSecrets([{ name: 'JWT_SECRET', value: undefined }]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('exits when a required secret is missing in production', () => {
    process.env.NODE_ENV = 'production';
    assertProductionSecrets([{ name: 'JWT_SECRET', value: undefined }]);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits when a secret uses a known dev default in production', () => {
    process.env.NODE_ENV = 'production';
    assertProductionSecrets([
      { name: 'JWT_SECRET', value: 'iacms-dev-secret-key-change-in-production' },
    ]);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('passes when secrets are sufficiently strong in production', () => {
    process.env.NODE_ENV = 'production';
    assertProductionSecrets([
      {
        name: 'JWT_SECRET',
        value: 'x'.repeat(48),
      },
    ]);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
