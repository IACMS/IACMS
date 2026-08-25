import { Router } from 'express';
import { validateRequest } from './queryValidator.js';
import { executeQuery } from './queryDispatcher.js';
import { executeMutation } from './mutationDispatcher.js';
import { scopeForEntity } from '../middleware/apiKeyScope.middleware.js';
import { ForbiddenError } from '../../../../shared/common/errors.js';
import crypto from 'node:crypto';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    // Must be API key authenticated
    if (!req.apiKeyContext) {
      return next(new ForbiddenError('This endpoint requires API key authentication (X-API-Key header)'));
    }

    const requestId = `req_${crypto.randomBytes(5).toString('hex')}`;
    const validated = validateRequest(req.body);

    const context = {
      tenantId: req.apiKeyContext.tenantId,
      apiKeyId: req.apiKeyContext.keyId,
      scopes: req.apiKeyContext.scopes,
      sourceIp: req.ip,
      requestId,
    };

    if (validated.type === 'query') {
      // Check scope
      const requiredScope = scopeForEntity(validated.entity, 'query');
      if (!req.apiKeyContext.scopes.some(s => s === requiredScope || s === '*')) {
        return next(new ForbiddenError(`API key lacks required scope: ${requiredScope}`));
      }
      const result = await executeQuery(validated, context);
      return res.json(result);
    }

    if (validated.type === 'mutate') {
      const result = await executeMutation(validated, context);
      return res.json(result);
    }
  } catch (error) {
    next(error);
  }
});

export { router as queryRouter };
