/**
 * Unit tests — password and verification email handlers.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/utils/email.js', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(true),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
  sendPasswordChangedEmail: vi.fn().mockResolvedValue(true),
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
}));

const {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendVerificationEmail,
} = await import('../../src/utils/email.js');

const {
  handlePasswordResetRequested,
  handlePasswordChanged,
  handleEmailVerificationRequested,
} = await import('../../src/consumers/email.consumer.js');

describe('handlePasswordResetRequested', () => {
  it('dispatches reset email with token', async () => {
    await handlePasswordResetRequested({
      email: 'a@b.c',
      firstName: 'A',
      resetToken: 'tok',
      tenantCode: 'ORG',
    });
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({
      to: 'a@b.c',
      firstName: 'A',
      resetToken: 'tok',
      tenantCode: 'ORG',
    });
  });
});

describe('handlePasswordChanged', () => {
  it('dispatches confirmation email', async () => {
    await handlePasswordChanged({ email: 'a@b.c', firstName: 'A' });
    expect(sendPasswordChangedEmail).toHaveBeenCalledWith({
      to: 'a@b.c',
      firstName: 'A',
    });
  });
});

describe('handleEmailVerificationRequested', () => {
  it('dispatches verification email', async () => {
    await handleEmailVerificationRequested({
      userId: 'u1',
      email: 'a@b.c',
      firstName: 'A',
      verificationToken: 'vtok',
      tenantCode: 'ORG',
    });
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      to: 'a@b.c',
      firstName: 'A',
      verificationToken: 'vtok',
      tenantCode: 'ORG',
    });
  });
});
