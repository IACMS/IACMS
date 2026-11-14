# Central IAM extraction roadmap

## Goal

Turn `services/iam-service` into an independently buildable, deployable identity provider that any approved project can use through standard OpenID Connect (OIDC) and OAuth 2.0 interfaces. IACMS is one client of IAM; it should not own IAM's credentials, signing keys, or identity database.

The intended integration boundary is the OIDC issuer: applications use authorization code with PKCE for user sign-in, and APIs validate IAM-issued access tokens by issuer, audience, signature, and required scopes. Applications keep their own domain authorization rules. IAM does not become the source of case workflow permissions or other project-specific business policy.

## Current state from repository review

- IAM already contains password authentication, OIDC protocol endpoints, OAuth client registration, social identity links, API-key token exchange, and per-application role assignments.
- The recent `699c530` change introduced an IAM-focused Prisma schema. On 2026-11-14, the local development stack was cut over to a separate IAM PostgreSQL/Redis deployment populated from the local IACMS database. This is not a production deployment.
- The IAM Prisma schema had fallen behind the root schema: it lacked `OAuthClient.targetAudience` and `UserApplicationRole`. These fields are now represented in the IAM schema so client generation includes the application isolation code already present in the service.
- IAM source no longer imports runtime code from the monorepo's `shared/` directory. The required errors, logging, event publishing, gateway compatibility, role lookup, startup checks, and API docs helpers now live inside the service. The event publisher retains the topic names used by current IACMS consumers.
- IAM now has a service-local lockfile, package documentation, Docker context, Prisma generation, and build workflow. A standalone Docker build succeeds from the service directory. The IACMS Compose deployment also builds the service with that context.
- IAM now runs locally with its own PostgreSQL and Redis and joins IACMS only through an optional bridge network. The legacy shared-database IAM container is stopped. IACMS caller configuration and projection consumption were switched locally; production infrastructure and data remain untouched.
- The IAM-owned `User.tenantId` schema is now nullable, and org-bound OIDC authentication can resolve a subject through IAM membership without a legacy tenant. Global identity creation is available through an admin API behind `IAM_GLOBAL_IDENTITIES_ENABLED`, disabled by default because the currently shared IACMS database and root Prisma model still require `User.tenantId`. IAM still carries transitional department and IACMS password-policy fields.
- The gateway still offers legacy session and HMAC-token flows alongside OIDC. Keep that compatibility during migration, then retire it only after IACMS and other clients have moved to the OIDC contract.

## Ownership boundary

| IAM owns | Each project owns |
| --- | --- |
| Global account, authentication factors, recovery, verified identities, federation | Business records and domain data |
| Organization memberships and application access grants | Domain roles, permissions, and policy evaluation |
| OIDC clients, redirect URI allowlists, consent, grants, signing keys | Resource-server audience and scope enforcement |
| Identity and app-access claims in tokens | Mapping claims to local domain authorization |

An IAM application role means access to an application or a coarse application-level assignment. It must not silently replace the application's own authorization checks.

## Phases and acceptance criteria

### 0. Establish the contract and schema ownership — in progress

- Keep IAM's Prisma schema synchronized with IAM-owned models in the current shared database.
- Record the supported OIDC flows, issuer, claims, audiences, scopes, client types, token lifetimes, key rotation, logout, and revocation expectations.
- Ensure new application roles are only emitted for the requesting client, honor expiry, and have no implicit fallback to roles belonging to another application.
- Acceptance: IAM client generation and schema validation succeed; the cross-project isolation suite verifies wrong-audience rejection and app-role isolation.

### 1. Remove build-time and runtime monorepo dependencies

**Status: build boundary complete; repository/release separation remains.** Runtime imports have been moved into IAM-owned modules. IAM has a service-local lockfile, Prisma client generation, Docker build, and CI workflow. It remains within the IACMS Git repository, so its own repository and release process are a later organizational step.

- Move or replace imports from `shared/` with IAM-owned modules or versioned packages with explicit contracts.
- Give IAM independent environment configuration, health/readiness checks, container build context, CI, and release versioning.
- Remove IACMS-only defaults from issuer resource audiences, scope catalogs, database names, API names, and logs.
- Acceptance: IAM can be installed and built from its service directory using only its declared dependencies and configuration. A separate Git repository is not required for this technical boundary.

### 2. Separate persistence and migration ownership — local cutover complete; production rollout pending

