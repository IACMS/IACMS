import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';
import EventBus from '../../../../shared/utils/eventBus.js';
import { encryptSecrets, decryptSecrets } from '../utils/integrationCrypto.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'integration-service');

/**
 * Strip encrypted and legacy secret columns before returning a response.
 * Callers never need the raw credentials or ciphertext over the wire.
 */
function safeIntegration(integration) {
  const { apiKeyEnc, apiSecretEnc, apiKey, apiSecret, ...rest } = integration;
  return rest;
}

export async function getIntegrations(req, res, next) {
  try {
    const { tenantId, type, isActive } = req.query;
    const integrations = await prisma.integration.findMany({
      where: {
        ...(tenantId && { tenantId }),
        ...(type && { type }),
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
      },
      include: {
        tenant: true,
        creator: true,
      },
    });
    res.json({ integrations: integrations.map(safeIntegration) });
  } catch (error) {
    next(error);
  }
}

export async function getIntegration(req, res, next) {
  try {
    const integration = await prisma.integration.findUnique({
      where: { id: req.params.id },
      include: {
        tenant: true,
        creator: true,
      },
    });
    if (!integration) throw new NotFoundError('Integration');
    res.json({ integration: safeIntegration(integration) });
  } catch (error) {
    next(error);
  }
}

export async function createIntegration(req, res, next) {
  try {
    // Extract plaintext secrets from the request body and encrypt them.
    const { apiKey, apiSecret, ...rest } = req.body;
    const secrets = encryptSecrets({ apiKey, apiSecret });

    const integration = await prisma.integration.create({
      data: { ...rest, ...secrets },
      include: {
        tenant: true,
        creator: true,
      },
    });

    await eventBus.publish('integration.created', {
      integrationId: integration.id,
      tenantId: integration.tenantId,
      type: integration.type,
    });

    res.status(201).json({ integration: safeIntegration(integration) });
  } catch (error) {
    next(error);
  }
}

export async function updateIntegration(req, res, next) {
  try {
    // If caller is updating secrets, re-encrypt them.
    const { apiKey, apiSecret, ...rest } = req.body;
    const secretUpdates =
      apiKey !== undefined || apiSecret !== undefined
        ? encryptSecrets({ apiKey, apiSecret })
        : {};

    const integration = await prisma.integration.update({
      where: { id: req.params.id },
      data: { ...rest, ...secretUpdates },
    });

    await eventBus.publish('integration.updated', { integrationId: integration.id });
    res.json({ integration: safeIntegration(integration) });
  } catch (error) {
    next(error);
  }
}

export async function deleteIntegration(req, res, next) {
  try {
    await prisma.integration.delete({ where: { id: req.params.id } });
    res.json({ message: 'Integration deleted' });
  } catch (error) {
    next(error);
  }
}

export async function syncIntegration(req, res, next) {
  try {
    const integration = await prisma.integration.findUnique({
      where: { id: req.params.id },
    });
    if (!integration) throw new NotFoundError('Integration');

    // Decrypt secrets for internal use by the sync worker.
    const { apiKey, apiSecret } = decryptSecrets(integration);

    // Update sync status
    const updated = await prisma.integration.update({
      where: { id: req.params.id },
      data: {
        lastSyncAt: new Date(),
        syncStatus: { status: 'syncing', startedAt: new Date().toISOString() },
      },
    });

    await eventBus.publish('integration.sync', {
      integrationId: integration.id,
      type: integration.type,
      // Credentials passed in the event so the sync worker can use them
      // without a second DB read. The event bus must be on a secure internal
      // network — never expose these to external topics.
      ...(apiKey != null && { apiKey }),
      ...(apiSecret != null && { apiSecret }),
    });

    res.json({ message: 'Sync initiated', integration: safeIntegration(updated) });
  } catch (error) {
    next(error);
  }
}
