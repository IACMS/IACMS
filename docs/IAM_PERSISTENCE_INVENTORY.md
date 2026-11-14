# IAM persistence boundary and migration inventory

## Purpose and status

**Current status (2026-11-14):** the local development IACMS stack was cut over to a dedicated IAM PostgreSQL/Redis deployment. A private, restorable pre-cutover backup was verified. IAM-owned records were copied from the local IACMS database and validated by row counts and checksums; source credentials and OAuth data were preserved. The local IACMS database remains intact. This is a local deployment, not a production rollout.

This inventory is the first deliverable for roadmap Phase 2, which separates IAM persistence and migration ownership from IACMS. It is based on the IAM Prisma schema and Prisma calls in `services/iam-service/src` as they exist today. It is a code inventory, not a production data audit: row counts, constraints in the live database, backups, and migration timing still need to be verified against the target environment.

The local IAM and IACMS database configurations now point to separate databases. IACMS projection and role-assignment migrations were applied locally. The old shared-database IAM container is stopped and retained as a rollback artifact. Production URLs, data, and services have not been changed.

The proposed target ownership and identity bridge is specified in [IAM_OWNERSHIP_AND_IDENTITY_CONTRACT.md](./IAM_OWNERSHIP_AND_IDENTITY_CONTRACT.md). That contract is the design input for the next implementation stage: an IACMS-local subject projection and versioned IAM identity lifecycle events.

The IAM schema now also declares `iam_organizations` and `iam_memberships`, with external application identifiers and a backfill utility for legacy tenant/user pairs. These are additive target models; current authentication and tenant administration still depend on legacy `tenants` and `users.tenant_id`. The utility is dry-run by default and was applied to the dedicated local IAM database.

## Earlier sanitized rehearsals (2026-11-14)

Before the credential-retaining local cutover described below, an isolated sanitized rehearsal was completed. The active `iacms` database was read-only; only an IAM table allowlist was copied into `iam_rehearsal_source`, sanitized there, and then copied into `iam_rehearsal`.

| Table | Rows in sanitized target |
| --- | ---: |
| `tenants` | 7 |
| `departments` | 18 |
| `users` | 37 |
| `roles` | 10 |
| `permissions` | 34 |
| `role_permissions` | 139 |
| `user_roles` | 37 |
| `api_keys` | 3 |
| `oidc_payloads` | 0 |
| `oauth_clients` | 3 |
| `oauth_consents` | 0 |
| `oauth_providers` | 0 |
| `federated_identities` | 0 |
| `user_application_roles` | 2 |

Sanitization preserved UUIDs for relationship validation and replaced account emails, usernames, and names; cleared phone, national ID, recovery/verification tokens and tenant configuration; disabled password login and API keys; removed provider/client secrets; and replaced client IDs/redirect URIs. It removed all 49 OIDC payloads and the 1 consent row from the rehearsal copy, intentionally invalidating sessions and consents in that copy. The IAM target's 14 table primary-key sets match the sanitized source, PostgreSQL reports no unvalidated foreign keys, and the IAM-generated Prisma client read it successfully. A read/write-only `iam_rehearsal_app` role also completed a transaction rollback probe.

A temporary IAM process used the target database and an ephemeral signing key on a separate local port. It confirmed a database connection, health returned HTTP 200 with OIDC enabled, and discovery returned HTTP 200 with the rehearsal issuer. The process was stopped after the check. The existing IAM service and API gateway remained on `iacms` and both returned HTTP 200. No application was switched to the target.

An earlier standalone Compose rehearsal used the sanitized `iam_rehearsal` database as its source. IAM's migrations bootstrapped a new database, all 17 table counts and sorted primary-key digests matched, all foreign keys validated, and a synthetic tenantless identity passed account lookup. That earlier rehearsal did not use the active IACMS database as its source.

### Credential-retaining rehearsal (2026-11-14)

