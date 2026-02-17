# Session-Based Authentication Implementation

## Overview

This document describes the implementation of session-based authentication for the IACMS (Integrated Agency Case Management System) API Gateway. Session authentication complements the existing JWT authentication, providing a dual authentication strategy:

- **Session Authentication**: For web browser clients (uses HTTP cookies)
- **JWT Authentication**: For mobile apps and API clients (uses Bearer tokens)

![Session Authentication Flow](./session-auth-flow.png)

---

## Why Dual Authentication?

### The Problem

Different types of clients have different security requirements and capabilities:

| Client Type | Challenge | Best Solution |
|-------------|-----------|---------------|
| **Web Browsers** | XSS attacks can steal tokens from JavaScript | HttpOnly cookies (inaccessible to JS) |
| **Mobile Apps** | No native cookie support, need offline token storage | JWT tokens in secure storage |
| **API Clients** | Stateless communication preferred | JWT tokens in headers |

### The Solution

We implement **both** authentication methods, allowing:
- Web browsers to use secure, HttpOnly session cookies
- Mobile/API clients to use JWT Bearer tokens
- The API Gateway to seamlessly handle both methods

---

## Architecture

### Authentication Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web Browser   │────▶│   API Gateway   │────▶│  Auth Service   │
│   (Cookies)     │◀────│   (Sessions)    │◀────│  (Validation)   │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │   PostgreSQL    │
                        │ (user_sessions) │
                        └─────────────────┘
```

### How It Works Step-by-Step

#### Session Login Flow (Web Browser)

```
1. Browser sends POST /api/v1/session/login with credentials
   ↓
2. API Gateway receives request
   ↓
3. Gateway forwards credentials to Auth Service for validation
   ↓
4. Auth Service validates credentials against database
   ↓
5. Auth Service returns user data + JWT tokens
   ↓
6. Gateway creates session object with user data
   ↓
7. Gateway saves session to PostgreSQL (user_sessions table)
   ↓
8. Gateway sends response with Set-Cookie header (iacms.sid)
   ↓
9. Browser stores cookie automatically
```

#### Authenticated Request Flow

```
1. Browser sends request with Cookie: iacms.sid=xxx
   ↓
2. Cookie Parser middleware extracts cookie
   ↓
3. Session Middleware looks up session in PostgreSQL by session ID
   ↓
4. Session data (including user) attached to req.session
   ↓
5. Auth Middleware checks req.session.user exists
   ↓
6. Auth Middleware sets x-user-id, x-tenant-id headers
   ↓
