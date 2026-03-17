/**
 * Unit tests for email consumer handlers.
 *
 * The only logic worth testing is the handleUserCreated discriminator —
 * it must send a welcome email for admin-created users only.
 * The other two handlers are straight pass-throughs with no branching.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock the email utility before importing the consumer
vi.mock('../../src/utils/email.js', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(true),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
  sendPasswordChangedEmail: vi.fn().mockResolvedValue(true),
}));

const { sendWelcomeEmail } = await import('../../src/utils/email.js');
const { handleUserCreated } = await import('../../src/consumers/email.consumer.js');

// ── handleUserCreated discriminator ──────────────────────────────────────────
describe('handleUserCreated', () => {
  const adminPayload = {
    userId: 'u1',
    email: 'new@test-org.com',
    firstName: 'New',
    tenantName: 'Test Org',
    tenantCode: 'TEST-ORG',
    temporaryPassword: 'Temp1234!',
    source: 'admin',
  };

  it('sends welcome email when source is admin and temporaryPassword is present', async () => {
    await handleUserCreated(adminPayload);

    expect(sendWelcomeEmail).toHaveBeenCalledOnce();
    expect(sendWelcomeEmail).toHaveBeenCalledWith({
      to: adminPayload.email,
      firstName: adminPayload.firstName,
      tenantName: adminPayload.tenantName,
      temporaryPassword: adminPayload.temporaryPassword,
    });
  });

  it('does NOT send welcome email when source is register', async () => {
    await handleUserCreated({ ...adminPayload, source: 'register' });

    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('does NOT send welcome email when source is admin but temporaryPassword is missing', async () => {
    const { temporaryPassword, ...payloadWithoutPassword } = adminPayload;
    await handleUserCreated(payloadWithoutPassword);

    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });
});
