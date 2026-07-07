import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../../../shared/contracts/__fixtures__/workflow-full.example.json'),
    'utf8',
  ),
);

describe('case-service workflow contract', () => {
  it('consumes workflow fixture contract fields', () => {
    expect(Object.prototype.hasOwnProperty.call(fixture, 'departmentId')).toBe(true);
    const stepKeys = new Set(fixture.steps.map((s) => s.id));
    for (const t of fixture.transitions) {
      expect(stepKeys.has(t.fromStepId)).toBe(true);
      expect(stepKeys.has(t.toStepId)).toBe(true);
    }
  });
});