- Define an IAM database and service credentials with least privilege; do not reuse the IACMS application database credentials.
- Establish an IAM-owned migration baseline from the tables IAM actually owns, then route all subsequent schema changes through IAM migrations.
- Migrate clients, OIDC grants, consent, providers, API clients, and account records with checksums/counts and a rollback or restore procedure.
- Acceptance: IAM operates against its own database; the IACMS schema and generated Prisma clients no longer need IAM tables for runtime reads.
- Current Phase 2 status: [IAM persistence boundary and migration inventory](./IAM_PERSISTENCE_INVENTORY.md) records the local cutover and remaining coupling. A private pre-cutover database backup was verified, the dedicated IAM database was migrated, and copied records were validated against the source. No production data or database configuration has changed.
- The local IACMS projection and role-assignment migrations have been applied. IAM health/discovery, gateway proxying, internal identity snapshot access, and an outbox-to-Kafka-to-projection event were verified. The old shared-database IAM container is stopped and retained for rollback; the original IACMS database remains intact.
- The proposed data ownership and IACMS identity projection contract is documented in [IAM_OWNERSHIP_AND_IDENTITY_CONTRACT.md](./IAM_OWNERSHIP_AND_IDENTITY_CONTRACT.md). It keeps stable subject UUIDs, assigns IACMS tenant/department/domain-role data to IACMS, and defines IAM lifecycle events plus a local projection.
- Initial implementation adds an IACMS-local `IdentityProjection`, IAM lifecycle events/outbox, protected internal profile/status APIs, a paginated IAM snapshot endpoint, and a gateway consumer with periodic reconciliation. Gateway profile/status operations and internal/partner user provisioning call IAM for credential creation; IACMS stores the projection, department, and project role. Gateway RBAC permission resolution and project role APIs read/write IACMS-local role tables, and case-engine's tenant-admin check remains database-backed in IACMS. The local foreign-key removal migration is applied. Remaining IAM admin paths, cross-service `User` relations, and transitional tenant/department/role schema coupling are production rollout blockers.
- IAM has an initial bootstrap migration generated from its service schema, including its identity-event outbox, and an additive tenantless-identity migration. Both are applied to the dedicated local IAM database. The bootstrap migration is for clean databases only; do not replay it against populated existing tables. Transitional IACMS tenant, department, and role models remain in the IAM schema.
- Added generic IAM organization and membership tables, platform-admin management endpoints, OAuth client organization binding, and OIDC membership checks. The local IAM database contains 7 organizations and 37 memberships. Organization-bound clients use memberships; legacy tenant-scoped clients still use `User.tenantId` unless the bridge flag is enabled.
- The rehearsal application role had no schema-create permission. DDL was applied as the local database owner after reviewing a create-only diff, then CRUD grants were limited to the three new tables and outbox sequence. Production migration deployment needs a separate, controlled migration role; do not give schema ownership to IAM's runtime role.

### 3. Introduce global identities and memberships

- Generic IAM organization and membership tables exist, and legacy tenant/user pairs were backfilled into the local IAM database. Tenantless identities and organization membership checks work in the IAM schema; global creation is enabled in the isolated local deployment.
- `User.id` is the stable OIDC `sub` (`oidc_id` in client terminology). A tenant is an organization/workspace, not a person identifier. `IamMembership` allows a subject to have zero, one, or many organization memberships. Existing IACMS tenant UUIDs are preserved as `IamOrganization.externalId` mappings.
- OAuth clients can currently bind to one organization. A user can have memberships in multiple tenants and sign into each tenant-bound client; dynamic tenant selection within one OAuth client is a separate follow-up and must put the selected membership into the authorization/token context explicitly.
- IAM emits a tenant-scoped IACMS projection event when identity lifecycle or membership changes, and the snapshot API reconciles legacy tenant links plus mapped IACMS memberships.
- Acceptance: one identity can sign in to multiple authorized applications and organizations without duplicate accounts or role leakage; IAM no longer requires an IACMS tenant or department to authenticate.

### 4. Migrate IACMS as the first OIDC client

- Register IACMS as a public OIDC client using authorization code with PKCE and explicit redirect URIs, audiences, and scopes.
- Move browser authentication to OIDC, initially retaining the existing gateway session only as a temporary compatibility layer.
- Make all IACMS resource servers validate signature, issuer, required audience, and route scopes. Treat gateway-forwarded identity as trusted only on authenticated internal connections.
- Acceptance: IACMS login, logout, refresh, account disablement, and role changes work through the documented contract; legacy login is no longer required by the client.

### 5. Prove external-project onboarding and operate the service

- Build a small independent reference client and API with a different audience from IACMS.
- Verify token isolation, app access revocation, key rotation, refresh-token reuse handling, recovery, monitoring, backup/restore, and incident procedures.
- Publish client onboarding and versioned integration docs.
- Acceptance: the reference project integrates without importing IACMS source, using its database, or calling its gateway.

## Recommended immediate sequence

1. Rehearse and deploy this cutover in the target production environment with a verified backup, managed IAM database/Redis, secret transfer/rotation, and a rollback window.
2. Remove IAM `User.departmentId` and application-specific `Role`/`UserRole` dependencies from authentication; keep IACMS department and domain-role decisions in IACMS.
3. Move remaining application services to the local projection and remove legacy `User` relation reads; complete OIDC migration for browser sessions.
4. Establish production migration ownership and provision a migration-only database role separate from IAM runtime credentials.
5. Rehearse copying credentials, API keys, OAuth clients/grants, and federated identities to a clean IAM database with stable subject IDs, reconciliation, end-to-end login, and rollback.
6. Switch IAM only after all acceptance checks pass; keep IACMS tenant/department/domain data and the local identity projection in IACMS.
7. Prove onboarding with a second independent OIDC client and retire legacy IACMS authentication only after the new client flow is operating.

## Important migration constraints

- Do not delete or rename the root `User` model or change existing foreign keys as the first extraction step. IACMS case, audit, assignment, and chat records refer to those IDs.
- Do not copy IACMS's full schema into a new IAM database. Migrate only identity, membership, client, grant, federation, and IAM administration data.
- Do not use an email address as a federated identity key or silently merge accounts by email.
- Keep signing keys and client secrets in a managed secret store; the IAM database migration must not embed credentials.
- A signed JWT is not immediate revocation. Document and implement the chosen access-token lifetime and revocation strategy for each API class.
