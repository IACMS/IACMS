import crypto from 'node:crypto';
import prisma from '../config/database.js';
import { UnauthorizedError } from '../../../../shared/common/errors.js';
import logger from '../../../../shared/common/logger.js';

/**
 * Generate a new API key for a tenant
 */
export async function generateApiKey(tenantId, name, scopes, expiresAt, createdBy) {
  const rawBytes = crypto.randomBytes(32).toString('hex');
  const rawKey = `iacms_live_${rawBytes}`;
  
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 20);
  
  const apiKey = await prisma.apiKey.create({
    data: {
      tenantId,
      name,
      scopes,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdBy,
      keyHash,
      keyPrefix,
      isActive: true,
    }
  });
  
  return {
    rawKey,
    keyId: apiKey.id,
    keyPrefix: apiKey.keyPrefix,
    name: apiKey.name,
    scopes: apiKey.scopes
  };
}

/**
 * Validate an API key
 */
export async function validateApiKey(rawKey, ip) {
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { tenant: true }
  });
  
  if (!apiKey) {
    throw new UnauthorizedError('Invalid API key');
  }
  
  if (!apiKey.isActive) {
    throw new UnauthorizedError('API key is revoked or inactive');
  }
  
  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
    throw new UnauthorizedError('API key has expired');
  }
  
  if (!apiKey.tenant || !apiKey.tenant.isActive) {
    throw new UnauthorizedError('Tenant is inactive');
  }
  
  // Update last used info asynchronously without waiting
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data: {
      lastUsedAt: new Date(),
      lastUsedIp: ip
    }
  }).catch(err => logger.error('Failed to update API key last usage', { error: err.message, keyId: apiKey.id }));
  
  return {
    tenantId: apiKey.tenantId,
    scopes: apiKey.scopes,
    keyId: apiKey.id,
    keyName: apiKey.name,
    tenantCode: apiKey.tenant.code
  };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(keyId, tenantId, revokedBy) {
  // First verify the key belongs to the tenant
  const key = await prisma.apiKey.findUnique({
    where: { id: keyId }
  });
  
  if (!key || key.tenantId !== tenantId) {
    throw new Error('API key not found');
  }
  
  return prisma.apiKey.update({
    where: { id: keyId },
    data: {
      isActive: false,
      revokedAt: new Date(),
      revokedBy
    }
  });
}

/**
 * Rotate an API key
 */
export async function rotateApiKey(keyId, tenantId, rotatedBy) {
  const existingKey = await prisma.apiKey.findUnique({
    where: { id: keyId }
  });
  
  if (!existingKey || existingKey.tenantId !== tenantId) {
    throw new Error('API key not found');
  }
  
  await revokeApiKey(keyId, tenantId, rotatedBy);
  
  return generateApiKey(
    tenantId,
    existingKey.name,
    existingKey.scopes,
    existingKey.expiresAt,
    rotatedBy
  );
}

/**
 * List API keys for a tenant
 */
export async function listApiKeys(tenantId) {
  return prisma.apiKey.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      isActive: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
      revokedAt: true
    },
    orderBy: { createdAt: 'desc' }
  });
}
