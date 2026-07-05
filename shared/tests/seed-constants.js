/**
 * Stable UUIDs and codes from prisma/seed.js — use in integration/regression tests.
 */

export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export const TENANT_DCS01_ID = '11111111-1111-1111-1111-111111111111';
export const TENANT_DCS02_ID = '11111111-1111-1111-1111-111111111112';
export const TENANT_CPS_ID = '11111111-1111-1111-1111-111111111113';

export const ROLE_TENANT_ADMIN_ID = '55555555-5555-5555-5555-555555555555';
export const ROLE_SYSTEM_ADMIN_ID = '99999999-9999-9999-9999-999999999991';
export const ROLE_CASE_MANAGER_ID = '66666666-6666-6666-6666-666666666666';
export const ROLE_VIEWER_ID = '77777777-7777-7777-7777-777777777777';

export const TENANT_CODES = {
  DCS01: 'DCS-01',
  DCS02: 'DCS-02',
  CPS: 'CPS-GCPD',
};

/** Matches seed makeEmail(tenantCode, localPart). */
export function seedEmail(tenantCode, localPart) {
  return `${localPart}@${tenantCode.toLowerCase()}.gov.example`;
}
