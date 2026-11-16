export const RESERVED_ADMIN_SLUGS = new Set(['iam-admin', 'system-admin', 'system_admin']);

export function isReservedAdminRole(role) {
  if (!role) return false;
  const slug = role.slug ? String(role.slug).trim().toLowerCase() : null;
  const name = role.name ? String(role.name).trim().toLowerCase() : null;
  if (slug && RESERVED_ADMIN_SLUGS.has(slug)) return true;
  if (name && (name === 'system_admin' || RESERVED_ADMIN_SLUGS.has(name))) return true;
  return false;
}

export function roleSlug(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'role';
}
