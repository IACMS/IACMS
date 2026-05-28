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

test('workflow-full fixture shape', () => {
  assert.equal(typeof fixture.id, 'string');
  assert.ok(Array.isArray(fixture.steps));
  assert.ok(Array.isArray(fixture.transitions));
  assert.equal(fixture.status, 'PUBLISHED');
});