The local cutover used the development `iacms` database as a read-only source and copied an allowlist of 14 IAM-related tables into the separately migrated IAM database. No source IAM records were deleted. Source and target counts and order-independent checksums match for all copied shared columns: 37 users, 7 tenants, 18 departments, 10 roles, 34 permissions, 139 role-permission links, 37 user-role links, 3 API keys, 61 OIDC payloads, 3 OAuth clients, and 1 OAuth consent; provider and federated-identity tables are empty. IAM organization/membership backfill produced 7 organizations and 37 memberships. The target adds nullable `oauth_clients.iam_organization_id`. Credentials and OAuth payloads were preserved as copied; this local dataset was not sanitized.

The standalone IAM service now listens on local port 3001. Health, OIDC discovery, JWKS, gateway-to-IAM resolution, gateway-proxied discovery, protected identity snapshot (37 users), and a non-existent-account login rejection were verified. The gateway consumed a credential-free IAM outbox event and updated a projection version. This did not verify login for a real account or decryption/verification of OAuth client secrets. Production must securely transfer/rotate the matching encryption/signing keys and test client-specific authentication behavior.

IAM's initial and tenantless-identity migrations were applied to the dedicated local database; the IACMS projection and role-assignment migrations were applied to the local application database. The backfill was idempotent. The private backup is `/tmp/iacms-before-iam-cutover-20261114.dump`; keep it protected and available for local rollback. Production migration, key management, and login verification remain outstanding.

## Current IAM database surface

IAM directly reads or writes these Prisma models:

| Current model | Current use | Extraction treatment |
| --- | --- | --- |
| `User` | Credentials, profile, verification/recovery, login state; currently requires `tenantId` and exposes IACMS fields | Move authentication identity data to IAM. Preserve current user IDs initially. Separate organization membership and project profile fields before making the identity global. |
| `Tenant` | Tenant lookup during login and registration; IAM platform/tenant administration, status and configuration | Do not copy the IACMS tenant table wholesale. Define an IAM-owned organization representation and migration mapping. Keep IACMS-only tenant operations/configuration in IACMS or a separately defined admin contract. |
| `Department` | IACMS-scoped registration, user assignment, and tenant administration | IACMS-owned organizational detail unless a future project independently requires IAM-managed departments. Do not make it a prerequisite for core OIDC sign-in. |
| `Role`, `UserRole` | IACMS role administration, login claims, platform checks, and legacy authorization | Separate coarse IAM application grants from IACMS domain roles. Keep domain permission evaluation in IACMS. Avoid copying IACMS role assignments into global tokens by default. |
| `Permission`, `RolePermission` | IACMS resource/action permissions and role permission evaluation | Retain in IACMS. IAM should not become the policy engine for project-specific permissions. |
| `OAuthClient` | Client registration, grant/audience configuration and client lookup | IAM-owned; migrate registered clients and preserve client IDs/redirect allowlists. Review any foreign keys from other tables. |
| `OAuthConsent` | Per-user/per-client consent | IAM-owned; migrate with the user ID and client ID mappings. |
| `OidcPayload` | OIDC grants, sessions and other provider artifacts | IAM-owned operational state. Decide whether to migrate active artifacts or invalidate sessions during cutover; this is a security and availability decision, not a blind table copy. |
| `OAuthProvider` | Upstream social provider configuration and encrypted secrets | IAM-owned only if IAM remains responsible for federation. Migrate ciphertext only when the decryption key and rotation plan are available; never export plaintext secrets into the migration artifact. |
| `FederatedIdentity` | Links an IAM user to a provider subject | IAM-owned; preserve provider subject uniqueness and user ID mapping. Never merge identities by matching email alone. |
| `UserApplicationRole` | Per-user role assignment scoped to a registered client, with optional expiry | IAM-owned coarse application access grant; migrate only after role meaning and client/user mappings are explicit. |
| `ApiKey` | M2M client credentials, hashes, scopes, lifecycle metadata | IAM-owned if APIs use IAM-issued credentials. Migrate hashes and metadata only; do not recover or export raw keys. Check `tenantId`, `oauthClientId`, `createdBy`, and `revokedBy` references. |

These classifications are target ownership, not permission to move every current row. Several current models contain IACMS assumptions and must be reshaped or filtered before they can live independently.

## Couplings that block a clean database cutover

