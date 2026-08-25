import express from 'express';
import { generateApiKey, listApiKeys, revokeApiKey, rotateApiKey } from '../services/apiKey.service.js';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { name, scopes, expiresAt } = req.body;
    const tenantId = req.user.tenantId;
    const createdBy = req.user.id;
    
    const result = await generateApiKey(tenantId, name, scopes, expiresAt, createdBy);
    
    res.status(201).json({
      apiKey: {
        id: result.keyId,
        name,
        keyPrefix: result.keyPrefix,
        rawKey: result.rawKey,
        scopes,
        expiresAt
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    const apiKeys = await listApiKeys(tenantId);
    
    res.json({ apiKeys });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const keyId = req.params.id;
    const tenantId = req.user.tenantId;
    const revokedBy = req.user.id;
    
    await revokeApiKey(keyId, tenantId, revokedBy);
    
    res.json({ message: 'API key revoked' });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/rotate', async (req, res, next) => {
  try {
    const keyId = req.params.id;
    const tenantId = req.user.tenantId;
    const rotatedBy = req.user.id;
    
    const result = await rotateApiKey(keyId, tenantId, rotatedBy);
    
    res.status(200).json({
      apiKey: {
        id: result.keyId,
        name: result.name,
        keyPrefix: result.keyPrefix,
        rawKey: result.rawKey,
        scopes: result.scopes
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
