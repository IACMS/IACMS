import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const jose = await import('jose');
  const keyPair = await jose.generateKeyPair('RS256', { extractable: true });
  const privJwk = await jose.exportJWK(keyPair.privateKey);
  const jwks = {
    keys: [
      {
        ...privJwk,
        use: 'sig',
        alg: 'RS256',
        kid: 'iacms-1'
      }
    ]
  };

  const clientSecretKey = crypto.randomBytes(32).toString('hex');
  const cookieSecret = crypto.randomBytes(32).toString('base64');
  const jwtSecret = 'change-this-secret-key-in-production-use-openssl-rand-base64-32';
  const internalToken = 'iacms-internal-service-token-dev';

  const jwksJson = JSON.stringify(jwks);

  const envContent = `# IAM Service Environment Variables
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/iacms?schema=public
IAM_IDENTITY_OUTBOX_ENABLED=false
IAM_IDENTITY_EVENTS_TOPIC=iam.identity.events.v1
IAM_IDENTITY_OUTBOX_POLL_MS=2000
IAM_ORG_MEMBERSHIPS_ENABLED=true
IAM_LEGACY_ORGANIZATION_SYSTEM=iacms

# Legacy Internal JWT / Internal service auth
JWT_SECRET=${jwtSecret}
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d
INTERNAL_SERVICE_TOKEN=${internalToken}

# Redis
REDIS_URL=redis://localhost:6379

# OAuth2 / OIDC (node-oidc-provider)
OIDC_ISSUER=http://localhost:3001
OIDC_DEFAULT_RESOURCE=
OIDC_SUPPORTED_SCOPES=openid offline_access profile email roles api_key iam:admin
OIDC_RESOURCE_SCOPES=openid profile email roles api_key iam:admin
IAM_GLOBAL_IDENTITIES_ENABLED=false

OIDC_COOKIE_SECRET=${cookieSecret}
CLIENT_SECRET_KEY=${clientSecretKey}
OIDC_JWKS_JSON=${jwksJson}
`;

  const envPath = path.join(__dirname, '..', '.env');
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log('Successfully wrote .env to', envPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
