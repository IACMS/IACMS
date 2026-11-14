# IAM ownership and identity projection contract

## Purpose and status

This document defines the proposed ownership boundary for separating IAM from IACMS. It is a design contract for implementation and review; it does not authorize a production data move or change the current database layout. Existing user UUIDs remain stable throughout the transition.

Implementation status (2026-11-14): the local development stack now runs IAM on a dedicated database, with IACMS consuming a local identity projection and owning domain roles. Local migrations and an outbox-to-projection event were verified. This does not represent production deployment; transitional IAM schema and caller couplings remain.

The IAM schema now includes generic `IamOrganization` and `IamMembership` models. `externalSystem`/`externalId` provide an explicit mapping to application-owned organization IDs. The local IAM database has 7 legacy-tenant mappings and 37 memberships. OAuth clients can bind to an IAM organization, and those OIDC login/account flows require an active membership and emit `organization_id`. Legacy tenant-scoped clients use the membership map when `IAM_ORG_MEMBERSHIPS_ENABLED` is enabled. The IAM-owned `User.tenantId` is nullable and org-bound OIDC can authenticate a tenantless identity; platform-admin identity creation is enabled in the isolated local deployment. `Tenant`, `Department`, and domain role models remain transitional dependencies.

## Ownership decision

| Data or behavior | Owner after separation | Notes |
| --- | --- | --- |
| Login account, password hash, recovery and verification state, MFA/authentication factors, federated identity links | IAM | Secrets and credential lifecycle stay exclusively in IAM. |
| Global subject ID (`sub`) | IAM | Use the existing `User.id` UUID as the initial OIDC `sub`; do not re-key users during extraction. |
| Login identifiers and verified email | IAM | Normalize and enforce global identifier policy when global accounts are introduced. Existing tenant-scoped duplicates need collision analysis before that schema change. |
| IAM organizations and memberships | IAM | Generic IAM concepts for applications that need organization-level access. Membership is an authorization relationship, not ownership of an application's tenant record. |
| IACMS tenant/agency record and tenant code/config | IACMS | Existing IACMS tenant UUID remains the resource tenant ID in IACMS. IAM may store an external organization mapping, but it must not own IACMS tenant administration/configuration. |
| IACMS departments and department assignment | IACMS | Keep department UUIDs and semantics in IACMS. IAM must not require a department FK to authenticate a user. |
| IACMS case roles, permissions, and policy (`tenant_admin`, case worker, etc.) | IACMS | Evaluate these in IACMS against IACMS-owned data. Do not use generic IAM roles as case authorization. |
| OAuth/OIDC clients, redirects, consent, grants, signing keys metadata, API-key credentials, application access grants | IAM | A client registration identifies its application and allowed audiences/scopes. Application APIs enforce their own domain policy. |
| Case, assignment, referral, chat, file, webhook, audit and integration records | IACMS | Their tenant/user references remain stable; no cross-database FK is assumed. |
| IACMS-local identity projection | IACMS | A read model keyed by IAM subject UUID supports local joins and domain workflows. IAM is the source of truth for authentication status and identity changes. |

### Organization and membership interpretation

An IAM organization is a reusable identity/access grouping. An IACMS tenant remains the domain agency/tenant. Where a user has IACMS access, IAM membership carries an application-specific external organization reference that maps to the IACMS tenant UUID. Do not assume that every IAM organization is an IACMS tenant, or that membership grants case access by itself.

For the first extraction, retain each current user UUID and map its current `tenantId` to an IACMS organization reference. Do not move department or IACMS domain-role ownership into IAM merely to preserve the current schema. A later global-account model can allow one subject to have multiple memberships without changing the subject ID used by existing IACMS records.

## Identity and token contract

- `sub` is the immutable IAM subject UUID. Existing IACMS records that refer to a user continue to store that value.
- `iss` is the configured IAM issuer. IACMS APIs validate signature, issuer, time claims, audience, and scopes.
- `aud` identifies the resource server/application. Tokens for one project must not be accepted by another project's APIs.
- IAM claims may state authentication and coarse application access. Tenant context must be explicitly bound to an authorized membership and requested application; it must not be accepted solely because the caller supplied an `x-tenant-id` header.
- IACMS resolves its tenant and domain roles locally. A tenant membership in IAM is not a substitute for IACMS case permissions.
- Access-token claims are snapshots. Define token lifetime and revocation/disablement behavior; for sensitive operations, use short-lived access tokens or a protected status/introspection contract with bounded caching.
- Services trust forwarded identity headers only from authenticated internal callers. Public clients cannot assert `x-user-id`, `x-tenant-id`, or role headers as identity proof.

