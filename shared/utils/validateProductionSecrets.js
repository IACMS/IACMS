/**
 * Fail fast when required secrets are missing or still set to known dev defaults.
 * Call at service startup before listening on a port.
 */

const KNOWN_INSECURE_VALUES = new Set([
  'iacms-dev-secret-key-change-in-production',
  'iacms-session-secret-change-in-production',
  'change-this-secret-key',
  'change-this-secret-key-in-production-use-openssl-rand-base64-32',
  'change-me',
  'minioadmin',
  'postgres',
]);

/**
 * @param {Array<{ name: string, value: string | undefined, minLength?: number, required?: boolean }>} checks
 */
export function assertProductionSecrets(checks) {
  if (process.env.NODE_ENV !== 'production') return;

  const failures = [];

  for (const { name, value, minLength = 32, required = true } of checks) {
    if (!value || String(value).trim() === '') {
      if (required) failures.push(`${name} is not set`);
      continue;
    }
    const v = String(value);
    if (v.length < minLength) {
      failures.push(`${name} must be at least ${minLength} characters in production`);
    }
    if (KNOWN_INSECURE_VALUES.has(v)) {
      failures.push(`${name} must not use the default development value`);
    }
  }

  if (failures.length) {
    console.error('[startup] Production secret validation failed:');
    for (const msg of failures) console.error(`  - ${msg}`);
    process.exit(1);
  }
}
