import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setIamIdentityActive, updateIamIdentity } from '../../src/services/iamIdentity.service.js';

const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe('gateway IAM identity client', () => {
  beforeEach(() => {
    vi.stubEnv('IAM_SERVICE_URL', 'http://iam.test');
    vi.stubEnv('INTERNAL_SERVICE_TOKEN', 'internal-test-token');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('sends only allowlisted profile fields to the internal IAM route', async () => {
    fetch.mockResolvedValue(response(200, { user: { id: 'subject-1', firstName: 'New' } }));
    await updateIamIdentity({ userId: 'subject-1', tenantId: 'tenant-1', fields: { firstName: 'New' } });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('http://iam.test/internal/identities/subject-1');
    expect(options.method).toBe('PATCH');
    expect(options.headers).toMatchObject({
      'x-internal-service-token': 'internal-test-token',
      'x-tenant-id': 'tenant-1',
    });
    expect(JSON.parse(options.body)).toEqual({ firstName: 'New' });
  });

  it('sends account deactivation to IAM', async () => {
    fetch.mockResolvedValue(response(200, { user: { id: 'subject-1', isActive: false } }));
    await setIamIdentityActive({ userId: 'subject-1', tenantId: 'tenant-1', isActive: false });
    expect(fetch.mock.calls[0][0]).toBe('http://iam.test/internal/identities/subject-1/active');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ isActive: false });
  });
});
