# Enterprise API Serving & Integration Architecture Guide
## Unified Dynamic Query Engine & API Key Authentication Specification

---

## Executive Summary

This document establishes the official **API Serving Architecture** for external client systems, partner agencies, automated scripts, and third-party integrations interacting with the **Inter-Agency Case Management Platform (IACMS)**.

Modern enterprise integrations require simplicity, speed, and resilience. Traditional multi-endpoint REST architectures impose heavy integration friction—forcing external client systems to authenticate through interactive multi-step token loops, maintain session state, track dozens of discrete endpoints, and make multiple round-trip requests to stitch related data together.

IACMS addresses these challenges by offering a **Single Unified Query Endpoint** secured by **Static API Key Authentication**, benchmarked against industry standards such as **GraphQL**, **Stripe API Key Architecture**, and **Modern Enterprise Headless Data Dispatchers**.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                 Third-Party Agency / Automated Client System                    │
│                                                                                 │
│   • Requires only ONE Static API Key (No login/refresh token loops)             │
│   • Sends requests to ONE Single Endpoint (POST /api/v1/query)                  │
│   • Specifies exact fields and relations needed (No over-fetching)              │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         │ HTTPS Requests (X-API-Key Header)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           IACMS API Gateway Layer                               │
│                                                                                 │
│   1. API Key Validation: Instant cryptographically secure lookup                │
│   2. Automatic Tenant Context: Enforces strict data isolation                   │
│   3. Scope & RBAC Enforcement: Verifies resource permissions                    │
│   4. Intelligent Rate Limiting: Safeguards platform reliability                 │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Unified Dynamic Query & Action Engine                      │
│                                                                                 │
│   ┌───────────────────────────────┐     ┌───────────────────────────────────┐   │
│   │       Query Dispatcher        │     │        Mutation Dispatcher        │   │
│   │ • Dynamic Field Projection    │     │ • Case Creation                   │   │
│   │ • Automated Relation Joins    │     │ • Workflow State Machine Action   │   │
│   │ • Multi-Criteria Filtering    │     │ • Cross-Agency Referral Dispatch  │   │
│   │ • Deterministic Pagination    │     │ • Assignment Management           │   │
│   └───────────────────────────────┘     └───────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Architectural Philosophy: The Case for a Single Unified Endpoint

### The Integration Problem in Distributed Multi-Agency Platforms
In public sector and enterprise case management ecosystems, integrating partner organizations (e.g., Police Desks, Courts, Hospitals, Social Welfare Offices) presents distinct operational challenges:
1. **Diverse Technology Stacks**: Partner agencies utilize varying enterprise platforms (legacy mainframes, modern cloud ERPs, Python data pipelines, automated cron microservices). Requiring client teams to implement OAuth2 refresh handlers or manage dozens of microservice URLs introduces high integration failure rates.
2. **Network Overhead & Latency**: To view a case file alongside its active workflow phase, current assignee details, and case history, traditional REST requires 4 to 6 sequential HTTP requests. Over remote or constrained government networks, this compounds latency.
3. **Data Over-fetching & Bandwidth Waste**: Traditional endpoints return rigid, monolithic payloads containing system metadata unnecessary for the client's immediate operational needs.

### Benchmark Analysis: Why GraphQL & Modern Unified Query Engines Win

Industry-leading platforms (e.g., GitHub GraphQL API, Shopify Storefront API, Stripe Developer Platform, and Hasura Engine) have proven that single-endpoint, query-driven architectures drastically reduce time-to-market for integrating teams.

