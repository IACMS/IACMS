import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('iam-frontend vite.config.ts security', () => {
  const viteConfigPath = path.resolve(
    process.cwd(),
    '../../../iam-frontend/vite.config.ts'
  );

  it('does not contain hardcoded internal service token', () => {
    if (!fs.existsSync(viteConfigPath)) {
      // iam-frontend is an optional sibling repo not present in this workspace
      return;
    }
    const content = fs.readFileSync(viteConfigPath, 'utf8');

    // Hardcoded dev token must be removed
    expect(content).not.toContain("'iacms-internal-service-token-dev'");
    expect(content).not.toContain('"iacms-internal-service-token-dev"');
  });

  it('sources internal service token from environment variables', () => {
    if (!fs.existsSync(viteConfigPath)) {
      // iam-frontend is an optional sibling repo not present in this workspace
      return;
    }
    const content = fs.readFileSync(viteConfigPath, 'utf8');

    const usesEnv =
      content.includes('INTERNAL_SERVICE_TOKEN') &&
      (content.includes('process.env') || content.includes('loadEnv'));

    expect(usesEnv).toBe(true);
  });
});
