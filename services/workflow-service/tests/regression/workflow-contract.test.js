/**
 * Regression — workflow-full contract fixture must remain publishable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertPublishable } from '../../src/services/invariants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../../../shared/contracts/__fixtures__/workflow-full.example.json'),
    'utf8',
  ),
);

describe('Workflow contract regression', () => {
  it('fixture has expected shape', () => {
    expect(fixture.status).toBe('PUBLISHED');
    expect(fixture.steps.length).toBeGreaterThan(1);
    expect(fixture.transitions.length).toBeGreaterThan(0);
  });

  it('shared workflow-full fixture passes publish invariants', () => {
    expect(() =>
      assertPublishable({ steps: fixture.steps, transitions: fixture.transitions }),
    ).not.toThrow();
  });
});