1. The IAM schema now permits nullable `User.tenantId` and adds a partial unique index for global email addresses, while legacy composite email/username constraints remain. Authentication, account creation, admin, social login, and platform endpoints still contain tenant-based paths, and IACMS's root Prisma schema still requires a tenant; keep global identity creation disabled in the shared database.
2. `User.departmentId`, tenant-specific role assignments, and the IACMS department model couple identity management to IACMS organization data.
3. `Role` and `UserRole` are used both by IAM-facing platform features and by IACMS authorization. Their meaning is not yet cleanly limited to application access.
4. IAM has tenant administration controllers that create, update, and delete IACMS tenants and departments. These operations must be assigned to IAM's organization contract or remain in IACMS before persistence is split.
5. IAM rows have foreign keys among users, tenants, departments, roles, OAuth clients, providers, and API keys. Copy order and referential validation must follow those relationships.
6. IACMS domain records reference existing user IDs. User IDs must remain stable or an explicit old-to-new identity map must be consumed by every referencing service before any ID changes.
7. OAuth provider secrets depend on `CLIENT_SECRET_KEY`; JWT signing depends on `OIDC_JWKS_JSON`. The database migration alone does not transfer those runtime secrets or preserve token validation.
8. OIDC state in `OidcPayload` can include live grants and sessions. Copying expired/consumed records is wasteful; dropping active records logs users out. Define the cutover behavior explicitly.
9. Kafka events currently use IACMS-compatible topics. Database separation does not by itself eliminate event-contract coupling.
10. The current Compose configuration supplies the same `DATABASE_URL` to IAM and application services. The local `.env` points at a database named `iacms`; no independent IAM database URL is configured in the inspected files.
11. The API gateway no longer reads or writes `ApiKey` rows directly: create, validate, list, rotate, and revoke now go through IAM's internal API. Existing API-key JWTs without an owner claim use a temporary IAM owner-resolution endpoint. Gateway profile, account-active, and user-provisioning calls use IAM contracts; IACMS-local projection, department, and role writes remain local. Case-engine `UserRole` reads remain a local RBAC dependency, not an IAM identity-table dependency.
12. Caller migration is partial: selected gateway, case-engine, chat, and file paths read the local `IdentityProjection`; audit reads now use the local projection. Gateway permission resolution, `/rbac` APIs, browser user creation, and partner invitation now use IACMS-local `Role`, `Permission`, `RolePermission`, `UserRole`, projection, and department data. IAM creates and owns credentials. Case-engine's tenant-admin check remains a local database check. The additive migration dropping `UserRole` foreign keys to IAM's `User` is not yet applied; IAM admin/tenant controllers retain legacy role paths, and chat/audit Prisma schemas still declare legacy user relations in other paths. Full database separation still requires the caller and schema work below.

### Cross-service references confirmed in the root Prisma schema

The root IACMS schema currently declares relations from non-IAM application data to IAM identity/organization records. At minimum, the migration design must account for:

- **User IDs in IACMS history and operational records:** cases (creator and assignee), case history (actor), assignments, case referrals, case attachments (uploader), audit logs, workflows, webhooks, integrations, and chat participants/messages.
- **Tenant IDs in IACMS-owned data:** departments, cases (owning/originating/current tenant), case sequences, workflows, referrals, audit logs/outbox, webhooks, integrations, files/chunk uploads, and chat conversations/messages.
- **Department IDs in IACMS-owned data:** users, cases (originating/current department), and workflows.
- **Role IDs:** role permissions and user roles; user-application-role grants also point at a role and must be classified separately from domain authorization.

These are currently Prisma-level cross-model relations in one PostgreSQL database. A separate database cannot retain ordinary foreign keys between the two databases. Before cutover, IACMS must keep its own tenant/department/domain records and replace any runtime dependency on IAM-owned user rows with a stable subject ID contract (or an explicit local identity projection). Audit and case history must continue to resolve the same actor IDs. Avoid deleting the old user rows or changing IDs as part of the initial IAM database copy.

