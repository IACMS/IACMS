/**
 * test_phase4_e2e_isolation.js
 *
 * Comprehensive End-to-End Test Suite for Multi-Project Identity Provider Architecture:
 *  - T1: Legitimate IACMS Login (Audience https://cases.iacms.gov/api)
 *  - T2: Cross-Project Denial (Project B Token Replay against Case Engine -> 403 Forbidden invalid_audience)
 *  - T3: Least-Privilege Multi-Project Role Isolation (Charlie has different roles per app)
 *  - T4: Per-Application Role Revocation without Cross-Project Side Effects
 *  - T5: Gateway OIDC RS256 Bearer Session & RBAC Hydration
 */

import crypto from 'node:crypto';

const IAM_BASE = 'http://localhost:3001';
const GATEWAY_BASE = 'http://localhost:3000';
const CASE_ENGINE_BASE = 'http://localhost:3003';

const SUPERADMIN_CREDENTIALS = {
  email: 'platform.admin@iacms.gov.example',
  password: 'password123',
};

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkce() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  saveCookies(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const cookieStr of raw) {
      if (!cookieStr) continue;
      const parts = cookieStr.split(';')[0].split('=');
      const name = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      this.cookies.set(name, value);
    }
  }
  getCookieHeader() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function performOidcPkceLogin({ clientId, redirectUri, email, password, scope }) {
  const { verifier, challenge } = generatePkce();
  const jar = new CookieJar();
  const state = `state_${base64Url(crypto.randomBytes(16))}`;

  const authUrl = `${IAM_BASE}/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;

  let res = await fetch(authUrl, { redirect: 'manual' });
  jar.saveCookies(res);
  let loc = res.headers.get('location');

  if (loc && loc.startsWith('/')) loc = `${IAM_BASE}${loc}`;

  // Follow to interaction
  res = await fetch(loc, { headers: { Cookie: jar.getCookieHeader() }, redirect: 'manual' });
  jar.saveCookies(res);

  const uid = loc.split('/interaction/')[1]?.split('?')[0];

  // Submit credentials
  res = await fetch(`${IAM_BASE}/oauth/interaction/${uid}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jar.getCookieHeader(),
    },
    body: new URLSearchParams({ email, password }).toString(),
    redirect: 'manual',
  });
  jar.saveCookies(res);
  loc = res.headers.get('location');

  while (loc && !loc.includes('code=')) {
    if (loc.startsWith('/')) loc = `${IAM_BASE}${loc}`;
    res = await fetch(loc, { headers: { Cookie: jar.getCookieHeader() }, redirect: 'manual' });
    jar.saveCookies(res);
    loc = res.headers.get('location');

    // Confirm consent if prompted
    if (loc && loc.includes('/interaction/') && !loc.includes('/confirm')) {
      const consentUid = loc.split('/interaction/')[1]?.split('?')[0];
      res = await fetch(`${IAM_BASE}/oauth/interaction/${consentUid}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: jar.getCookieHeader(),
        },
        body: new URLSearchParams({}).toString(),
        redirect: 'manual',
      });
      jar.saveCookies(res);
      loc = res.headers.get('location');
    }
  }

  if (!loc || !loc.includes('code=')) {
    throw new Error(`Failed to obtain authorization code. Final location: ${loc}`);
  }

  const code = new URL(loc).searchParams.get('code');

  // Exchange code for token
  res = await fetch(`${IAM_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const tokenData = await res.json();
  if (!res.ok || !tokenData.access_token) {
    throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  const payload = JSON.parse(Buffer.from(tokenData.access_token.split('.')[1], 'base64').toString());

  return { tokenData, payload };
}

async function runTests() {
  console.log('================================================================');
  console.log('🚀 RUNNING PHASE 4: E2E MULTI-PROJECT ISOLATION & OIDC TEST SUITE');
  console.log('================================================================\n');

  // ── Step 0: Superadmin Login for Administration ─────────────────────────
  console.log('>>> [Admin Setup] Authenticating Platform Superadmin...');
  const adminLoginRes = await fetch(`${IAM_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(SUPERADMIN_CREDENTIALS),
  });
  if (!adminLoginRes.ok) throw new Error(`Superadmin login failed with status ${adminLoginRes.status}`);
  const adminLoginData = await adminLoginRes.json();
  const adminToken = adminLoginData.accessToken;
  if (!adminToken) throw new Error('Failed to obtain superadmin token');
  console.log('✓ Superadmin authenticated.');

  // Fetch available roles
  const rolesRes = await fetch(`${IAM_BASE}/roles`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const rolesData = await rolesRes.json();
  const allRoles = rolesData.roles || [];
  const supervisorRole = allRoles.find((r) => r.name === 'supervisor') || allRoles[0];
  const viewerRole = allRoles.find((r) => r.name === 'viewer') || allRoles[allRoles.length - 1];
  console.log(`✓ Resolved roles for test matrix: Role 1 = ${supervisorRole.name} (${supervisorRole.id}), Role 2 = ${viewerRole.name} (${viewerRole.id})`);

  // ── Step 1: Provision Project B Client with Target Audience ─────────────
  console.log('\n>>> [Admin Setup] Registering Project B Client (Audience: https://project-b.gov/api)...');
  const projectBPayload = {
    name: 'Project B Police & Field Command',
    redirectUris: ['http://localhost:5173/auth/callback', 'http://localhost:4000/callback'],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none',
    scope: 'openid profile email roles',
    targetAudience: 'https://project-b.gov/api',
  };

  const createBRes = await fetch(`${IAM_BASE}/oauth/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(projectBPayload),
  });
  const createBData = await createBRes.json();
  const projectB = createBData.client;
  console.log(`✓ Project B Client created: clientId=${projectB.clientId}, targetAudience=${projectB.targetAudience}`);

  // Fetch iacms_portal client record
  const clientsListRes = await fetch(`${IAM_BASE}/oauth/clients`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const clientsList = await clientsListRes.json();
  const iacmsPortal = clientsList.clients.find((c) => c.clientId === 'iacms_portal');
  if (!iacmsPortal) throw new Error('iacms_portal client record not found');
  console.log(`✓ Found iacms_portal Client: id=${iacmsPortal.id}, targetAudience=${iacmsPortal.targetAudience}`);

  const testUser = {
    id: adminLoginData.user.id,
    email: adminLoginData.user.email,
  };

  // ── Step 2: Assign Isolated Roles for Charlie across Projects ───────────
  console.log('\n>>> [Role Provisioning] Assigning distinct roles per application for test user:');
  console.log(`    - IACMS Portal (${iacmsPortal.clientId}) -> Role: ${supervisorRole.name}`);
  console.log(`    - Project B (${projectB.clientId})       -> Role: ${viewerRole.name}`);

  // Clean existing user application roles for these clients if any
  await fetch(`${IAM_BASE}/oauth/clients/${iacmsPortal.id}/users/${testUser.id}/roles/${supervisorRole.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  }).catch(() => {});
  await fetch(`${IAM_BASE}/oauth/clients/${projectB.id}/users/${testUser.id}/roles/${viewerRole.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  }).catch(() => {});

  // Assign supervisor to IACMS
  const assignIacmsRes = await fetch(`${IAM_BASE}/oauth/clients/${iacmsPortal.id}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ userId: testUser.id, roleId: supervisorRole.id }),
  });
  if (!assignIacmsRes.ok) throw new Error('Failed to assign IACMS role');

  // Assign viewer to Project B
  const assignBRes = await fetch(`${IAM_BASE}/oauth/clients/${projectB.id}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ userId: testUser.id, roleId: viewerRole.id }),
  });
  if (!assignBRes.ok) throw new Error('Failed to assign Project B role');
  console.log('✓ Per-application roles assigned successfully.');

  try {
    // ══════════════════════════════════════════════════════════════════════
    // TEST T1: Standard Legitimate IACMS Login
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n----------------------------------------------------------------');
    console.log('TEST T1: Legitimate IACMS Client OIDC PKCE Flow & Audience Verification');
    console.log('----------------------------------------------------------------');
    const iacmsAuth = await performOidcPkceLogin({
      clientId: 'iacms_portal',
      redirectUri: 'http://localhost:5173/auth/callback',
      email: SUPERADMIN_CREDENTIALS.email,
      password: SUPERADMIN_CREDENTIALS.password,
      scope: 'openid profile email roles cases:read',
    });

    console.log('  Token audience (aud):', iacmsAuth.payload.aud);
    console.log('  Token roles:         ', iacmsAuth.payload.roles);

    if (iacmsAuth.payload.aud !== 'https://cases.iacms.gov/api') {
      throw new Error(`Expected audience https://cases.iacms.gov/api, got ${iacmsAuth.payload.aud}`);
    }
    if (!iacmsAuth.payload.roles.includes(supervisorRole.id)) {
      throw new Error(`Expected role ${supervisorRole.id} in IACMS token, got: ${JSON.stringify(iacmsAuth.payload.roles)}`);
    }
    if (iacmsAuth.payload.roles.includes(viewerRole.id)) {
      throw new Error(`PRIVILEGE LEAKAGE DETECTED! Project B role ${viewerRole.id} leaked into IACMS token!`);
    }

    // Call Case Engine with IACMS Token
    const caseEngineRes = await fetch(`${CASE_ENGINE_BASE}/cases`, {
      headers: { Authorization: `Bearer ${iacmsAuth.tokenData.access_token}` },
    });
    console.log(`  Case Engine verification status: ${caseEngineRes.status}`);
    if (caseEngineRes.status === 403) {
      const errBody = await caseEngineRes.text();
      if (errBody.includes('invalid_audience')) {
        throw new Error('Case engine unexpectedly rejected valid IACMS audience token!');
      }
    }
    console.log('✅ TEST T1 PASSED: Valid IACMS token minted with correct audience and non-leaked roles.');

    // ══════════════════════════════════════════════════════════════════════
    // TEST T2: Cross-Project Access Denial (Token Replay Attack)
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n----------------------------------------------------------------');
    console.log('TEST T2: Cross-Project Denial - Project B Token Replayed on Case Engine');
    console.log('----------------------------------------------------------------');
    const projectBAuth = await performOidcPkceLogin({
      clientId: projectB.clientId,
      redirectUri: 'http://localhost:5173/auth/callback',
      email: SUPERADMIN_CREDENTIALS.email,
      password: SUPERADMIN_CREDENTIALS.password,
      scope: 'openid profile email roles',
    });

    console.log('  Project B Token audience (aud):', projectBAuth.payload.aud);
    console.log('  Project B Token roles:         ', projectBAuth.payload.roles);

    if (projectBAuth.payload.aud !== 'https://project-b.gov/api') {
      throw new Error(`Expected audience https://project-b.gov/api, got ${projectBAuth.payload.aud}`);
    }

    // Attempt to access Case Engine API with Project B token
    const crossProjectRes = await fetch(`${CASE_ENGINE_BASE}/cases`, {
      headers: { Authorization: `Bearer ${projectBAuth.tokenData.access_token}` },
    });
    console.log(`  Replay attack response status: ${crossProjectRes.status}`);
    const crossProjectBody = await crossProjectRes.json().catch(() => ({}));
    console.log('  Replay attack response body:  ', JSON.stringify(crossProjectBody));

    if (crossProjectRes.status !== 403) {
      throw new Error(`SECURITY VULNERABILITY! Expected HTTP 403 Forbidden on mismatched audience, got ${crossProjectRes.status}`);
    }
    if (crossProjectBody.error !== 'invalid_audience' && crossProjectBody.error?.code !== 'INVALID_AUDIENCE') {
      throw new Error(`Expected invalid_audience error code, got ${JSON.stringify(crossProjectBody)}`);
    }
    console.log('✅ TEST T2 PASSED: Cross-project token replay was blocked with 403 invalid_audience.');

    // ══════════════════════════════════════════════════════════════════════
    // TEST T3: Least-Privilege Multi-Project Role Isolation
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n----------------------------------------------------------------');
    console.log('TEST T3: Least-Privilege Multi-Project Role Isolation Verification');
    console.log('----------------------------------------------------------------');
    console.log(`  IACMS Token Roles:    ${JSON.stringify(iacmsAuth.payload.roles)}`);
    console.log(`  Project B Token Roles:${JSON.stringify(projectBAuth.payload.roles)}`);

    const hasSupervisorInIACMS = iacmsAuth.payload.roles.includes(supervisorRole.id);
    const hasViewerInProjectB = projectBAuth.payload.roles.includes(viewerRole.id);
    const hasViewerInIACMS = iacmsAuth.payload.roles.includes(viewerRole.id);
    const hasSupervisorInProjectB = projectBAuth.payload.roles.includes(supervisorRole.id);

    if (!hasSupervisorInIACMS || !hasViewerInProjectB) {
      throw new Error('User missing designated application roles.');
    }
    if (hasViewerInIACMS) {
      throw new Error('Privilege leak: Project B role appeared in IACMS token!');
    }
    if (hasSupervisorInProjectB) {
      throw new Error('Privilege leak: IACMS supervisor role appeared in Project B token!');
    }
    console.log('✅ TEST T3 PASSED: Zero cross-project role leakage verified.');

    // ══════════════════════════════════════════════════════════════════════
    // TEST T4: Per-Application Role Revocation
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n----------------------------------------------------------------');
    console.log('TEST T4: Per-Application Role Revocation without Cross-Project Impact');
    console.log('----------------------------------------------------------------');
    console.log(`  Revoking test user role in Project B (${projectB.clientId})...`);
    const revokeRes = await fetch(`${IAM_BASE}/oauth/clients/${projectB.id}/users/${testUser.id}/roles/${viewerRole.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!revokeRes.ok) throw new Error('Failed to revoke role in Project B');

    // Authenticate in Project B after revocation
    const revokedBAuth = await performOidcPkceLogin({
      clientId: projectB.clientId,
      redirectUri: 'http://localhost:5173/auth/callback',
      email: SUPERADMIN_CREDENTIALS.email,
      password: SUPERADMIN_CREDENTIALS.password,
      scope: 'openid profile email roles',
    });
    console.log('  Project B Token Roles after revocation:', revokedBAuth.payload.roles);

    if (revokedBAuth.payload.roles.length !== 0) {
      throw new Error(`Expected empty roles array for Project B, got: ${JSON.stringify(revokedBAuth.payload.roles)}`);
    }

    // Authenticate in IACMS to confirm user still has supervisor role
    const activeIacmsAuth = await performOidcPkceLogin({
      clientId: 'iacms_portal',
      redirectUri: 'http://localhost:5173/auth/callback',
      email: SUPERADMIN_CREDENTIALS.email,
      password: SUPERADMIN_CREDENTIALS.password,
      scope: 'openid profile email roles',
    });
    console.log('  IACMS Token Roles after Project B revocation:', activeIacmsAuth.payload.roles);

    if (!activeIacmsAuth.payload.roles.includes(supervisorRole.id)) {
      throw new Error('Revoking role in Project B erroneously affected IACMS role!');
    }
    console.log('✅ TEST T4 PASSED: Per-application role revocation succeeded without collateral impact.');

    // ══════════════════════════════════════════════════════════════════════
    // TEST T5: Gateway OIDC Bearer Token Session & RBAC Hydration
    // ══════════════════════════════════════════════════════════════════════
    console.log('\n----------------------------------------------------------------');
    console.log('TEST T5: Gateway OIDC Bearer Token Verification & Permissions');
    console.log('----------------------------------------------------------------');
    const gwStatusRes = await fetch(`${GATEWAY_BASE}/api/v1/session/status`, {
      headers: { Authorization: `Bearer ${activeIacmsAuth.tokenData.access_token}` },
    });
    const gwStatus = await gwStatusRes.json();
    console.log('  Gateway Status Response:', JSON.stringify({
      authenticated: gwStatus.authenticated,
      authMethod: gwStatus.authMethod,
      userId: gwStatus.user?.id,
      permissionCount: gwStatus.permissions?.length,
    }, null, 2));

    if (!gwStatus.authenticated || gwStatus.authMethod !== 'jwt') {
      throw new Error('Gateway failed to recognize valid OIDC Bearer JWT!');
    }
    if (gwStatus.user?.id !== testUser.id) {
      throw new Error(`Gateway user ID mismatch: expected ${testUser.id}, got ${gwStatus.user?.id}`);
    }
    if (!Array.isArray(gwStatus.permissions) || gwStatus.permissions.length === 0) {
      throw new Error('Gateway failed to resolve RBAC permissions for authenticated user!');
    }
    console.log('✅ TEST T5 PASSED: Gateway successfully authenticated OIDC Bearer token and resolved permissions.');

  } finally {
    // ── Teardown: Clean up Project B Client ─────────────────────────────────
    console.log('\n>>> [Teardown] Cleaning up Project B test client...');
    await fetch(`${IAM_BASE}/oauth/clients/${projectB.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).catch(() => {});
    console.log('✓ Teardown complete.');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 5 PHASE 4 INTEGRATION & ISOLATION TESTS PASSED 100%! 🎉');
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