| Dimension | Legacy Multi-Endpoint REST | Benchmark GraphQL / Unified Engine | IACMS Unified Query Architecture |
| :--- | :--- | :--- | :--- |
| **Endpoint Footprint** | 30+ fragmented endpoints | 1 Single URL (`/graphql` or `/query`) | **1 Single Unified Gateway URL (`/api/v1/query`)** |
| **Authentication Flow** | `POST /auth/login` $\to$ JWT $\to$ Refresh loops | Static API Key (`Bearer` or `X-API-Key`) | **Static API Key (Header-based, zero token rotation overhead)** |
| **Data Fetching** | Rigid schema; fixed fields per route | Client defines exact fields and relations | **Dynamic Projection (Client selects exact fields & relations)** |
| **Round Trips** | Multiple calls (Case $\to$ Step $\to$ Assignee) | 1 call retrieves multi-level relations | **1 call retrieves case, relations, history, and actions** |
| **Write Operations** | Separate POST/PUT/PATCH routes | Explicit Mutation Operations | **Unified Action Dispatcher with atomic transaction safety** |
| **Client Maintenance** | Heavy SDK or custom wrapper per route | Generic HTTP POST client (cURL, Python, Java) | **Ultra-lightweight: Any HTTP client library in 5 lines of code** |

---

## 2. API Key Authentication & Security Governance

External automated systems communicate with IACMS via **API Key Authentication**. This replaces user-centric interactive logins with a secure machine-to-machine (M2M) protocol.

```
┌────────────────────────┐      ┌─────────────────────────┐      ┌─────────────────────────┐
│     Client System      │      │   API Gateway (Edge)    │      │  Identity & Data Store  │
└───────────┬────────────┘      └────────────┬────────────┘      └────────────┬────────────┘
            │                                │                                │
            │ 1. Request + X-API-Key         │                                │
            ├───────────────────────────────>│                                │
            │                                │ 2. Cryptographic Hash (SHA-256)│
            │                                ├───────────────────────────────>│
            │                                │                                │
            │                                │ 3. Return Tenant ID + Scopes   │
            │                                │<───────────────────────────────┤
            │                                │                                │
            │                                │ 4. Inject Tenant Scope Context │
            │                                │    into Downstream Query Engine│
            │                                │                                │
            │ 5. Tailored JSON Response      │                                │
            │<───────────────────────────────┤                                │
```

### Security Architecture Highlights
1. **Secret Key Isolation**: API keys are generated with a distinct prefix (`iacms_live_...`) and presented **only once** upon generation. The database stores only a salted cryptographic hash (SHA-256), ensuring that even in the event of a database inspection, raw keys cannot be recovered.
2. **Deterministic Tenant Binding**: Every API key is permanently bound to an issuing Organization/Tenant. When a partner agency calls the API, the Gateway injects the tenant context, making it mathematically impossible for a partner system to access another tenant's data.
3. **Granular Scoping (Least Privilege)**: Keys can be scoped to specific permissions (e.g., `cases:read`, `cases:create`, `referrals:read`). An API key provisioned for case ingestion cannot trigger administrative operations or export system audit trails.
4. **Instant Revocation & Lifecycle Management**: Platform administrators or agency security officers can instantly deactivate, rotate, or set expiration dates on API keys without disrupting human user credentials.
5. **Edge Rate Limiting**: Requests authenticated via API keys are monitored through Redis-backed token-bucket rate limiters, shielding the core system from runaway scripts or denial-of-service attempts.

---

## 3. The Unified API Specification

### Endpoint Contract
* **URL**: `POST /api/v1/query`
* **Transport**: HTTPS (TLS 1.3 recommended)
* **Headers**:
  * `Content-Type: application/json`
  * `X-API-Key: iacms_live_xxxxxxxxxxxxxxxxxxxxxxxx`

---

## 4. Query Operations: Dynamic Data Retrieval

The query interface allows client systems to specify the target entity, desired fields, relational data, filters, sorting, and pagination within a single JSON payload.

### Core Structure of a Query Request
```json
{
  "operation": "query",
  "entity": "cases",
  "select": [
    "id",
    "caseNumber",
    "title",
    "status",
    "priority",
    "dueDate",
    "assignee.firstName",
    "assignee.email",
    "currentStep.name",
    "currentStep.key",
    "workflow.name"
  ],
  "filter": {
    "status": "in_progress",
    "priority": "high"
  },
  "sort": {
    "createdAt": "desc"
  },
  "pagination": {
    "limit": 20,
    "offset": 0
  }
}
```

### Architectural Capabilities of the Query Engine

#### 1. Dynamic Field Selection (Zero Over-fetching)
The client dictates the exact field projection. Unrequested fields (such as internal flags, database foreign keys, or raw configurations) are stripped from the response before serialization, saving memory and network bandwidth.