The root migration directory also contains IAM schema changes mixed into IACMS history, including OIDC tables (`20261101123938_phase1_oidc_models`), OAuth client/API-key linkage (`20261102120000_phase5_api_key_oauth_client`), and application-role/audience fields (`20261113173500_add_user_application_roles`). These must be baselined in IAM's migration history after confirming the actual deployed schema; they cannot simply be replayed on a target that already contains the tables.

### Runtime database consumers found in source and deployment configuration

This repository-level search found direct Prisma access outside IAM:

| Consumer | Direct database dependency | Required bridge before IAM stops using the IACMS database |
| --- | --- | --- |
| API gateway | API-key lifecycle, profile/status changes, and browser/partner account provisioning use IAM APIs; project department/role writes and account display projection remain local | Add idempotency keys and reconcile partial IAM/IACMS provisioning failures before production rollout. |
| Case-engine | Assignment, referral, and attachment paths use projection; case policy still reads IAM `UserRole` for `tenant_admin` | Move IACMS role assignment and resolution to an IACMS-owned RBAC contract. Do not replace the database check with an unbound caller-supplied role header. |
| File service | Auth middleware can read `User` after token validation | Use a local projection or an explicitly authenticated IAM introspection/user-status contract; preserve tenant/active checks. |
| Chat service | Reads `User` and `Department` for participant and conversation behavior | Keep the domain-facing user/department projection in IACMS or provide a reliable local sync; do not make chat depend on an IAM database join. |
| Other services | Deployment currently passes the same PostgreSQL URL to multiple services | Inventory each service's actual model calls and reduce database grants by service as data ownership is split. |

Audit log responses now hydrate actor profile fields from `IdentityProjection` and search actor names/emails through that local projection; this removes audit-controller reliance on the IAM `User` relation for those routes. It does not remove the remaining Prisma relation declarations or establish projection completeness. A forwarded role-name header was considered for case-engine tenant-admin checks but rejected: without a cryptographically bound authorization assertion, accepting that header would weaken access control. Case-engine's authorization migration must preserve the current database-backed semantics through an IACMS-owned, trusted RBAC path.

Compose currently defines a single PostgreSQL service/database and gives the same `DATABASE_URL` to IAM, API gateway, case-engine, file, and other services. A separate IAM URL alone is therefore insufficient: each direct reader/writer must be migrated or given an IACMS-owned projection before switching IAM.

### API-key caller migration progress

### IACMS-local role authority progress

The API gateway now resolves request permissions from its own Prisma connection and no longer calls IAM's `/permissions/user/:id` endpoint. It requires an active local identity projection before granting any IACMS permissions: a missing projection is treated as policy unavailable (HTTP 503), and inactive/deleted projections receive no roles. Role listing, editing, permission assignment, and role-assignment routes are handled locally with explicit authentication, resolved-policy availability checks, and per-route permission guards. Legacy UI paths for role administration and user creation are handled locally: IAM creates credentials, then IACMS stores the projection, department, and domain-role grant. The partner GraphQL invite path follows the same ownership split. Case-engine continues to check `UserRole` and the `tenant_admin` role in its own database, preserving a database-backed authorization decision.

IACMS's Prisma `UserRole` now treats `userId`/`assignedBy` as stable subject UUIDs rather than relations to IAM's `User`; a migration removes only those two foreign keys and retains all role assignment rows and the local `role_id` foreign key. **That migration and the identity-projection migration have not been applied to any database.** Before rolling out local RBAC, apply both migrations and run IAM snapshot reconciliation to populate every active IACMS membership; otherwise protected IACMS routes fail closed with HTTP 503. The local assignment API verifies the target against the IACMS `IdentityProjection` before writing. The IAM service still contains its own legacy role models and administrative controllers for compatibility; user provisioning and remaining admin flows must move before the standalone IAM database can be cut over. A request role header was not used as an authorization source.

The gateway now sends API-key creation, validation, listing, rotation, and revocation to IAM's internal API. Validation sends only the SHA-256 hash of the presented secret; raw keys remain at the gateway boundary and IAM never returns the stored hash. IAM performs expiry, revocation, and active-tenant checks and records last-use metadata. New API-key OAuth tokens carry an owner claim, while existing valid tokens can resolve their owner through a protected, temporary compatibility endpoint. Gateway GraphQL mutations use this owner context instead of querying `ApiKey` for the creator. IAM rotation revokes and creates the replacement in one transaction.

