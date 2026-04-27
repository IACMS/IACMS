/**
 * Ensures the API Gateway no longer uses PostgreSQL for session storage.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '../package.json');
const sessionConfigPath = join(__dirname, '../src/config/session.config.js');

describe('Session storage migration (no PostgreSQL)', () => {
  it('api-gateway package.json does not depend on pg or connect-pg-simple', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps).not.toHaveProperty('pg');
    expect(deps).not.toHaveProperty('connect-pg-simple');
    expect(deps).toHaveProperty('redis');
    expect(deps).toHaveProperty('connect-redis');
  });

  it('session.config.js does not reference user_sessions, connect-pg-simple, or pg', () => {
    const src = readFileSync(sessionConfigPath, 'utf8');
    expect(src).not.toMatch(/user_sessions/i);
    expect(src).not.toMatch(/connect-pg-simple/);
    expect(src).not.toMatch(/from ['"]pg['"]/);
  });

});
