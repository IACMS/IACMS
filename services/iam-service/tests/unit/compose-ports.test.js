import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Compose configuration security', () => {
  const iamComposePath = path.resolve(process.cwd(), 'compose.yaml');
  const iamProdExamplePath = path.resolve(process.cwd(), 'compose.prod.yaml');
  const infraComposePath = path.resolve(process.cwd(), '../../infrastructure/docker-compose.yml');

  it('binds iam-service ports to 127.0.0.1 in dev compose', () => {
    expect(fs.existsSync(iamComposePath)).toBe(true);
    const content = fs.readFileSync(iamComposePath, 'utf8');

    // Should not have bare port mappings like "${IAM_PORT:-3001}:3001" without 127.0.0.1
    expect(content).not.toMatch(/^\s*-\s*["']?\${IAM_PORT:-3001}:3001/m);
    expect(content).toMatch(/127\.0\.0\.1:\${IAM_PORT:-3001}:3001|127\.0\.0\.1:3001:3001/);
  });

  it('binds all published host ports in infrastructure dev compose to 127.0.0.1', () => {
    expect(fs.existsSync(infraComposePath)).toBe(true);
    const content = fs.readFileSync(infraComposePath, 'utf8');

    const portLines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- '") || l.startsWith('-"') || l.startsWith('- "'))
      .filter((l) => l.includes(':') && !l.includes('POSTGRES') && !l.includes('PLAINTEXT'));

    // Every exposed port mapping must specify 127.0.0.1
    for (const line of portLines) {
      if (line.match(/^-\s*['"][0-9]+:[0-9]+['"]/)) {
        throw new Error(`Found bare port mapping without 127.0.0.1 binding: ${line}`);
      }
    }
  });

  it('provides a production compose example for services/iam-service', () => {
    const exists = fs.existsSync(iamProdExamplePath);
    expect(exists).toBe(true);

    const prodContent = fs.readFileSync(iamProdExamplePath, 'utf8');
    expect(prodContent).toContain('iam-service');
    expect(prodContent).toContain('NODE_ENV: production');
  });
});