IAM (143 tests), case-engine (34 tests), chat (126 tests), and focused gateway identity/mutation tests (21 tests) passed in this turn. The complete gateway suite ran 131 tests: 112 passed and 19 failed because the sandbox denied Supertest from binding `0.0.0.0` (`EPERM`), not because of an assertion failure. No live service-to-service call against the rehearsal target was verified in this turn. The production applications and database configuration have not been switched. IAM still lacks a complete migration baseline and callers/schema coupling remain, so database cutover is not safe.

## Safe migration sequence

1. **Confirm the environment and source baseline.** Identify the exact non-production source and target databases; inspect table counts, constraints, extensions, triggers, indexes, migration state, and service credentials. Capture a restorable source backup and rehearse on a sanitized clone.
2. **Freeze ownership and service contracts.** Decide which tenant/department/role operations stay IACMS-owned. Define IAM APIs/events for identity lifecycle and M2M key lifecycle, plus the IACMS-local subject projection and event delivery/reconciliation behavior.
3. **Move application callers before data ownership.** Update the gateway and services so IAM-owned operations use IAM contracts and IACMS domain authorization uses local tenant/department/role data. Keep old and new routes compatible during rollout, with observable reconciliation and an explicit rollback switch.
4. **Design and provision the target IAM database.** Build a clean IAM-only Prisma schema and migration baseline, then create a least-privilege service credential. Do not copy the IACMS schema wholesale. Preserve user/client IDs initially or define durable mappings.
5. **Build a repeatable data migration.** Copy only approved IAM data in dependency order; keep PII and credentials out of logs; validate counts, checksums, and links. Treat password hashes, API key hashes, and provider ciphertext as opaque. Decide separately whether active OIDC grants/sessions are copied or invalidated.
6. **Rehearse both applications end to end.** Against a sanitized clone, test IACMS login, case assignment, file access, chat, audit actor resolution, OAuth client flows, API-key lifecycle, password recovery, role updates, refresh/revocation, and rollback/restore.
7. **Cut over IAM with a recovery point.** Switch only the IAM service to the target database after reconciliation and smoke checks pass. Keep IACMS's identity projection and domain database active. Monitor both systems and maintain a tested rollback route.
8. **Remove old schema ownership only after proof.** Stop IACMS migrations from managing IAM tables only after IAM migrations own the target and all callers have stopped reading/writing moved IAM data. Retain the source backup through the agreed recovery window.

## Decisions required before touching production data

- Is the target deployment a separate PostgreSQL database or a separate schema/database role first? Separate databases provide the clearest ownership boundary; operational constraints may dictate an intermediate stage.
- Which organization attributes and organization-level account memberships IAM owns, and which remain IACMS tenant concepts?
- Are IDs kept identical across databases? If yes, validate UUID compatibility and downstream foreign keys. If no, define a durable identity mapping consumed by IACMS and all audit/history consumers.
- Which `Role`/`UserRole` rows are generic app-access grants, and which are IACMS domain authorization? What is the default claim policy for old IACMS clients?
- Are active OIDC sessions/grants migrated, invalidated at cutover, or expired through a planned overlap window?
- Which service owns OAuth provider registration and `CLIENT_SECRET_KEY` rotation after extraction?
- What is the backup, restore, rollback owner and acceptable login interruption window?

## Next implementation tasks

1. Confirm the non-production source/target endpoints and build an aggregate-only source inventory; do not print row data or secrets.
2. Complete the consumer inventory for every service and agree the identity projection and IAM API/event contracts.
3. Move gateway and service callers off direct reads/writes to IAM-owned records while preserving IACMS domain data locally.
4. Define the target IAM account, organization/membership, client, consent, federation, and M2M credential schema.
5. Create IAM-owned migration baseline and rehearse the data-copy/verification utility against a sanitized database snapshot.

Do not point IAM at a new database until tasks 1–4 and a restore rehearsal are complete. Do not drop or rewrite the existing IACMS `users`, `tenants`, `departments`, `roles`, or IAM tables during the initial cutover.