## IACMS projection

Create an IACMS-owned projection keyed by `subject_id` (same UUID as IAM `sub`) and `tenant_id`. It is a local operational read model, not another credential store.

Recommended initial fields:

| Field | Purpose |
| --- | --- |
| `subject_id` | Stable IAM UUID; primary identity key referenced by local domain records. |
| `tenant_id` | IACMS tenant membership/context used for local filtering and existing record relationships. |
| `is_active` | Last known IAM authentication status; fail closed for protected operations when stale beyond the agreed threshold. |
| `email`, `first_name`, `last_name` | Only where existing IACMS UX, notifications, or audit display requires them; minimize replicated PII. |
| `department_id` | IACMS-owned department assignment. |
| `project_role` / role mapping | IACMS-owned authorization role(s), never treated as globally valid IAM roles. |
| `iam_version` or `updated_at` | Monotonic change version/timestamp for event ordering and reconciliation. |
| `deleted_at` | Tombstone to preserve historical actor references and prevent accidental UUID reuse. |

The projection uses (`subject_id`, `tenant_id`) so one stable IAM subject can appear in multiple IACMS tenants. IAM membership changes publish a tenant-scoped projection snapshot for each mapped IACMS tenant. Never cascade-delete IACMS history when an IAM subject is disabled or deleted.

### Projection delivery and consistency

1. IAM is authoritative for account creation, authentication status, and identity profile attributes that IAM owns.
2. IAM publishes versioned lifecycle events through a transactional outbox (or another delivery mechanism with equivalent durability). Events need a stable event ID, subject ID, version, event type, and changed-field payload; exclude password hashes, tokens, recovery codes, and provider secrets.
3. IACMS consumes events idempotently and stores the last applied version. Ignore duplicates and older versions; alert and reconcile gaps.
4. Add a paginated reconciliation API/export and a scheduled IACMS comparison job so missed events can be repaired. Event delivery alone is not a recovery strategy.
5. IACMS owns tenant membership mapping, department assignment, and domain-role changes. Those changes update the IACMS projection locally and must not be overwritten by IAM profile events.
6. Account disablement is security-sensitive: document the maximum propagation delay and provide either a short token lifetime or a status check for high-risk APIs. Do not claim instant revocation from an event that may be delayed.

## Runtime caller ownership

| Caller | Target behavior before database cutover |
| --- | --- |
| API gateway API-key lifecycle | Already calls IAM internal endpoints for create/validate/list/rotate/revoke. Remove the legacy owner lookup after all issued API-key tokens carry owner identity and old-token lifetime has elapsed. |
| API gateway `updateUser` / `deactivateUser` | Move authentication-owned profile/status changes to IAM contracts; keep department and IACMS role changes local. Enforce caller tenant membership and prevent client-supplied identity headers from authorizing the call. |
| Case engine | Validate assignees/uploaders and resolve case authorization through IACMS projection and local tenant/domain roles; no IAM database access. |
| File service | Use the validated token subject plus IACMS projection for local active/tenant checks; do not query IAM tables. |
| Chat service | Use IACMS projection for user display/active/tenant data and IACMS departments for chat membership behavior. |
| Audit service | Store stable subject UUID and tenant UUID; resolve display data from a local projection or historical snapshot. Audit history must survive account deletion. |
| Integration service and other domain services | Keep tenant/domain records local; replace any foreign-key-like IAM user relation with stable subject IDs and local projections. |

Internal IAM APIs must authenticate the service caller, scope requests to the client/application, validate tenant membership where relevant, and avoid treating a shared static internal token plus caller-supplied headers as sufficient end-user authorization. Prefer mTLS or signed, audience-bound service credentials as deployment hardening proceeds.

## Migration sequence and exit checks

1. **Approve/adjust this ownership table.** Inventory every current `User`, `Tenant`, `Department`, `Role`, and `UserRole` read/write by service and decide field-level ownership.
2. **Add the IACMS projection and identity event contract.** Keep the existing shared tables as the source during dual-write/reconciliation; define versioning, tombstones, replay, and reconciliation before cutover.
3. **Migrate callers service by service.** Remove IAM database access from gateway and all application services. Keep local domain authorization and tenant/department data in IACMS.
4. **Decouple the IAM schema.** Replace required `User.tenantId` and `User.departmentId` dependencies with IAM account and membership models. Keep a mapping from existing subject UUIDs and IACMS tenant UUIDs. Establish an IAM-owned migration baseline from the verified deployed schema.
5. **Rehearse from sanitized data.** Copy with stable IDs, reconcile source and target, test login/token validation, disabled users, user changes, API keys, tenant/department behavior, case assignment, files, chat, audit actor display, event replay, and rollback.
6. **Cut over only IAM.** Switch IAM to its own database while IACMS keeps its domain database and projection. Observe reconciliation and preserve a tested rollback path before removing old IAM tables from IACMS migrations.

