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

describe('workflow-full fixture contract', () => {
  it('has expected shape', () => {
    expect(typeof fixture.id).toBe('string');
    expect(Object.prototype.hasOwnProperty.call(fixture, 'departmentId')).toBe(true);
    expect(Array.isArray(fixture.steps)).toBe(true);
    expect(Array.isArray(fixture.transitions)).toBe(true);
    expect(fixture.status).toBe('PUBLISHED');
  });
});
