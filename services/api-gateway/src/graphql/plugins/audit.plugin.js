/**
 * Audit Logging Plugin
 *
 * An Apollo Server plugin that writes an audit record for every completed
 * GraphQL operation. This centralises audit logging that was previously
 * done per-query in queryDispatcher.js and per-mutation in mutationDispatcher.js.
 *
 * The record is written AFTER the response is prepared (willSendResponse),
 * so it never blocks query execution. Write failures are swallowed and logged,
 * matching the existing auditWriter.js "non-blocking" policy.
 */
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('graphql:audit');

export const auditPlugin = {
  async requestDidStart() {
    const startTime = Date.now();

    return {
      async willSendResponse({ contextValue, response, operation, request }) {
        // Only audit API-key authenticated requests
        const ctx = contextValue;
        if (!ctx?.apiKeyId || !ctx?.tenantId) return;

        const executionTimeMs = Date.now() - startTime;
        const operationType = operation?.operation ?? 'unknown';
        const operationName = request?.operationName ?? null;

        // Sanitise variables — remove any field that looks like a secret
        const rawVars = request?.variables ?? {};
        const sanitisedVars = sanitiseVariables(rawVars);

        try {
          await ctx.prisma.auditOutbox.create({
            data: {
              tenantId: ctx.tenantId,
              payload: {
                source: 'partner_api_graphql',
                apiKeyId: ctx.apiKeyId,
                operation: operationType,
                operationName,
                variables: sanitisedVars,
                requestId: ctx.requestId,
                sourceIp: ctx.sourceIp,
                executionTimeMs,
                timestamp: new Date().toISOString(),
              },
            },
          });
        } catch (err) {
          logger.error('GraphQL audit write failed', {
            error: err.message,
            requestId: ctx.requestId,
          });
        }
      },
    };
  },
};

const SENSITIVE_KEYS = new Set([
  'password', 'secret', 'token', 'apiKey', 'key', 'hash', 'credential',
]);

function sanitiseVariables(vars) {
  if (!vars || typeof vars !== 'object') return vars;
  const out = {};
  for (const [k, v] of Object.entries(vars)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitiseVariables(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