7. Request proxied to appropriate microservice
```

### Session Storage

Sessions are stored in PostgreSQL in the `user_sessions` table:

| Column | Type | Description |
|--------|------|-------------|
| `sid` | VARCHAR | Session ID (Primary Key) - A unique cryptographic string |
| `sess` | JSON | Session data including user info, cookie settings, timestamps |
| `expire` | TIMESTAMP | When the session expires (used for cleanup) |

**Why PostgreSQL instead of Redis?**
- Simplicity: No additional service to manage
- Persistence: Sessions survive database restarts
- Already available: We're already using PostgreSQL for the application

---

## Files Created/Modified

### 1. New Files

---

### `services/api-gateway/src/config/session.config.js`

**Purpose:** Configures the session middleware and PostgreSQL connection for storing sessions.

**What It Does:**

This file is the foundation of session management. It:
1. Creates a connection pool to PostgreSQL for efficient database connections
2. Sets up the session table in the database if it doesn't exist
3. Configures how sessions behave (expiry, cookie settings, etc.)
4. Returns an Express middleware that handles all session operations

**Functions:**

#### `createSessionMiddleware()`
```javascript
export async function createSessionMiddleware() {
  await createSessionTable();  // Ensure table exists
  
  const pgStore = new PgStore({
    pool: pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  });
  
  return session(sessionConfig);
}
```

**What it does:**
- Creates the sessions table in PostgreSQL if it doesn't exist
- Initializes the PostgreSQL session store (connect-pg-simple)
- Configures session behavior (cookie name, expiry, security settings)
- Returns an Express middleware function

**Why it's async:** The database table creation is an async operation, and we need to ensure the table exists before the server starts accepting requests.

---

#### `createSessionTable()`
```javascript
async function createSessionTable() {
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS "user_sessions" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");
  `;
  await pool.query(createTableSQL);
}
```

**What it does:**
- Runs SQL to create the `user_sessions` table
- Uses `IF NOT EXISTS` so it's safe to run multiple times
- Creates an index on `expire` column for efficient session cleanup queries

**Why the index?** Expired sessions need to be cleaned up periodically. The index makes queries like `DELETE FROM user_sessions WHERE expire < NOW()` fast.

---

#### `getPool()`
```javascript
export function getPool() {
  return pool;
}
```

**What it does:** Returns the PostgreSQL connection pool for manual database operations if needed elsewhere in the application.

---

#### `closeSessionStore()`
```javascript
export async function closeSessionStore() {
  await pool.end();
}
```

**What it does:** Gracefully closes all database connections when the server shuts down. Important for clean shutdown and preventing connection leaks.

---

**Configuration Options Explained:**

```javascript
{
  store: pgStore,         // WHERE sessions are stored (PostgreSQL)
  
  secret: SESSION_SECRET, // Key used to sign the session ID cookie
                          // Prevents tampering - if someone modifies the
                          // cookie, the signature won't match
  
  name: 'iacms.sid',      // The cookie name. Default is 'connect.sid'
                          // Custom name adds slight security by obscurity
  
  resave: false,          // Don't save session back to store if it wasn't
                          // modified. Saves database writes.
  
  saveUninitialized: false, // Don't create a session until something is
                            // stored. Prevents empty sessions for guests.
  
  rolling: true,          // Reset the cookie expiration on every request.
                          // User stays logged in as long as they're active.
  
  cookie: {
    secure: false,        // In production: true = HTTPS only
                          // In development: false = allows HTTP
    
    httpOnly: true,       // CRITICAL: JavaScript cannot access this cookie
                          // Prevents XSS attacks from stealing sessions
    
    maxAge: 86400000,     // 24 hours in milliseconds
                          // How long until the cookie expires
    
    sameSite: 'lax',      // CSRF protection:
                          // - 'strict': Cookie only sent for same-site requests
                          // - 'lax': Cookie sent for same-site + top-level navigations
                          // - 'none': Always sent (requires secure: true)
    
    path: '/'             // Cookie is valid for all paths on the domain
  }
}
```

---

### `services/api-gateway/src/controllers/session.controller.js`

**Purpose:** Handles HTTP requests for session management (login, logout, status, refresh).

**What It Does:**

This controller acts as the bridge between web browsers and the authentication system. Instead of just passing requests to the Auth Service (like JWT auth does), it:
1. Validates credentials via Auth Service
2. Creates and manages sessions at the Gateway level
3. Handles cookie management

---

#### `sessionLogin(req, res, next)`

**What it does:**
1. Extracts credentials from request body
2. Forwards credentials to Auth Service for validation
3. If valid, creates a session with user data
4. Saves session to PostgreSQL
5. Returns success response (cookie is set automatically by Express)

```javascript
export async function sessionLogin(req, res, next) {
  try {
    // STEP 1: Validate input
    const { email, password, tenantCode } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Email and password are required' }
      });
    }

    // STEP 2: Forward to Auth Service
    // We don't validate passwords ourselves - Auth Service handles that
    const authResponse = await fetch(`${authServiceUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, tenantCode }),
    });

    // STEP 3: Handle Auth Service response
    const authData = await authResponse.json();
    if (!authResponse.ok) {
      return res.status(authResponse.status).json(authData);
    }

    // STEP 4: Create session with user data
    // This data will be stored in PostgreSQL and available on subsequent requests
    const { user, accessToken, refreshToken } = authData;
    req.session.user = {
      id: user.id,
      tenantId: user.tenant.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      tenant: user.tenant,
    };
    req.session.createdAt = new Date().toISOString();
    req.session.lastAccessed = new Date().toISOString();

    // STEP 5: Save session to database
    // This is promisified because session.save() uses callbacks
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // STEP 6: Return success
    // The Set-Cookie header is automatically added by Express session middleware
    res.json({
      message: 'Login successful',
      authMethod: 'session',
      user: { ... },
      tokens: { accessToken, refreshToken }, // Also provide tokens for flexibility
    });
  } catch (error) {
    // Handle connection errors to Auth Service
    if (error.cause?.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication service is unavailable' }
      });
    }
    next(error);
  }
}
```

**Why we also return JWT tokens:** Even though session auth is being used, we return the tokens so:
- The frontend can store them as backup
- The frontend can use them for mobile app synchronization
- Provides flexibility for hybrid scenarios

---

#### `sessionLogout(req, res, next)`

**What it does:**
1. Checks if there's an active session
2. Destroys the session in PostgreSQL
3. Clears the session cookie from the browser
4. Returns success response

```javascript
export async function sessionLogout(req, res, next) {
  try {
    // Check if there's even a session to destroy
    if (!req.session || !req.session.user) {
      return res.status(200).json({ message: 'No active session' });
    }

    const userEmail = req.session.user.email;

    // Destroy session in database
    // This removes the row from user_sessions table
    await new Promise((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Clear the cookie from browser
    // Must match the cookie settings used when creating it
    res.clearCookie('iacms.sid', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    console.log(`Session destroyed for user ${userEmail}`);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
}
```

**Why clear the cookie explicitly?** While destroying the session removes server-side data, the browser still has the cookie. Clearing it ensures the browser doesn't send stale session IDs.

---

#### `sessionStatus(req, res)`

**What it does:**
1. Checks if user is authenticated via session
2. If not, checks if authenticated via JWT
3. Returns authentication status and user info

```javascript
export async function sessionStatus(req, res) {
  // Priority 1: Check session authentication
  if (req.session && req.session.user) {
    return res.json({
      authenticated: true,
      authMethod: 'session',
      user: {
        id: req.session.user.id,
        email: req.session.user.email,
        firstName: req.session.user.firstName,
        lastName: req.session.user.lastName,
        tenant: req.session.user.tenant,
      },
      session: {
        createdAt: req.session.createdAt,
        lastAccessed: req.session.lastAccessed,
      },
    });
  }

  // Priority 2: Check JWT authentication (from auth middleware)
  if (req.user && req.authMethod === 'jwt') {
    return res.json({
      authenticated: true,
      authMethod: 'jwt',
      user: {
        id: req.user.id,
        email: req.user.email,
        tenantId: req.user.tenantId,
      },
    });
  }

  // Not authenticated
  res.json({
    authenticated: false,
    authMethod: null,
    user: null,
  });
}
```

**Use case:** Frontend applications call this endpoint on page load to check if the user is logged in and restore their session state.

---

#### `sessionRefresh(req, res, next)`

**What it does:**
1. Checks if there's an active session
2. Updates the last accessed timestamp
3. Touches the session to reset expiry time

```javascript
export async function sessionRefresh(req, res, next) {
  try {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        error: { code: 'NO_SESSION', message: 'No active session to refresh' }
      });
    }

    // Update last accessed time
    req.session.lastAccessed = new Date().toISOString();

    // Touch the session - this resets the expiry timer
    await new Promise((resolve, reject) => {
      req.session.touch((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({
      message: 'Session refreshed',
      session: {
        createdAt: req.session.createdAt,
        lastAccessed: req.session.lastAccessed,
      },
    });
  } catch (error) {
    next(error);
  }
}
```

**Why refresh sessions?** Although we use rolling sessions (auto-extend on activity), this endpoint allows explicit session extension. Useful for:
- Keep-alive pings from frontend
- Extending session before a long operation
- Explicit user action to "stay logged in"

---

### `services/api-gateway/src/routes/session.routes.js`

**Purpose:** Defines the URL routes for session endpoints.

**What It Does:**

This is a simple Express Router that maps HTTP methods and paths to controller functions.

```javascript
import { Router } from 'express';
import {
  sessionLogin,
  sessionLogout,
  sessionStatus,
  sessionRefresh,
} from '../controllers/session.controller.js';

const router = Router();

// POST /api/v1/session/login - Create new session
router.post('/login', sessionLogin);

// POST /api/v1/session/logout - Destroy session
router.post('/logout', sessionLogout);

// GET /api/v1/session/status - Check authentication status
router.get('/status', sessionStatus);

// POST /api/v1/session/refresh - Extend session expiry
router.post('/refresh', sessionRefresh);

export default router;
```

**Why POST for logout and refresh?** 
- GET requests can be triggered by images, links, etc.
- POST ensures intentional action and prevents CSRF attacks
- Follows REST conventions for state-changing operations

---

### 2. Modified Files

---

### `services/api-gateway/src/middleware/auth.middleware.js`

**Purpose:** The gatekeeper that validates all incoming requests and determines if they're authenticated.

**What It Does:**

This middleware runs on every request to `/api/v1/*` and:
1. Checks if the route is public (no auth needed)
2. If not, checks for session authentication first
3. Falls back to JWT authentication
4. Sets user context headers for downstream services
5. Rejects unauthenticated requests

---

#### `authenticate(req, res, next)`

The main middleware function that handles dual authentication:

```javascript
export function authenticate(req, res, next) {
  // STEP 1: Check if this route is public
  // Public routes like /login don't need authentication
  if (isPublicRoute(req.method, req.path)) {
    return next();
  }

  // STEP 2: Check for session authentication (priority for browsers)
  // Session middleware has already loaded session from PostgreSQL
  if (req.session && req.session.user) {
    const sessionUser = req.session.user;
    
    // Attach user to request object for use in controllers/proxies
    req.user = {
      id: sessionUser.id,
      tenantId: sessionUser.tenantId,
      email: sessionUser.email,
      firstName: sessionUser.firstName,
      lastName: sessionUser.lastName,
    };
    req.authMethod = 'session';  // Track which auth method was used
    
    // Set headers for downstream microservices
    // They don't need to validate auth - they trust the Gateway
    setUserHeaders(req, req.user);
    
    // Update last accessed time (rolling session support)
    req.session.lastAccessed = new Date().toISOString();
    
    return next();
  }

  // STEP 3: Fall back to JWT authentication (for API clients)
  const token = extractBearerToken(req);
  
  if (token) {
    const result = validateJwtToken(token);
    
    if (result.valid) {
      const decoded = result.payload;
      
      req.user = {
        id: decoded.id,
        tenantId: decoded.tenantId,
        email: decoded.email,
      };
      req.authMethod = 'jwt';
      
      setUserHeaders(req, req.user);
      
      return next();
    }
    
    // Token was provided but is invalid/expired
    return res.status(401).json({
      error: { code: result.error, message: result.message }
    });
  }

  // STEP 4: No authentication provided at all
  return res.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide a valid session cookie or Bearer token.',
    },
  });
}
```

**Why session first?** Web browsers automatically send cookies with every request. By checking sessions first, browser users get seamless authentication without needing to manage tokens.

---

#### `isPublicRoute(method, path)`

Determines if a route should skip authentication:

```javascript
const PUBLIC_ROUTES = [
  { method: 'POST', path: '/auth/login' },      // Can't login if already logged in required!
  { method: 'POST', path: '/auth/register' },   // New users don't have auth yet
  { method: 'POST', path: '/auth/refresh' },    // Refresh tokens when access token expired
  { method: 'POST', path: '/session/login' },   // Session login endpoint
  { method: 'GET', path: '/tenants/validate' }, // Public tenant code validation
];

function isPublicRoute(method, path) {
  return PUBLIC_ROUTES.some(route => {
    if (route.method !== method) return false;
    return path === route.path || path.startsWith(route.path + '/');
  });
}
```

**Why these routes are public:**
- Login/register routes: Users don't have credentials yet
- Refresh: The access token has expired, so we can't validate it
- Tenant validation: Allows checking if a tenant code exists before login

---

#### `extractBearerToken(req)`

Extracts JWT from the Authorization header:

```javascript
function extractBearerToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);  // Remove "Bearer " prefix
  }
  return null;
}
```

**The Bearer scheme:** Following OAuth 2.0 conventions, tokens are sent as `Authorization: Bearer <token>`. The "Bearer" prefix indicates the type of authentication.

---

#### `validateJwtToken(token)`

Validates and decodes a JWT token:

```javascript
function validateJwtToken(token) {
  try {
    return { valid: true, payload: jwt.verify(token, JWT_SECRET) };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { 
        valid: false, 
        error: 'TOKEN_EXPIRED', 
        message: 'Authentication token has expired' 
      };
    }
    return { 
      valid: false, 
      error: 'INVALID_TOKEN', 
      message: 'Invalid authentication token' 
    };
  }
}
```

**What `jwt.verify` does:**
1. Checks the token's signature using the secret
2. Decodes the payload (user ID, tenant ID, etc.)
3. Checks if the token has expired
4. Returns the decoded payload or throws an error

---

#### `setUserHeaders(req, user)`

Sets headers that downstream microservices will use:

```javascript
function setUserHeaders(req, user) {
  req.headers['x-user-id'] = user.id;
  req.headers['x-tenant-id'] = user.tenantId;
  req.headers['x-user-email'] = user.email;
  if (user.firstName) req.headers['x-user-firstname'] = user.firstName;
  if (user.lastName) req.headers['x-user-lastname'] = user.lastName;
}
```

**Why headers instead of re-validating?** Microservices trust the API Gateway. They don't need to:
- Connect to the auth database
- Validate sessions/tokens themselves
- Know about authentication at all

This simplifies microservices and centralizes auth logic in the Gateway.

---

#### `optionalAuth(req, res, next)`

For routes where auth is optional:

```javascript
export function optionalAuth(req, res, next) {
  // Try to authenticate but don't require it
  // Same logic as authenticate() but always calls next()
  
  if (req.session && req.session.user) {
    req.user = req.session.user;
    req.authMethod = 'session';
    setUserHeaders(req, req.user);
    return next();
  }

  const token = extractBearerToken(req);
  if (token) {
    const result = validateJwtToken(token);
    if (result.valid) {
      req.user = result.payload;
      req.authMethod = 'jwt';
      setUserHeaders(req, req.user);
    }
  }

  // Continue even if not authenticated
  next();
}
```

**Use case:** Public pages that show personalized content if logged in. Example: A product page might show "Add to Cart" for guests but "Add to Wishlist" for logged-in users.

---

#### `requireAuthMethod(method)`

Factory function to enforce specific auth method:

```javascript
export function requireAuthMethod(method) {
  return (req, res, next) => {
    if (req.authMethod !== method) {
      return res.status(401).json({
        error: {
          code: 'INVALID_AUTH_METHOD',
          message: `This endpoint requires ${method} authentication`,
        },
      });
    }
    next();
  };
}

// Usage:
app.post('/api/v1/sensitive-operation', 
  authenticate, 
  requireAuthMethod('session'),  // Only session auth allowed
  sensitiveController
);
```

**Use case:** Some operations might require session auth (user is on trusted device) vs JWT (could be from any client).

---

### `services/api-gateway/src/server.js`

**Purpose:** The main entry point that wires everything together.

**Key Changes Explained:**

#### 1. New Imports

```javascript
import cookieParser from 'cookie-parser';
import { createSessionMiddleware } from './config/session.config.js';
import sessionRoutes from './routes/session.routes.js';
```

- `cookie-parser`: Parses cookies from request headers into `req.cookies`
- `createSessionMiddleware`: Our session configuration
- `sessionRoutes`: The session endpoint routes

---

#### 2. CORS Configuration

```javascript
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
  credentials: true,  // THIS IS CRITICAL
}));
```

**Why `credentials: true`?**
- By default, browsers don't send cookies in cross-origin requests
- Setting `credentials: true` allows cookies to be sent
- The frontend must also use `credentials: 'include'` in fetch calls

**Why explicit origin?**
- When using `credentials: true`, you cannot use `origin: '*'`
- You must specify the exact origin that's allowed

---

#### 3. Middleware Order

```javascript
// 1. Parse cookies from headers
app.use(cookieParser());

// 2. Request logging (with session info)
app.use((req, res, next) => {
  res.on('finish', () => {
    const sessionInfo = req.session?.user 
      ? `[Session: ${req.session.user.email}]` 
      : '[No Session]';
    console.log(`${req.method} ${req.path} ${res.statusCode} ${sessionInfo}`);
  });
  next();
});

// 3. Health check (before session to avoid unnecessary DB calls)
app.get('/health', (req, res) => { ... });

// 4. Session middleware (loads session from PostgreSQL)
const sessionMiddleware = await createSessionMiddleware();
app.use(sessionMiddleware);

// 5. Session routes (before auth middleware since /session/login is public)
app.use('/api/v1/session', express.json());
app.use('/api/v1/session', sessionRoutes);

// 6. Authentication middleware (validates session or JWT)
app.use('/api/v1', authenticate);

// 7. RBAC middleware (checks permissions)
app.use('/api/v1', rbacMiddleware);

// 8. Proxy routes to microservices
app.use('/api/v1/auth', createProxyMiddleware({ ... }));
// ... other services
```

**Why this order matters:**
1. Cookies must be parsed before session middleware can read them
2. Session middleware must run before auth middleware
3. Session routes must be mounted before auth middleware (login is public)
4. Auth middleware must run before protected routes

---

#### 4. Async Server Startup

```javascript
async function startServer() {
  // ... middleware setup
  const sessionMiddleware = await createSessionMiddleware();
  // ... rest of setup
}

startServer().catch((err) => {
  console.error('Failed to start API Gateway:', err);
  process.exit(1);
});
```

**Why async?**
- `createSessionMiddleware()` needs to create the database table
- This is an async operation that must complete before accepting requests
- If it fails, the server should not start

---

### `services/api-gateway/package.json`

**Dependencies Added:**

| Package | Version | Purpose |
|---------|---------|---------|
| `cookie-parser` | ^1.4.7 | Parses Cookie header into `req.cookies` object |
| `connect-pg-simple` | ^10.0.0 | PostgreSQL session store for express-session |
| `pg` | ^8.13.3 | PostgreSQL client for Node.js |

**Dependencies Removed:**

| Package | Reason |
|---------|--------|
| `connect-redis` | Switched to PostgreSQL for simplicity |
| `ioredis` | No longer using Redis |
| `redis` | No longer using Redis |

---

### `services/api-gateway/.env`

**Environment Variables Explained:**

```env
# Session Configuration
SESSION_SECRET=iacms-session-secret-change-in-production
```
**Purpose:** Used to sign session cookies. Anyone with this secret can forge valid session IDs.
**Security:** Must be a long, random string in production. Never commit to git.

```env
SESSION_MAX_AGE=86400
```
**Purpose:** Session lifetime in seconds (86400 = 24 hours).
**Effect:** After this time without activity, the session expires.

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/iacms
```
**Purpose:** PostgreSQL connection string for session storage.
**Format:** `postgresql://user:password@host:port/database`

```env
CORS_ORIGIN=http://localhost:5173
```
**Purpose:** The frontend URL allowed to make requests.
**Security:** Prevents other websites from making authenticated requests to your API.

---

## API Endpoints

### Session Authentication Endpoints

#### POST `/api/v1/session/login`

**Purpose:** Creates a new session for web browser authentication.

**When to use:** When a user logs in from a web browser.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "tenantCode": "TEST-ORG"
}
```

**Success Response (200):**
```json
{
  "message": "Login successful",
  "authMethod": "session",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "tenant": {
      "id": "uuid",
      "name": "Test Organization",
      "code": "TEST-ORG"
    }
  },
  "tokens": {
    "accessToken": "jwt...",
    "refreshToken": "jwt..."
  }
}
```

**Headers Set by Server:**
```
Set-Cookie: iacms.sid=s%3A...; Path=/; HttpOnly; SameSite=Lax
```

**Error Responses:**

| Status | Code | Reason |
|--------|------|--------|
| 400 | VALIDATION_ERROR | Missing email or password |
| 401 | INVALID_CREDENTIALS | Wrong email or password |
| 404 | TENANT_NOT_FOUND | Invalid tenant code |
| 503 | SERVICE_UNAVAILABLE | Auth service is down |

---

#### POST `/api/v1/session/logout`

**Purpose:** Destroys the current session and clears the cookie.

**When to use:** When a user clicks "Logout".

**Request:** No body required. Session identified by cookie.

**Success Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

**What happens:**
1. Session row deleted from `user_sessions` table
2. Cookie cleared from browser
3. Subsequent requests will be unauthenticated

---

#### GET `/api/v1/session/status`

**Purpose:** Check if the current request is authenticated and get user info.

**When to use:** On page load to check if user is logged in.

**Response (Session Auth):**
```json
{
  "authenticated": true,
  "authMethod": "session",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "tenant": { ... }
  },
  "session": {
    "createdAt": "2024-01-15T10:30:00.000Z",
    "lastAccessed": "2024-01-15T11:45:00.000Z"
  }
}
```

**Response (JWT Auth):**
```json
{
  "authenticated": true,
  "authMethod": "jwt",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "tenantId": "uuid"
  }
}
```

**Response (Not Authenticated):**
```json
{
  "authenticated": false,
  "authMethod": null,
  "user": null
}
```

---

#### POST `/api/v1/session/refresh`

**Purpose:** Explicitly extend the session expiry time.

**When to use:** 
- Keep-alive pings from frontend
- Before starting a long operation
- When user clicks "Stay logged in"

**Response (200):**
```json
{
  "message": "Session refreshed",
  "session": {
    "createdAt": "2024-01-15T10:30:00.000Z",
    "lastAccessed": "2024-01-15T12:00:00.000Z"
  }
}
```

**Error Response (401):**
```json
{
  "error": {
    "code": "NO_SESSION",
    "message": "No active session to refresh"
  }
}
```

---

## Database Schema

### `user_sessions` Table

```sql
CREATE TABLE IF NOT EXISTS "user_sessions" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");
```

**Column Details:**

| Column | Type | Description |
|--------|------|-------------|
| `sid` | VARCHAR | Session ID - A unique, cryptographically random string (e.g., `QINiDo5MgXYQv8nmI5tduWelQgGaROa-`) |
| `sess` | JSON | The session data object containing user info, cookie config, and timestamps |
| `expire` | TIMESTAMP | When this session should be considered expired |

**The `expire` index:** Allows efficient cleanup queries:
```sql
DELETE FROM user_sessions WHERE expire < NOW();
```

### Session Data Structure (`sess` column)

```json
{
  "cookie": {
    "originalMaxAge": 86400000,
    "expires": "2024-01-16T10:30:00.000Z",
    "secure": false,
    "httpOnly": true,
    "path": "/",
    "sameSite": "lax"
  },
  "user": {
    "id": "22222222-2222-2222-2222-222222222222",
    "tenantId": "11111111-1111-1111-1111-111111111111",
    "email": "admin@test-org.com",
    "firstName": "Admin",
    "lastName": "User",
    "tenant": {
      "id": "11111111-1111-1111-1111-111111111111",
      "name": "Test Organization",
      "code": "TEST-ORG"
    }
  },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "lastAccessed": "2024-01-15T11:45:00.000Z"
}
```

**Why store this in JSON?**
- Flexible schema - can add fields without migrations
- Easy to read/debug
- PostgreSQL has good JSON support

---

## Security Features

### Cookie Security

| Feature | Setting | What It Does |
|---------|---------|--------------|
| `httpOnly` | `true` | **Prevents XSS attacks.** JavaScript cannot read this cookie via `document.cookie`. Even if an attacker injects malicious JS, they can't steal the session. |
| `secure` | `true` (prod) | **Prevents MITM attacks.** Cookie only sent over HTTPS, preventing interception on insecure networks. |
| `sameSite` | `lax` | **Prevents CSRF attacks.** Cookie not sent on cross-origin requests (except top-level navigations). |
| `path` | `/` | Cookie sent for all paths on the domain. |

### Session Security

| Feature | How It Works |
|---------|--------------|
| **Signed Session IDs** | The session ID in the cookie is signed with SESSION_SECRET. If someone tampers with the cookie, the signature won't match and the session is rejected. |
| **Server-Side Storage** | User data stored in PostgreSQL, not in the cookie. Cookie only contains the session ID. Attackers can't see or modify session data. |
| **Rolling Sessions** | Expiry resets on each request. Active users stay logged in; inactive sessions expire. |
| **No Empty Sessions** | `saveUninitialized: false` - Sessions only created when data is stored. Prevents useless sessions for bots/scrapers. |

### Headers for Downstream Services

When a request is authenticated, the API Gateway sets these headers before proxying:

```
x-user-id: 22222222-2222-2222-2222-222222222222
x-tenant-id: 11111111-1111-1111-1111-111111111111
x-user-email: admin@test-org.com
x-user-firstname: Admin
x-user-lastname: User
```

**Why this matters:**
- Microservices don't need to know about sessions or JWTs
- They trust the Gateway's authentication
- Simpler microservice code
- Consistent user context across all services

---

## Usage Examples

### Web Browser (Session Auth)

```javascript
// Step 1: Login
const response = await fetch('/api/v1/session/login', {
  method: 'POST',
  credentials: 'include',  // CRITICAL: Tells browser to include cookies
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123',
    tenantCode: 'TEST-ORG'
  })
});

const data = await response.json();
// Cookie is automatically stored by browser

// Step 2: Make authenticated requests
// Cookie is automatically sent by browser
const cases = await fetch('/api/v1/cases', {
  credentials: 'include'  // Include cookies
});

// Step 3: Check session status
const status = await fetch('/api/v1/session/status', {
  credentials: 'include'
});

// Step 4: Logout
await fetch('/api/v1/session/logout', {
  method: 'POST',
  credentials: 'include'
});
```

### API Client (JWT Auth)

```javascript
// Step 1: Login and get tokens
const loginResponse = await fetch('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, tenantCode })
});
const { tokens } = await loginResponse.json();

// Store token securely (not in localStorage for web!)
const accessToken = tokens.accessToken;

// Step 2: Make authenticated requests
const cases = await fetch('/api/v1/cases', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

// Step 3: Refresh token when expired
const refreshResponse = await fetch('/api/v1/auth/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refreshToken: tokens.refreshToken })
});
const { accessToken: newToken } = await refreshResponse.json();
```

---

## Verification Commands

### Check Sessions in PostgreSQL

```bash
# List all active sessions
docker exec iacms-postgres psql -U postgres -d iacms -c "SELECT sid, expire FROM user_sessions;"

# View full session data
docker exec iacms-postgres psql -U postgres -d iacms -c "SELECT sid, sess FROM user_sessions;"

# Count active sessions
docker exec iacms-postgres psql -U postgres -d iacms -c "SELECT COUNT(*) FROM user_sessions WHERE expire > NOW();"

# Delete expired sessions
docker exec iacms-postgres psql -U postgres -d iacms -c "DELETE FROM user_sessions WHERE expire < NOW();"
```

### Test Session Login (PowerShell)

```powershell
$body = @{ 
  email = "admin@test-org.com"
  password = "password123"
  tenantCode = "TEST-ORG" 
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/v1/session/login" `
  -Method POST `
  -Body $body `
  -ContentType "application/json"
```

### Test Session Login (cURL)

```bash
# Login and save cookie
curl -X POST http://localhost:3000/api/v1/session/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test-org.com","password":"password123","tenantCode":"TEST-ORG"}' \
  -c cookies.txt \
  -v

# Check session status using saved cookie
curl http://localhost:3000/api/v1/session/status \
  -b cookies.txt

# Logout
curl -X POST http://localhost:3000/api/v1/session/logout \
  -b cookies.txt
```

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `UNAUTHORIZED` error | Cookies not being sent | Add `credentials: 'include'` to fetch requests |
| Session not persisting | CORS blocking cookies | Ensure `credentials: true` in CORS config and correct `CORS_ORIGIN` |
| `CORS error` in browser | Origin mismatch | Set `CORS_ORIGIN` to your frontend URL |
| Database auth failed | Wrong connection string | Check `DATABASE_URL` port (5433) and credentials |
| Session expires too fast | `maxAge` too low | Increase `SESSION_MAX_AGE` in .env |
| Can't logout | Cookie path mismatch | Ensure `clearCookie` uses same path as session cookie |

### Debug Session Data

```javascript
// Add to any controller or middleware to debug
console.log('Session ID:', req.sessionID);
console.log('Session:', JSON.stringify(req.session, null, 2));
console.log('Session User:', req.session?.user);
console.log('Auth Method:', req.authMethod);
console.log('Cookies:', req.cookies);
```

### Check Session in Database

```sql
-- Find session by user email
SELECT * FROM user_sessions 
WHERE sess::text LIKE '%admin@test-org.com%';

-- Check if session has expired
SELECT sid, expire, expire < NOW() as is_expired 
FROM user_sessions;
```

---

## Summary

The session-based authentication implementation provides:

| Feature | Description |
|---------|-------------|
| **Dual Authentication** | Supports both session (cookies) and JWT (tokens) simultaneously |
| **PostgreSQL Storage** | Sessions persisted in database, survives server restarts |
| **Security** | HttpOnly cookies, CSRF protection, signed sessions |
| **Rolling Sessions** | Auto-extend on activity, configurable timeout |
| **Clean API** | Simple login/logout/status/refresh endpoints |
| **Downstream Integration** | User headers set for microservices |
| **Graceful Degradation** | Falls back to JWT if no session |

This enables web browsers to use seamless cookie-based auth while API clients continue using JWT tokens, providing the best security and user experience for each client type.
