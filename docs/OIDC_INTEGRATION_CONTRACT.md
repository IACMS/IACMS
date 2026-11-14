# IAM OIDC integration contract

This is the supported integration boundary for IACMS and future projects. Clients integrate with IAM over OpenID Connect and OAuth 2.0; they do not query IAM's database or import IAM source code.

## Issuer and discovery

- Configure the issuer base URL as `OIDC_ISSUER` (for example, `https://identity.example.org`). It must be the same URL clients and resource servers use to validate `iss`.
- Discover protocol endpoints from `/.well-known/openid-configuration` and retrieve signing keys from the advertised JWKS URI (currently `/oauth/jwks`). Do not hard-code key material or assume key IDs are permanent.
- IAM signs access tokens with RS256. Resource servers validate signature, exact issuer, expected audience, expiry, and required scopes.

## Client flows

| Client | Supported flow | Requirements |
| --- | --- | --- |
| Browser SPA or native app | Authorization code | PKCE with `S256`; registered exact redirect URI; public client has no secret |
| Server-rendered confidential app | Authorization code | Registered exact redirect URI; authenticate with its registered client method |
| Service-to-service client | Client credentials | Confidential client; request only its registered resource and scopes |

New clients should use these standard flows. The IACMS API-key grant and legacy `/auth/login` HMAC-token flow are compatibility paths, not the integration contract for new projects. SAML is not part of the current supported contract.

## Resource and audience rules

- Each API is a resource server and owns a stable audience URI, such as `https://api.project.example.org`.
- Register each client with its permitted target audience. Request that audience as the OAuth `resource` parameter where the client flow uses resource indicators.
- Configure `OIDC_DEFAULT_RESOURCE` only when maintaining a legacy single-resource deployment. For multi-project deployments, leave it unset and require explicit resource requests.
- A resource server must reject a token whose `aud` does not contain its own audience. Do not accept a token solely because its signature is valid.

## Scopes and authorization

- `openid`, `profile`, `email`, `offline_access`, `roles`, `iam:admin`, and application scopes are configured through `OIDC_SUPPORTED_SCOPES`.
- `OIDC_RESOURCE_SCOPES` lists scopes accepted for resource-indicator access tokens. A client's registered scope allowlist further limits its token requests.
- Treat `roles` as client-namespaced role slugs (for example `<client_id>:analyst`), not as database IDs or a replacement for project authorization. Each project maps its role claim to local domain policy and checks scopes on protected routes. Only the explicitly configured legacy IACMS integration receives the temporary `role_ids` compatibility claim.
- Application role assignments are scoped to an OAuth client. New clients must use an explicit `targetAudience` and application-specific role assignments. Do not rely on legacy role fallback behavior.
- IAM administration clients request `iam:admin` for the `IAM_ADMIN_AUDIENCE`. IAM only retains that scope in a token for a subject with a live `system-admin` or `iam-admin` role assignment for that client. Administration APIs validate issuer, signature, audience, scope, identity status, role assignment, and organization membership.

## Token and claim expectations

- Access tokens are signed JWTs with a ten-minute default lifetime, configurable with `OIDC_ACCESS_TOKEN_TTL_SECONDS`. Refresh tokens are rotated and have a fourteen-day configured lifetime; requesting `offline_access` is required for refresh-token use.
- `sub` is the account identifier. Treat it as opaque and do not use email as a primary key.
- `scope` is a space-separated set of granted scopes. `roles` may be present when requested and assigned for the client.
- `profile` and `email` claims are returned only when their scopes are granted. IAM does not emit IACMS department claims.
- `sub` is the stable IAM identity ID (`oidc_id` in client terminology). `organization_id` identifies the IAM organization selected by the registered client's organization binding. For explicitly configured legacy IACMS mappings, the compatibility `tenant_id` and `tenant_code` may also be emitted. New clients should use the standard subject and their documented organization context; they must not treat a tenant ID as a person ID.
- One identity may have zero, one, or many organization memberships. Today an OAuth client may bind to one organization, so a subject signs into separate tenant-bound clients/scopes as authorized. A single OAuth client that dynamically serves multiple tenants still needs an explicit organization-selection protocol and is not enabled by this contract yet.
- ID tokens are for the client sign-in session. APIs accept access tokens, never ID tokens.

## Logout, revocation, and operations

- Clients use the discovered revocation and end-session endpoints; the provider rotates refresh tokens and invalidates a refresh-token family on reuse.
- JWT access tokens may remain usable until expiry unless a resource server performs online introspection or maintains a revocation check. Projects should use the configured short lifetime and account for its maximum exposure window.
- Disablement and application-access changes affect newly issued tokens immediately. Existing self-contained access tokens can retain their claims until expiry unless the resource server uses online revocation.
- Signing keys must be rotated by publishing overlapping public keys through JWKS before removing old keys. Client secrets and private signing keys are deployment secrets and must not be committed.
