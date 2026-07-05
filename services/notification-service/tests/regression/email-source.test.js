/**
 * Regression — email consumer source discriminator (notification handlers).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/email.js', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(true),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
  sendPasswordChangedEmail: vi.fn().mockResolvedValue(true),
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
}));

const { sendWelcomeEmail } = await import('../../src/utils/email.js');
const { handleUserCreated } = await import('../../src/consumers/email.consumer.js');

describe('Notification regression — welcome email eligibility', () => {
  const base = {
    userId: 'u1',
    email: 'x@test.gov.example',
    firstName: 'X',
    tenantName: 'Org',
    tenantCode: 'ORG',
    temporaryPassword: 'Temp1!',
  };

  it('never sends welcome on self-service register', async () => {
    await handleUserCreated({ ...base, source: 'register' });
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });
});
