import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { AppError, UnauthorizedError } from '../../../../shared/common/errors.js';
import {
  generateApiKey,
  validateApiKey,
  resolveApiKeyOwner,
  revokeApiKey,
  rotateApiKey,
  listApiKeys,
} from '../../src/services/apiKey.service.js';

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

describe('apiKey.service IAM boundary', () => {
  beforeEach(() => {
    vi.stubEnv('IAM_SERVICE_URL', 'http://iam.test');
    vi.stubEnv('INTERNAL_SERVICE_TOKEN', 'test-internal-token');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('creates keys through IAM and forwards tenant/user context', async () => {
    fetch.mockResolvedValue(response(201, {
      apiKey: { id: 'key-123', keyPrefix: 'iacms_live_mock', name: 'test key', scopes: ['cases:read'] },
      rawKey: 'iacms_live_once',
    }));

    const result = await generateApiKey('tenant-1', 'test key', ['cases:read'], null, 'user-1');
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://iam.test/api-keys');
    expect(options.method).toBe('POST');
    expect(options.headers).toMatchObject({
      'x-internal-service-token': 'test-internal-token',
      'x-tenant-id': 'tenant-1',
      'x-user-id': 'user-1',
    });
    expect(JSON.parse(options.body)).toEqual({ name: 'test key', scopes: ['cases:read'], expiresAt: null });
    expect(result).toMatchObject({ keyId: 'key-123', rawKey: 'iacms_live_once', keyPrefix: 'iacms_live_mock' });
  });

  it('sends only the key hash for validation and returns the key owner context', async () => {
    fetch.mockResolvedValue(response(200, {
      apiKey: {
        id: 'key-123', tenantId: 'tenant-1', tenantCode: 'TN1',
        name: 'test key', scopes: ['cases:read'], createdBy: 'user-1',
      },
    }));

    const result = await validateApiKey('iacms_live_testkey', '127.0.0.1');
    const expectedHash = crypto.createHash('sha256').update('iacms_live_testkey').digest('hex');
    expect(fetch.mock.calls[0][0]).toBe('http://iam.test/api-keys/validate');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ keyHash: expectedHash, ip: '127.0.0.1' });
    expect(JSON.stringify(fetch.mock.calls[0][1].body)).not.toContain('iacms_live_testkey');
    expect(result).toMatchObject({ tenantId: 'tenant-1', tenantCode: 'TN1', keyId: 'key-123', createdBy: 'user-1' });
  });

  it('maps IAM invalid-key responses to UnauthorizedError', async () => {
    fetch.mockResolvedValue(response(401, { error: { message: 'Invalid API key' } }));
    await expect(validateApiKey('iacms_live_bad', '127.0.0.1')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('maps IAM connectivity failures to a service-unavailable error', async () => {
    fetch.mockRejectedValue(new Error('connection refused'));
    await expect(validateApiKey('iacms_live_test', '127.0.0.1')).rejects.toMatchObject({
      statusCode: 503,
      code: 'IAM_UNAVAILABLE',
    });
  });

  it('revokes through IAM with the caller identity', async () => {
    fetch.mockResolvedValue(response(200, { message: 'API key revoked successfully.' }));
    await revokeApiKey('key-123', 'tenant-1', 'user-1');
    expect(fetch.mock.calls[0][0]).toBe('http://iam.test/api-keys/key-123');
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');
    expect(fetch.mock.calls[0][1].headers['x-user-id']).toBe('user-1');
  });

  it('rotates through IAM and maps the one-time replacement key', async () => {
    fetch.mockResolvedValue(response(200, {
      apiKey: { id: 'key-124', name: 'test key', keyPrefix: 'iacms_live_new', scopes: ['cases:read'] },
      rawKey: 'iacms_live_new_secret',
    }));
    const result = await rotateApiKey('key-123', 'tenant-1', 'user-1');
    expect(fetch.mock.calls[0][0]).toBe('http://iam.test/api-keys/key-123/rotate');
    expect(result).toMatchObject({ keyId: 'key-124', rawKey: 'iacms_live_new_secret', scopes: ['cases:read'] });
  });

  it('lists tenant keys without adding IAM-only fields to the gateway response', async () => {
    fetch.mockResolvedValue(response(200, { apiKeys: [{
      id: 'key-123', tenantId: 'tenant-1', name: 'test key', keyPrefix: 'iacms_live_x',
      scopes: ['cases:read'], isActive: true, lastUsedIp: '127.0.0.1', metadata: { private: true },
    }] }));
    const result = await listApiKeys('tenant-1', 'user-1');
    expect(result).toEqual([expect.objectContaining({ id: 'key-123', name: 'test key' })]);
    expect(result[0]).not.toHaveProperty('metadata');
    expect(fetch.mock.calls[0][1].headers['x-tenant-id']).toBe('tenant-1');
  });

  it('resolves an API-key owner for an older bearer token through IAM', async () => {
    fetch.mockResolvedValue(response(200, { apiKeyContext: { createdBy: 'user-1' } }));
    await expect(resolveApiKeyOwner('key-123', 'tenant-1')).resolves.toBe('user-1');
    expect(fetch.mock.calls[0][0]).toBe('http://iam.test/api-keys/internal/resolve-owner');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ apiKeyId: 'key-123', tenantId: 'tenant-1' });
  });

  it('fails closed when the internal IAM token is missing', async () => {
    vi.stubEnv('INTERNAL_SERVICE_TOKEN', '');
    await expect(listApiKeys('tenant-1', 'user-1')).rejects.toBeInstanceOf(AppError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
