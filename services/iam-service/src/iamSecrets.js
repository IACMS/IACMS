const KNOWN_INSECURE_VALUES = new Set([
  'iacms-dev-secret-key-change-in-production', 'iacms-session-secret-change-in-production',
  'change-this-secret-key', 'change-this-secret-key-in-production-use-openssl-rand-base64-32',
  'change-me', 'minioadmin', 'postgres',
]);

export function assertProductionSecrets(checks) {
  if (process.env.NODE_ENV !== 'production') return;
  const failures = [];
  for (const { name, value, minLength = 32, required = true } of checks) {
    if (!value || String(value).trim() === '') {
      if (required) failures.push(`${name} is not set`);
      continue;
    }
    if (String(value).length < minLength) failures.push(`${name} must be at least ${minLength} characters in production`);
    if (KNOWN_INSECURE_VALUES.has(String(value))) failures.push(`${name} must not use a known insecure default`);
  }
  if (failures.length) {
    console.error('[IAM startup] Production secret validation failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
}