Cutover is blocked until all are true:

- IAM schema and migrations have no cross-database FK to IACMS tenant/department/domain-role records.
- No non-IAM service uses Prisma to read or write IAM-owned credential/account tables.
- Every IACMS user/tenant reference resolves to the preserved subject/tenant IDs in the local projection.
- Event replay and scheduled reconciliation repair missed/out-of-order changes.
- Login, app/audience isolation, disablement, API key lifecycle, IACMS authorization, audit history, and rollback pass against the isolated target.
- IAM and IACMS have separate database URLs, credentials, backups, migration jobs, and deployment health/readiness checks.

## Current codebase observations

- The IAM Prisma schema now allows `User.tenantId` to be null and retains the optional department relation for legacy accounts. A new additive migration changes the database constraint, but global identity creation is disabled until IAM has an isolated database because the root IACMS schema and several callers still require a tenant.
- Gateway API-key lifecycle and gateway profile/status mutations now call IAM; the gateway still reads legacy user projections for tenant checks, and department changes remain local.
- Case-engine policy still reads legacy `UserRole`; selected assignment/attachment/referral and chat participant/conversation paths now read `IdentityProjection`. Other runtime joins remain, and file/audit resolution plus partner account provisioning have not been moved. These need a complete local projection and application-owned role model before IAM can leave the shared database.
- Audit and integration service schemas declare local `User`/`Tenant` models for joins. Their runtime behavior and actual foreign-key constraints must be checked against deployed migrations before changing those schemas.
- The earlier sanitized rehearsal retained stable UUIDs. The later local cutover applied IAM-owned migrations, copied the IAM dataset, and verified an event through the IACMS projection consumer. Production migration and full user-authentication verification remain outstanding.

## Implementation status (2026-11-14)

- Added an IACMS-owned `identity_projection` model and additive backfill migration; it is applied locally and has 37 active projections. Assignment and referral assignee checks and selected chat/case-engine reads now use this model.
- Added IAM's `identity_event_outbox` schema, publisher, gateway projection consumer, and lifecycle event calls for IAM account registration, admin changes, profile changes, social provisioning, and status changes. They are enabled in the local deployment; an outbox event was consumed end to end and advanced the IACMS projection version.
- Added generic IAM organization/membership tables, wired account-creation paths to create their compatibility membership when enabled, and applied/backfilled the schema in local IAM (7 organizations, 37 memberships). The local deployment enables membership synchronization.
- Added platform-admin APIs to create/deactivate IAM organizations and add/update/list their memberships. OAuth clients can be organization-bound; OIDC login selects the user by active membership, and account resolution rechecks membership before issuing/refreshing tokens. An end-to-end read-only lookup against the sanitized rehearsal verified organization login lookup, active membership, OIDC account resolution, `organization_id`, and legacy tenant mapping. The local deployment enables membership synchronization; new org-bound clients enforce memberships directly.
- Made `User.tenantId` optional in the IAM schema with an additive migration and added platform-admin creation of tenantless identities. Creation is disabled by default until IAM uses its own database; the IACMS projection consumer skips global identities that have no IACMS organization mapping. Existing subject UUIDs and non-null tenant assignments are preserved.
- IAM still uses tenant, department, role, and user-role tables in its Prisma schema. The IAM-owned initial and tenantless-identity migrations are applied to the dedicated local database. The bootstrap migration is for a clean database and must not be replayed against existing IAM tables. Production migration ownership and migration-history adoption still need a controlled deployment procedure.
- The `data:backfill-memberships` command defaults to dry-run. Applying it requires both `--apply` and `IAM_MEMBERSHIP_BACKFILL_CONFIRM=apply`; it only adds IAM organizations/memberships and does not copy credentials or domain roles. It has been applied to the local dedicated IAM database (7 organizations, 37 memberships). Production databases were not touched.
- Added protected internal IAM endpoints for gateway profile and active-state updates, and moved the gateway GraphQL update/deactivate writes to those endpoints. Department assignment remains local.
- The local deployment is cut over to standalone IAM and the old shared-database IAM container is stopped. Production rollout is still pending. Case-engine uses IACMS-local role assignments; remaining file/audit and relation-based identity reads, IAM transitional tenant/department/role models, production migration ownership, and dynamic organization selection within one OAuth client remain follow-up work. Existing IACMS OIDC/browser migration is also separate from this database cutover.
