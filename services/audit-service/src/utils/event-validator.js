/**
 * Validates audit.log Kafka payloads against shared/contracts/audit-event.schema.json
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Docker: `/app/src/utils` → `/app/shared/...`. Dev: `services/audit-service/src/utils` → repo root `shared/...`. */
function loadSchema() {
  const candidates = [
    join(__dirname, '../../../shared/contracts/audit-event.schema.json'),
    join(__dirname, '../../../../shared/contracts/audit-event.schema.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf8'));
    }
  }
  throw new Error(
    `audit-event.schema.json not found (tried: ${candidates.join(', ')})`
  );
}

const schema = loadSchema();

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateCompiled = ajv.compile(schema);

/** @returns {true | string} */
export function validateAuditKafkaPayload(data) {
  if (validateCompiled(data)) return true;
  return ajv.errorsText(validateCompiled.errors, { separator: '; ' }) || 'schema_validation_failed';
}
