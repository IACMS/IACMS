/**
 * Session Configuration for API Gateway
 * Uses PostgreSQL as the session store for persistence
 */

import session from 'express-session';
import pgSession from 'connect-pg-simple';
import pg from 'pg';

// Database configuration
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/iacms';

// Create PostgreSQL connection pool
const pool = new pg.Pool({
  connectionString: databaseUrl,
});

// Create the PostgreSQL session store
const PgStore = pgSession(session);

/**
 * Create session middleware with PostgreSQL store
 */
export async function createSessionMiddleware() {
  // Create sessions table if it doesn't exist
  await createSessionTable();

  // Create PostgreSQL store
  const pgStore = new PgStore({
    pool: pool,
    tableName: 'user_sessions', // Custom table name
    createTableIfMissing: true, // Auto-create table
  });

  // Session configuration
  const sessionConfig = {
    store: pgStore,
    secret: process.env.SESSION_SECRET || 'iacms-session-secret-change-in-production',
    name: 'iacms.sid', // Custom cookie name
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something stored
    rolling: true, // Reset expiration on each request
    cookie: {
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      httpOnly: true, // Prevent client-side JS access
      maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400', 10) * 1000, // Convert to milliseconds
      sameSite: 'lax', // CSRF protection
      path: '/',
    },
  };

  // In development, allow non-HTTPS cookies
  if (process.env.NODE_ENV !== 'production') {
    sessionConfig.cookie.secure = false;
  }

  console.log('Session store: PostgreSQL connected');
  
  return session(sessionConfig);
}

/**
 * Create the sessions table if it doesn't exist
 */
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
  
  try {
    await pool.query(createTableSQL);
  } catch (error) {
    console.error('Failed to create sessions table:', error.message);
  }
}

/**
 * Get the database pool (for manual operations if needed)
 */
export function getPool() {
  return pool;
}

/**
 * Gracefully close database connection
 */
export async function closeSessionStore() {
  await pool.end();
  console.log('Session store: PostgreSQL connection closed');
}

export default createSessionMiddleware;