#### 2. Declarative Multi-Level Relational Joins
Clients can fetch nested entity data in the same call using dot notation or nested objects:
* `assignee.*`: Assigned officer’s contact and profile details.
* `currentStep.*`: Active stage in the workflow process.
* `workflow.*`: Workflow version and classification metadata.
* `originatingDepartment.*` / `currentDepartment.*`: Departmental ownership.

#### 3. Expressive Filtering Operators
The `filter` block supports robust querying options:
* **Exact match**: `{"status": "open"}`
* **List membership**: `{"priority": { "in": ["high", "critical"] }}`
* **Date ranges**: `{"createdAt": { "gte": "2026-01-01T00:00:00Z", "lte": "2026-06-30T23:59:59Z" }}`
* **Text search**: `{"title": { "contains": "Child Protection" }}`

#### 4. Predictable Pagination & Sorting
Standardized pagination metadata (`total`, `limit`, `offset`, `hasMore`) ensures high-volume data syncs remain deterministic and performant.

### Example Response Payload
```json
{
  "success": true,
  "data": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "caseNumber": "DCS01-2026-0101",
      "title": "Child Welfare Assessment & Safety Plan",
      "status": "in_progress",
      "priority": "high",
      "dueDate": "2026-08-25T00:00:00.000Z",
      "assignee": {
        "firstName": "Ethan",
        "email": "ethan.kim@dcs-01.gov.example"
      },
      "currentStep": {
        "name": "Supervisor Review",
        "key": "review"
      },
      "workflow": {
        "name": "Child Protection Response"
      }
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 20,
    "offset": 0,
    "hasMore": false
  },
  "meta": {
    "executionTimeMs": 14,
    "requestId": "req_8923bc71a"
  }
}
```

---

## 5. Mutation Operations: Executing Actions & Business Logic

All state-changing operations (such as creating records, advancing workflow transitions, and managing cross-agency referrals) use the same single endpoint by declaring `"operation": "mutate"`.

### 5.1 Case Creation Action
External systems (e.g., automated intake hotlines, medical triage portals) can programmatically submit new cases directly into the appropriate workflow:

```json
{
  "operation": "mutate",
  "action": "createCase",
  "data": {
    "workflowKey": "child-protection",
    "title": "Emergency Referral: Unattended Minor Report",
    "description": "Report logged via emergency partner hotline.",
    "type": "child_protection",
    "priority": "critical",
    "data": {
      "intakeChannel": "partner_api",
      "incidentLocation": "District 01 - Zone B",
      "immediateAssistanceRequired": true
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "action": "createCase",
  "data": {
    "caseId": "e1829a0b-1122-4372-a567-0e02b2c3d999",
    "caseNumber": "DCS01-2026-0501",
    "status": "open",
    "currentStep": "Intake Desk",
    "createdAt": "2026-08-17T11:00:00.000Z"
  }
}
```

---

### 5.2 Workflow Step Transition Action
Clients can progress a case through its official governance stages while fulfilling business rules (such as mandatory caseworker comments or attached document verifications):

```json
{
  "operation": "mutate",
  "action": "executeTransition",
  "data": {
    "caseId": "e1829a0b-1122-4372-a567-0e02b2c3d999",
    "transitionId": "t8888888-1111-2222-3333-444444444444",
    "comment": "Field investigation complete. Intake verification verified by officer."
  }
}
```

---

### 5.3 Inter-Agency Case Referral Action
When one agency needs to transfer or escalate a case to another jurisdiction (e.g., Police Department referring evidence to the Family Court):

```json
{
  "operation": "mutate",
  "action": "createReferral",
  "data": {
    "caseId": "e1829a0b-1122-4372-a567-0e02b2c3d999",
    "toTenantCode": "CPS-GCPD",
    "toDepartmentCode": "CPS-INVEST",
    "referralReason": "Police protection and joint witness interview requested.",
    "notes": "Urgent safety assessment required within 48 hours."
  }
}
```

---

## 6. Supported Queryable Entities Reference

