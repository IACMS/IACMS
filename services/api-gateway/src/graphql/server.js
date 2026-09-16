/**
 * GraphQL Server Setup
 *
 * Creates an Apollo Server 5 instance and returns an Express-compatible
 * middleware function for mounting at /api/v1/graphql.
 *
 * Apollo Server 5 removed framework-specific integrations in favour of a
 * single executeHTTPGraphQLRequest() method. This file wires that to Express
 * manually, following the official v5 migration guide.
 *
 * Authentication is handled upstream by auth.middleware.js — by the time a
 * request reaches this handler, req.apiKeyContext is already populated.
 * Requests without a valid API key are rejected before GraphQL even runs.
 *
 * Features enabled:
 *   - Schema built from typeDefs + resolvers
 *   - @requireScope directive wired into schema
 *   - Query cost + depth limiter plugin
 *   - Centralised audit logging plugin
 *   - Introspection: disabled in production (unless GRAPHQL_INTROSPECTION=true)
 *   - Apollo Sandbox landing page in development only
 */

import { ApolloServer } from '@apollo/server';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from './schema/typeDefs.js';
import { resolvers } from './resolvers/index.js';
import { requireScopeDirectiveTransformer } from './directives/requireScope.js';
import { costLimiterPlugin } from './plugins/costLimiter.plugin.js';
import { auditPlugin } from './plugins/audit.plugin.js';
import { GraphQLError } from 'graphql';
import { HeaderMap } from '@apollo/server';
import crypto from 'node:crypto';
import prisma from '../config/database.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('graphql:server');

// ─── Build Schema with Directive Transformer ──────────────────────────────────

function buildSchema() {
  const baseSchema = makeExecutableSchema({ typeDefs, resolvers });
  return requireScopeDirectiveTransformer(baseSchema);
}

// ─── Format Errors for Partners ───────────────────────────────────────────────
// Strip internal stack traces but preserve extension codes.

function formatError(formattedError, originalError) {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    const { extensions } = formattedError;
    return {
      message: formattedError.message,
      locations: formattedError.locations,
      path: formattedError.path,
      extensions: extensions
        ? {
            code: extensions.code,
            ...(extensions.requiredScope ? { requiredScope: extensions.requiredScope } : {}),
            ...(extensions.issues ? { issues: extensions.issues } : {}),
          }
        : undefined,
    };
  }
  return formattedError;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

let serverInstance = null;

/**
 * Create and start the Apollo Server, returning an Express middleware function.
 * Idempotent — safe to call multiple times (returns cached instance).
 */
export async function createGraphQLMiddleware() {
  if (serverInstance) return serverInstance.middleware;

  const introspectionEnabled =
    process.env.NODE_ENV !== 'production' ||
    process.env.GRAPHQL_INTROSPECTION === 'true';

  const schema = buildSchema();

  const server = new ApolloServer({
    schema,
    introspection: introspectionEnabled,
    formatError,
    plugins: [
      costLimiterPlugin,
      auditPlugin,
      // Disable the default landing page in production
      ...(process.env.NODE_ENV === 'production'
        ? [{ async serverWillStart() { return { async renderLandingPage() { return { html: '<h1>IACMS Partner API — GraphQL endpoint</h1>' }; } }; } }]
        : []),
    ],
  });

  await server.start();
  logger.info('GraphQL server started', { introspection: introspectionEnabled });

  /**
   * Express middleware that translates req/res into Apollo's HttpGraphQLRequest
   * and back, following the Apollo Server v5 framework integration pattern.
   */
  const middleware = async (req, res) => {
    // Gate: this endpoint is API-key only
    if (!req.apiKeyContext) {
      return res.status(403).json({
        errors: [{
          message: 'This endpoint requires API key authentication (X-API-Key header)',
          extensions: { code: 'FORBIDDEN' },
        }],
      });
    }

    const requestId = `gql_${crypto.randomBytes(5).toString('hex')}`;

    // Build context for resolvers
    const contextValue = {
      tenantId: req.apiKeyContext.tenantId,
      apiKeyId: req.apiKeyContext.keyId,
      scopes:   req.apiKeyContext.scopes,
      tenantCode: req.apiKeyContext.tenantCode,
      sourceIp:  req.ip,
      requestId,
      prisma,
    };

    // Convert Express request headers into Apollo's HeaderMap
    const headers = new HeaderMap();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value != null) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }

    // Build the search string (query params)
    const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

    try {
      const httpResponse = await server.executeHTTPGraphQLRequest({
        httpGraphQLRequest: {
          method: req.method.toUpperCase(),
          headers,
          search,
          body: req.body,
        },
        context: () => contextValue,
      });

      // Send status + headers
      res.status(httpResponse.status ?? 200);
      for (const [key, value] of httpResponse.headers) {
        res.setHeader(key, value);
      }

      // Stream body
      if (httpResponse.body.kind === 'complete') {
        res.send(httpResponse.body.string);
      } else {
        // Incremental delivery (defer/stream) — pipe chunks
        res.setHeader('Transfer-Encoding', 'chunked');
        for await (const chunk of httpResponse.body.asyncIterator) {
          res.write(chunk);
        }
        res.end();
      }
    } catch (err) {
      logger.error('GraphQL request error', { error: err.message, requestId });
      if (!res.headersSent) {
        res.status(500).json({
          errors: [{ message: 'Internal server error', extensions: { code: 'INTERNAL_ERROR' } }],
        });
      }
    }
  };

  serverInstance = { server, middleware };

  /**
   * Stop the server cleanly (called from gateway SIGTERM handler).
   */
  middleware.stop = () => server.stop();

  return middleware;
}
