import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Load service-local `.env` then repo-root `.env` (first wins; dotenv does not override).
 * Call from database.js before constructing DATABASE_URL defaults.
 */
export function loadServiceEnv(metaUrl, levelsUpToService = 2) {
  const configDir = path.dirname(fileURLToPath(metaUrl));
  const serviceRoot = path.resolve(configDir, ...Array(levelsUpToService).fill('..'));
  const repoRoot = path.resolve(serviceRoot, '..');

  const serviceEnv = path.join(serviceRoot, '.env');
  const rootEnv = path.join(repoRoot, '.env');

  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  }
  if (fs.existsSync(serviceEnv)) {
    dotenv.config({ path: serviceEnv, override: true });
  }
}