The Single Query Endpoint provides unified access to the core operational entities of the IACMS platform:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Unified Domain Schema                              │
├───────────────────┬─────────────────────────────────────────────────────────┤
│ Entity Name       │ Description & Key Available Fields                      │
├───────────────────┼─────────────────────────────────────────────────────────┤
│ `cases`           │ Case files, numbers, status, priorities, forms, due dates│
│ `workflows`       │ Workflow blueprints, published stages, transition rules │
│ `workflowSteps`   │ Individual stages, SLAs, role permissions, gates        │
│ `referrals`       │ Cross-tenant transfers, inbound/outbound status, notes  │
│ `assignments`     │ Officer allocations, assignment history, active states  │
│ `auditLogs`       │ Immutable chronological audit trail of all actions      │
│ `departments`     │ Internal agency operational units and desks             │
│ `metrics`         │ Real-time aggregated statistics and SLA compliance data │
└───────────────────┴─────────────────────────────────────────────────────────┘
```

---

## 7. Multi-Tenant Data Governance, Hardening & Compliance

In a multi-agency government environment holding sensitive case files (including child protection and law enforcement records), security and audit compliance are paramount. The dynamic query engine incorporates strict defense-in-depth controls before handling live external traffic:

### 7.1 Production Security & Defense-in-Depth Matrix

| # | Hardening Control | Severity | Risk Addressed | Implementation Standard |
| :- | :--- | :---: | :--- | :--- |
| 1 | **Field-Level Allowlisting** | **Critical** | Default-open column exposure when new database fields are added. | Per-entity, per-scope field allowlists enforced in code and CI build checks. Un-allowlisted fields are stripped. |
| 2 | **Database-Enforced Tenant Isolation (Postgres RLS)** | **Critical** | Single app-layer dispatcher bug exposing cross-tenant data. | Postgres Row-Level Security (RLS) policies on all multi-tenant tables, tied to session/API key tenant context. |
| 3 | **Query Depth & Cost Ceilings** | **High** | Unbounded nested joins or Cartesian explosion causing Denial of Service. | Strict relation nesting depth limits (max 3 levels) and computed query cost ceilings per request. |
| 4 | **Filter Field Allowlists** | **High** | Side-channel data leakage via ORM `where` clauses on non-selectable fields. | Separate filterable-field allowlists per entity/scope; validate allowed operators per field type. |
| 5 | **Durable Audit Trail (Transactional Outbox)** | **High** | Silent audit gap if process crashes between DB commit and Kafka event publish. | Transactional outbox pattern (or synchronous audit write before HTTP response) for full compliance reliability. |
| 6 | **Explicit Mutation Schemas & State-Machine Guards** | **Medium** | Unvalidated mutation payloads or out-of-order state transitions. | Strict Zod / JSON Schema validation per action with server-side workflow state-machine transition guards. |
| 7 | **Benchmarking & Security Analogue Alignment** | **Low** | Misaligned security expectations comparing fixed REST vs dynamic engines. | Security benchmarked against **Hasura Engine** and **GitHub GraphQL** permission models, not fixed-shape REST. |

---

## 8. Phased Production Rollout Plan

To safely onboard partner agencies without risking platform stability or multi-tenant data isolation, deployment follows a 4-phase rollout gate:

```
┌───────────────────────────┐     ┌───────────────────────────┐     ┌───────────────────────────┐     ┌───────────────────────────┐
│     Phase 0: Build        │  ►  │      Phase 1: Pilot       │  ►  │    Phase 2: Write Access  │  ►  │ Phase 3: General Avail.   │
│ • Engine & RLS Policies   │     │ • 1 Low-Risk Agency       │     │ • enable createCase,      │     │ • Self-Service Key Portal │
│ • Field Allowlists & CI   │     │ • Read-Only Scoped Keys   │     │   executeTransition, etc. │     │ • Open to All Agencies    │
│ • Depth & Cost Limits     │     │ • Outbox Audit Logging    │     │ • Action Schemas & Guards │     │ • All Hardening Items Closed│
└───────────────────────────┘     └───────────────────────────┘     └───────────────────────────┘     └───────────────────────────┘
```

| Phase | Scope | Exit Criteria |
| :--- | :--- | :--- |
| **Phase 0: Internal Build** | Build query/mutation engine, field allowlists, RLS, depth/cost limits. No external traffic. | Cross-tenant test suite passes 100%; allowlist CI check passes; depth limits verified. |
| **Phase 1: Pilot Partner** | Onboard one low-risk partner agency with a read-only, narrowly-scoped API key. Outbox audit live. | 2 weeks of production traffic with zero isolation or data exposure incidents. |
| **Phase 2: Write Access** | Enable `createCase`, `executeTransition`, and `createReferral` mutations with per-action schemas and workflow state-machine guards. | Security sign-off on mutation validation, state-machine guards, and audit trail coverage. |
| **Phase 3: General Availability** | Open API key self-service portal and onboarding for all external partner agencies. | All Critical and High hardening controls verified and signed off. |

---

## 9. Client Integration Walkthrough (Developer Experience)

Because the system uses a single endpoint and header-based authentication, integrating from any programming language requires only standard HTTP capabilities without specialized SDKs.

### cURL Example
```bash
curl -X POST https://api.iacms.gov/api/v1/query \
  -H "Content-Type: application/json" \
  -H "X-API-Key: iacms_live_sec_8f93bc4102948a" \
  -d '{
    "operation": "query",
    "entity": "cases",
    "select": ["caseNumber", "title", "status", "currentStep.name"],
    "filter": { "priority": "critical" }
  }'
