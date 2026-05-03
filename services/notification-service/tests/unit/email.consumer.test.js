/**
 * Unit tests for email consumer handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/email.js', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(true),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
  sendPasswordChangedEmail: vi.fn().mockResolvedValue(true),
  sendVerificationEmail: vi.fn().mockResolvedValue(true),
  sendCaseCreatedEmail: vi.fn().mockResolvedValue(true),
  sendCaseAssignedEmail: vi.fn().mockResolvedValue(true),
  sendCaseUpdatedEmail: vi.fn().mockResolvedValue(true),
  sendWorkflowStateChangedEmail: vi.fn().mockResolvedValue(true),
  sendReferralCreatedReferrerEmail: vi.fn().mockResolvedValue(true),
  sendReferralCreatedPartnerEmail: vi.fn().mockResolvedValue(true),
  sendReferralAcceptedEmail: vi.fn().mockResolvedValue(true),
  sendReferralRejectedEmail: vi.fn().mockResolvedValue(true),
}));

const { sendWelcomeEmail, sendCaseCreatedEmail } = await import('../../src/utils/email.js');
const { handleUserCreated, handleCaseCreated } = await import('../../src/consumers/email.consumer.js');

beforeEach(() => {
  vi.clearAllMocks();
});

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
    const { temporaryPassword: _tp, ...payloadWithoutPassword } = adminPayload;
    await handleUserCreated(payloadWithoutPassword);

    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

describe('handleCaseCreated', () => {
  it('sends case created email to creator with assignee as cc when different', async () => {
    await handleCaseCreated({
      caseId: 'c1',
      tenantId: 't1',
      caseNumber: 'IAC-1',
      title: 'Test',
      tenantCode: 'ORG',
      creatorEmail: 'creator@test.gov',
      creatorFirstName: 'C',
      assigneeEmail: 'assignee@test.gov',
      assigneeFirstName: 'A',
    });

    expect(sendCaseCreatedEmail).toHaveBeenCalledOnce();
    expect(sendCaseCreatedEmail).toHaveBeenCalledWith({
      to: 'creator@test.gov',
      cc: 'assignee@test.gov',
      firstName: 'C',
      caseNumber: 'IAC-1',
      title: 'Test',
      tenantCode: 'ORG',
      caseId: 'c1',
    });
  });

  it('skips when creatorEmail missing', async () => {
    vi.mocked(sendCaseCreatedEmail).mockClear();
    await handleCaseCreated({ caseId: 'c1' });
    expect(sendCaseCreatedEmail).not.toHaveBeenCalled();
  });
});
