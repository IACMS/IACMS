# Seeded portal credentials (`prisma/seed.js`)

`prisma/seed.js` **wipes** the listed `public` schema tables (audit, cases, workflows, users, RBAC rows, tenants, etc.) and recreates a **portal-scale** demo dataset: permissions, global roles, the **ADMIN** platform tenant plus **six** operational tenants, staff users, five published workflows per tenant, case sequences, and **three** cross-tenant referrals from **DCS-01**.

**Use only on local/dev databases.** Run `migrate`/`generate` before seeding so the schema matches migrations.

### How to run

From repo root (with `DATABASE_URL` set, e.g. against Postgres):

```bash
npm run db:seed
# or:
npx prisma db seed
```

Both execute `node prisma/seed.js` (see root `package.json` → `prisma.seed`).

### Password (all seeded users below)

**`password123`**

Seeded users are created with `mustChangePassword: false` so you can sign in immediately for demos.

### Global RBAC (after seed)

| Role name (`roles.name`) | Seeded UUID (`roles.id`) | Notes |
|--------------------------|---------------------------|-------|
| `tenant_admin` | `55555555-5555-5555-5555-555555555555` | Operational org admins (`auth-service` resolves this canonical id first; optional env `TENANT_ADMIN_ROLE_ID` can override alignment with your DB.) |
| `system_admin` | `99999999-9999-9999-9999-999999999991` | **ADMIN** tenant only in this seed setup |
| `case_manager` | `66666666-6666-6666-6666-666666666666` | |
| `viewer` | `77777777-7777-7777-7777-777777777777` | |

**`intake_specialist`** is **not** a global row in this seed: a separate **tenant-scoped** role is created per operational tenant (`roles.tenantId` = that tenant), with permissions defined in-code as `intake_specialist` in `rolePermissions`.

**Permission sets (summary):**

- **`system_admin`**: All seeded permissions except `cases:*`, `workflows:*`, and `referrals:*` (platform operator focus).
- **`tenant_admin`**: All non-`platform` permissions (includes `cases`, `users`, `roles`, `tenants`, `referrals`, etc.; excludes `platform:manage_tenants`).
- **`case_manager`, `viewer`, `intake_specialist`**: As defined in `prisma/seed.js` (`rolePermissions`).

### Login: platform operator

Use tenant code **`ADMIN`** (platform tenant, not an operational agency).

| Field | Value |
|-------|-------|
| **Email** | `platform.admin@iacms.gov.example` |
| **Username** | `platform.admin` |
| **Tenant code** | `ADMIN` |
| **Tenant UUID** | `00000000-0000-0000-0000-000000000001` |
| **User UUID** | `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2` |
| **Role** | `system_admin` |

No cases, workflows, or operational staff are seeded **for** the ADMIN tenant itself. Operational demos use the tenants below.

### Operational tenants and staff (six users each)

Emails follow `\<local>@\<tenant-code-lower>.gov.example` (`makeEmail`). Usernames mirror the email local part with **dots replaced by underscores** (e.g. `case.manager1` → **`case_manager1`**).

| Tenant code | Name (short) | Tenant UUID |
|-------------|----------------|-------------|
| `DCS-01` | Department of Children Services — District 01 | `11111111-1111-1111-1111-111111111111` |
| `DCS-02` | Department of Children Services — District 02 | `11111111-1111-1111-1111-111111111112` |
| `CPS-GCPD` | Central Police Station — Gender & Child Protection Desk | `11111111-1111-1111-1111-111111111113` |
| `FAMILY-COURT` | Family Court Registry | `11111111-1111-1111-1111-111111111114` |
| `PUBLIC-HOSP` | Public Hospital — Social Work Unit | `11111111-1111-1111-1111-111111111115` |
| `LEGAL-AID` | Legal Aid Office | `11111111-1111-1111-1111-111111111116` |

**Users (same pattern every tenant)**

| Purpose | Email | Username | Assigned role names |
|---------|-------|----------|---------------------|
| Admin | `admin@…` | `admin` | `tenant_admin` (global UUID above) |
| Supervisor | `supervisor@…` | `supervisor` | `case_manager` |
| Intake | `intake@…` | `intake` | `intake_specialist` (tenant-scoped role UUID, unique per tenant) |
| Case manager 1 | `case.manager1@…` | `case_manager1` | `case_manager` |
| Case manager 2 | `case.manager2@…` | `case_manager2` | `case_manager` |
| Viewer | `viewer@…` | `viewer` | `viewer` |

Concrete emails (substitute `@` domain from tenant code lowercase):

**DCS-01:** `admin@dcs-01.gov.example`, `supervisor@dcs-01.gov.example`, `intake@dcs-01.gov.example`, `case.manager1@dcs-01.gov.example`, `case.manager2@dcs-01.gov.example`, `viewer@dcs-01.gov.example`

**DCS-02:** `… @dcs-02.gov.example` (same local parts)

**CPS-GCPD:** `… @cps-gcpd.gov.example`

**FAMILY-COURT:** `… @family-court.gov.example`

**PUBLIC-HOSP:** `… @public-hosp.gov.example`

**LEGAL-AID:** `… @legal-aid.gov.example`

Operational tenants also get `registeredByUserId` pointing at the platform user (seed simulates registrar linkage for auditing).

### Seeded workflows and referrals

- **Workflows**: Five published workflows per operational tenant (`child-protection` is default); full step/transition definitions are built in `createWorkflow()` in `prisma/seed.js`.
- **Referrals**: Three seeded referral cases originate from **DCS-01** toward **CPS-GCPD**, **PUBLIC-HOSP**, and **LEGAL-AID**, with statuses `completed`, `accepted`, and `rejected` respectively, plus aligned `case` / `case_referral` / audit rows.

### Console summary

Running the seed prints a short credential recap to stdout (matching the blocks above).
