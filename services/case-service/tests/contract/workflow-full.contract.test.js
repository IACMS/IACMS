import test from 'node:test';
import assert from 'node:assert/strict';
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

test('case-service consumes workflow fixture contract fields', () => {
  const stepKeys = new Set(fixture.steps.map(s => s.id));
  for (const t of fixture.transitions) {
    assert.ok(stepKeys.has(t.fromStepId));
    assert.ok(stepKeys.has(t.toStepId));
  }
});
