# Session-Based Authentication
## IACMS API Gateway — Implementation Overview

**Commit:** `41051176` — *Session based authentication added.*  
**Author:** bisrat6 · Feb 17, 2026

---

# What Was Implemented

- **Session-based authentication** for the IACMS API Gateway
- **Dual auth strategy:** sessions (web) + JWT (mobile/API)
- **PostgreSQL-backed sessions** in `user_sessions` table
- **New session API:** login, logout, status, refresh
- **Updated auth middleware** to support both session and JWT
- **Documentation** and flow diagram

---

# Why Dual Authentication?

| Client           | Challenge                    | Solution              |
|-----------------|-----------------------------|------------------------|
| **Web browsers** | XSS can steal tokens from JS | **HttpOnly cookies**  |
| **Mobile / API** | No cookies; need tokens      | **JWT Bearer tokens** |

- **Web:** secure `iacms.sid` cookie, not accessible to JavaScript  
- **Mobile/API:** JWT in `Authorization: Bearer …`  
- **Gateway:** accepts both; session checked first, then JWT

---

# Architecture Overview

```
Browser (Cookies)  →  API Gateway (Sessions)  →  Auth Service
                            ↓
                    PostgreSQL (user_sessions)
```

- **Login:** Gateway calls Auth Service → creates session → sets `Set-Cookie`
- **Authenticated requests:** Cookie → session lookup → `req.session.user` → headers to services
- **Logout:** Destroy session in DB + clear cookie

---

# New & Modified Files

| Change | File |
|--------|------|
| **Added** | `docs/SESSION_AUTHENTICATION.md` |
| **Added** | `docs/session-auth-flow.png` |
| **Added** | `session.config.js` |
| **Added** | `session.controller.js` |
| **Added** | `session.routes.js` |
| **Modified** | `auth.middleware.js` (session + JWT) |
| **Modified** | `server.js` (session middleware, routes) |
| **Modified** | `package.json` (express-session, connect-pg-simple, etc.) |
| **Removed** | `IACMS_Postman_Collection.json` |

---

# Session Configuration (`session.config.js`)

- **Store:** PostgreSQL via `connect-pg-simple`
- **Table:** `user_sessions` (sid, sess, expire) — auto-created
- **Cookie:** `iacms.sid`, HttpOnly, SameSite: lax, configurable maxAge
- **Options:** `rolling: true`, `saveUninitialized: false`, `resave: false`
- **Cleanup:** Index on `expire` for efficient expiry/cleanup

---

# Session API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| **POST** | `/api/v1/session/login` | Login with email/password/tenantCode → create session, set cookie |
| **POST** | `/api/v1/session/logout` | Destroy session, clear cookie |
| **GET**  | `/api/v1/session/status` | Return auth state (session or JWT) and user info |
| **POST** | `/api/v1/session/refresh` | Touch session to extend expiry (rolling) |

---

# Session Login Flow

1. Client sends `POST /api/v1/session/login` with `{ email, password, tenantCode }`
2. Gateway forwards to Auth Service `/auth/login`
3. On success: Gateway creates session with user data, saves to PostgreSQL
4. Response: JSON + `Set-Cookie: iacms.sid=...`
5. Browser stores cookie; subsequent requests send it automatically

---

# Session Logout & Status

**Logout**
- Destroy session in DB
- Clear `iacms.sid` cookie (same options as when set)
- Respond with `{ message: 'Logged out successfully' }`

**Status** (`GET /api/v1/session/status`)
- If session exists → `authenticated: true`, `authMethod: 'session'`, user + session timestamps
- Else if JWT present → `authenticated: true`, `authMethod: 'jwt'`, user
- Else → `authenticated: false`

---

# Auth Middleware (Updated)

**Order of checks:**
1. **Public routes** → skip auth (e.g. `/session/login`, `/auth/login`)
2. **Session** → if `req.session.user` exists → set `req.user`, `req.authMethod = 'session'`, set `x-user-id`, `x-tenant-id`, etc., touch session → `next()`
3. **JWT** → if `Authorization: Bearer <token>` → verify JWT → set `req.user`, `req.authMethod = 'jwt'`, set headers → `next()`
4. Otherwise → 401 Unauthorized

---

# Security Highlights

- **HttpOnly cookie** — not readable by JavaScript (XSS mitigation)
- **SameSite: lax** — reduces CSRF risk
- **Signed session ID** — `SESSION_SECRET` for cookie signature
- **Rolling sessions** — expiry extends on activity
- **Explicit logout** — destroy server-side session + clear cookie

---

# Database: `user_sessions`

| Column  | Type      | Description        |
|---------|-----------|--------------------|
| `sid`   | VARCHAR   | Session ID (PK)    |
| `sess`  | JSON      | Session data (user, timestamps) |
| `expire`| TIMESTAMP | Expiration (indexed for cleanup) |

- Table created automatically by session config
- Single PostgreSQL instance; no extra Redis required

---

# Environment / Config

- **`DATABASE_URL`** — PostgreSQL connection (default: `localhost:5433/iacms`)
- **`SESSION_SECRET`** — sign session cookie (change in production)
- **`SESSION_MAX_AGE`** — seconds (default 86400 = 24h), converted to ms for cookie
- **`AUTH_SERVICE_URL`** — Auth Service base URL for login validation
- **`NODE_ENV`** — production uses `secure: true` for cookie

---

# Summary

- **Session-based auth** is implemented and documented.
- **Web** uses cookies; **mobile/API** keeps using JWT.
- **One gateway** handles both via updated middleware and new session routes.
- **PostgreSQL** stores sessions; flow diagram and full docs are in `docs/`.

**Next steps (optional):** frontend integration with cookie-based login, session cleanup job for expired rows, and (if needed) CSRF tokens for state-changing requests.