```

### Python Integration Example
```python
import requests

API_URL = "https://api.iacms.gov/api/v1/query"
API_KEY = "iacms_live_sec_8f93bc4102948a"

headers = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY
}

query_payload = {
    "operation": "query",
    "entity": "cases",
    "select": [
        "caseNumber",
        "title",
        "status",
        "dueDate",
        "assignee.firstName",
        "currentStep.name"
    ],
    "filter": {"status": "in_progress"},
    "pagination": {"limit": 10}
}

response = requests.post(API_URL, json=query_payload, headers=headers)
cases = response.json().get("data", [])

for case in cases:
    print(f"[{case['caseNumber']}] {case['title']} -> Step: {case['currentStep']['name']}")
```

### Node.js Integration Example
```javascript
const API_URL = 'https://api.iacms.gov/api/v1/query';
const API_KEY = 'iacms_live_sec_8f93bc4102948a';

async function fetchUrgentCases() {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify({
      operation: 'query',
      entity: 'cases',
      select: ['caseNumber', 'title', 'priority', 'assignee.email'],
      filter: { priority: 'critical' },
    }),
  });

  const result = await response.json();
  console.log(result.data);
}

fetchUrgentCases();
```

---

## 9. Error Handling & Status Contracts

The Unified API uses deterministic, machine-readable error responses:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_API_KEY",
    "message": "The provided API key is invalid or has expired.",
    "details": {
      "resolution": "Generate a new API key in the agency settings portal."
    }
  },
  "meta": {
    "requestId": "err_91823bc0"
  }
}
```

### Error Taxonomy
* `UNAUTHORIZED` (`401`): Missing, invalid, or expired API Key.
* `FORBIDDEN` (`403`): Key lacks the required scope for the requested entity or action.
* `INVALID_QUERY` (`400`): Malformed JSON, non-existent entity, or invalid field selection.
* `BUSINESS_RULE_VIOLATION` (`422`): Mutation rejected due to workflow constraints (e.g., missing required supervisor comment).
* `RATE_LIMITED` (`429`): Quota exceeded; client should back off and retry.

---

## 10. Summary & Value Proposition

By adopting this **Single Unified Query Endpoint with API Key Authentication**:

1. **For Partner Agencies**: Integration complexity drops to near zero. A single API key and one endpoint replace weeks of bespoke API client development.
2. **For Platform Performance**: Network traffic and database queries are optimized via dynamic field projections, preventing the over-fetching and under-fetching common in legacy REST.
3. **For Security & Compliance**: Stateless API key verification, automatic tenant bounding, and centralized audit emission ensure strict government-grade security standards.
