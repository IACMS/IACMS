# IAM service

This directory contains the central IAM/OIDC service as an isolated application package. Its Node.js dependencies, lockfile, Prisma schema/client generation, container build, and build workflow are owned here. Build the container with this directory as the Docker context.

## Local run

1. Copy `.env.example` to `.env` and set a reachable `DATABASE_URL`, `OIDC_COOKIE_SECRET`, `CLIENT_SECRET_KEY`, and a private RS256 `OIDC_JWKS_JSON`.
2. Install the service's pinned dependencies and generate its Prisma client:

   ```sh
   npm ci
   npm run prisma:generate
   ```

3. Start the service:

   ```sh
   npm start
   ```

The service exposes health at `/health` and OIDC discovery at `/.well-known/openid-configuration`. See the [OIDC integration contract](../../docs/OIDC_INTEGRATION_CONTRACT.md) before registering a client.

## Standalone container build

From this directory:

```sh
docker build -t central-iam .
```

The build installs from this directory's `package-lock.json` and generates Prisma from `prisma/schema.prisma`; it does not read the IACMS root package, root schema, or `shared/` source. Runtime configuration is provided through container environment variables.

## Service boundary

IAM has its own Prisma schema, migration history, PostgreSQL and Redis deployment. Applications use OIDC/OAuth APIs and never access IAM tables directly. The IAM schema has no Department model; IACMS department routes and department claims were removed. The prior copied department table and user column are renamed as `legacy_iacms_departments` and `users.legacy_iacms_department_id` so the data remains available for rollback or a separately approved cleanup.

Identity lifecycle events are written to a transactional outbox. Events are routed by `IamOrganization.externalSystem`: the configured legacy system uses `IAM_IDENTITY_EVENTS_TOPIC` (default `iam.identity.events.v1`); other systems use `<IAM_IDENTITY_EVENTS_TOPIC_PREFIX>.<externalSystem>.v1` (default prefix `iam.identity.events`). Consumers must subscribe only to their own system topic and still verify the `externalSystem` field. `IAM_LEGACY_ORGANIZATION_SYSTEM=none` disables legacy tenant claims and the compatibility snapshot; set it to `iacms` only while serving IACMS-mapped clients.

Run `npm run prisma:migrate:status` and `npm run prisma:migrate:deploy` against the intended IAM database. The service does not auto-run migrations on startup. The new role-slug and legacy-department archive migration is additive/data-preserving; the IAM bootstrap migration is only for an empty database. Use a dedicated migration role; the IAM runtime role should not have schema-create privileges.

The OAuth client, provider, organization, and identity administration APIs accept either a trusted IACMS gateway request or an OIDC access token with the `iam:admin` scope and IAM admin assignment. Direct OIDC administration requires the token's audience to equal `IAM_ADMIN_AUDIENCE`, and the client must have an active `system-admin` or `iam-admin` application-role assignment. The middleware rechecks the assignment and organization membership in IAM on every request. Do not bypass it by trusting caller-supplied permission headers.

Roles are emitted as client-namespaced slugs, such as `<client_id>:case-manager`. Only the configured legacy IACMS integration receives the temporary `role_ids` compatibility claim. New resource servers must consume `roles` and enforce their own policy. Access tokens default to ten minutes (`OIDC_ACCESS_TOKEN_TTL_SECONDS`); introspection and revocation are enabled for resource servers requiring faster enforcement.

`IAM_ORG_MEMBERSHIPS_ENABLED` enables the membership bridge. The legacy tenant-to-membership utility is dry-run by default:

IAM organization-bound OAuth clients enforce an active `IamMembership` at login and during account resolution. Platform administrators can create organizations and manage memberships through `/iam/organizations`; tenantless identities can be created through `POST /iam/identities` when `IAM_GLOBAL_IDENTITIES_ENABLED=true`.

```sh
npm run data:backfill-memberships -- --dry-run
IAM_MEMBERSHIP_BACKFILL_CONFIRM=apply npm run data:backfill-memberships -- --apply
```

Use it only after legacy identity data has been copied into the intended IAM database and the schema is deployed. It preserves user UUIDs, adds organization and membership rows, and does not copy credentials or project roles. It was rehearsed against the sanitized local IAM database (7 organizations, 37 memberships, 0 unmatched mappings, idempotent rerun). Organization-bound OAuth clients enforce active memberships at login and account resolution; legacy tenant clients continue using `User.tenantId` unless the membership bridge flag is enabled. Legacy self-registration and admin provisioning still require a tenant; tenantless accounts are created only through the gated IAM identity endpoint.

The `.env.example` contains generic OIDC defaults. For IACMS, configure its audience and project scopes explicitly as shown in `infrastructure/.env.example`.

Platform administrators manage reusable IAM organizations through `/iam/organizations`, memberships through `/iam/organizations/:organizationId/memberships`, and gated global identities through `POST /iam/identities`. OAuth clients may bind to an `iamOrganizationId`; the OIDC login and account-resolution paths then require an active membership and issue the `organization_id` claim.

## Standalone deployment

`compose.yaml` runs IAM with a dedicated PostgreSQL database and Redis instance; IAM is not part of IACMS's Compose project. Create a deployment environment file from `.env.standalone.example`, set `IAM_DATABASE_URL` to the `iam` database exposed by `iam-postgres`, and generate IAM secrets. When migrating existing clients, preserve the current issuer, signing keys, and client-secret encryption key for the cutover. `IAM_MIGRATION_DATABASE_URL` is used only by the one-shot migration job and can use a more privileged migration role in production. Keep `OIDC_ISSUER` equal to the externally reachable HTTPS issuer URL.

Run the schema migration as an explicit release step, then start IAM:

```sh
docker compose --env-file .env.standalone -f compose.yaml --profile migration run --rm iam-migrate
docker compose --env-file .env.standalone -f compose.yaml up -d iam-postgres iam-redis iam-service
```

For a local IACMS deployment, attach only the IAM application container to the IACMS service network. IAM PostgreSQL and Redis stay on `iam-private`; do not configure `IAM_DATABASE_URL` to point at IACMS PostgreSQL. Start it with the optional bridge file:

```sh
docker compose --env-file .env.standalone \
  -f compose.yaml -f compose.iacms-bridge.yaml up -d iam-service
```

The external network name defaults to `infrastructure_iacms-network` and can be set with `IACMS_DOCKER_NETWORK`. IACMS callers use `IAM_SERVICE_URL=http://iam-service:3001`. Enable `IAM_IDENTITY_OUTBOX_ENABLED=true` and `IACMS_IDENTITY_PROJECTION_CONSUMER_ENABLED=true` only after both databases have their respective migrations and the IAM membership backfill is reconciled.

The initial migration is an empty-database bootstrap. Do not replay it against a populated database or point IAM at IACMS PostgreSQL. For production, use managed PostgreSQL with separate migration and runtime credentials, backups, and restricted network access; bundled Compose Postgres is a standalone deployment example. Legacy tenant and role tables remain for compatibility, while IACMS domain roles and departments belong to IACMS.
