/** Resolve the optional legacy tenant bridge. Set `none` to disable it. */
export function legacyOrganizationSystem() {
  const configured = process.env.IAM_LEGACY_ORGANIZATION_SYSTEM;
  if (configured === 'none') return null;
  return configured || 'iacms';
}
