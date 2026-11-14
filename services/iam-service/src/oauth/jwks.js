/** Parse the signing key set without importing/initializing the OIDC provider. */
export function loadJwks() {
  const raw = process.env.OIDC_JWKS_JSON;
  if (!raw) {
    throw new Error(
      '[oidc.config] OIDC_JWKS_JSON env var is missing. ' +
        'Set it to a JSON string with a JWKS containing at least one RS256 signing key.',
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('[oidc.config] OIDC_JWKS_JSON is not valid JSON.');
  }
}
