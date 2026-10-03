import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/notification.store.js', () => ({
  createNotification: vi.fn().mockResolvedValue({ id: 'mock-notif-1' }),
}));

import * as store from '../../src/services/notification.store.js';
import {
  handleCaseAssigned,
  handleCaseTransitioned,
  handleCaseCreated,
  handleReferralCreated,
  handleReferralAccepted,
  handleReferralRejected,
} from '../../src/consumers/case-notification.consumer.js';

describe('Case & Referral Notification Consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleCaseAssigned', () => {
    it('creates a CASE_ASSIGNED notification when assignedTo is provided', async () => {
      await handleCaseAssigned({
        caseId: 'case-1234-abcd',
        assignedTo: 'user-officer-1',
        caseNumber: 'CASE-2026-001',
        tenantId: 'tenant-1',
      });

      expect(store.createNotification).toHaveBeenCalledTimes(1);
      expect(store.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'user-officer-1',
          type: 'CASE_ASSIGNED',
          title: 'New Case Assigned',
          body: 'You have been assigned to Case #CASE-2026-001.',
          data: expect.objectContaining({
            caseId: 'case-1234-abcd',
            url: '/cases/case-1234-abcd',
          }),
        })
      );
    });

    it('ignores event if assignedTo is missing', async () => {
      await handleCaseAssigned({ caseId: 'case-1' });
      expect(store.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('handleCaseTransitioned', () => {
    it('creates a CASE_TRANSITIONED notification for assigned user', async () => {
      await handleCaseTransitioned({
        caseId: 'case-1234-abcd',
        caseNumber: 'CASE-2026-001',
        assignedTo: 'user-officer-1',
        actorId: 'user-supervisor-2',
        transitionId: 'tr-1',
      });

      expect(store.createNotification).toHaveBeenCalledTimes(1);
      expect(store.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'user-officer-1',
          type: 'CASE_TRANSITIONED',
          title: 'Case Status Updated',
          body: 'Case #CASE-2026-001 has transitioned to a new workflow stage.',
          data: expect.objectContaining({
            caseId: 'case-1234-abcd',
            url: '/cases/case-1234-abcd',
          }),
        })
      );
    });

    it('skips notification if actorId is the assigned user', async () => {
      await handleCaseTransitioned({
        caseId: 'case-1',
        assignedTo: 'user-1',
        actorId: 'user-1',
      });
      expect(store.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('handleCaseCreated', () => {
    it('creates notification if new case has an initial assignee', async () => {
      await handleCaseCreated({
        caseId: 'case-123',
        caseNumber: 'CASE-999',
        assignedTo: 'user-officer-1',
        actorId: 'user-intake-2',
      });

      expect(store.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'user-officer-1',
          type: 'CASE_ASSIGNED',
          title: 'New Case Created',
        })
      );
    });
  });

  describe('handleReferralCreated', () => {
    it('notifies assignee if referral is assigned to specific user', async () => {
      await handleReferralCreated({
        referralId: 'ref-1',
        caseId: 'case-99',
        assignedTo: 'user-partner-1',
      });

      expect(store.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'user-partner-1',
          type: 'REFERRAL_CREATED',
          title: 'Incoming Case Referral',
          data: expect.objectContaining({ url: '/referrals' }),
        })
      );
    });
  });

  describe('handleReferralAccepted', () => {
    it('notifies the user who requested the referral that it was approved', async () => {
      await handleReferralAccepted({
        referralId: 'ref-100',
        caseId: 'case-5555-6666',
        referredBy: 'user-requesting-officer',
        acceptedBy: 'user-receiving-supervisor',
      });

      expect(store.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'user-requesting-officer',
          type: 'REFERRAL_ACCEPTED',
          title: 'Referral Approved',
          body: expect.stringContaining('accepted'),
          data: expect.objectContaining({ url: '/referrals' }),
        })
      );
    });
  });

  describe('handleReferralRejected', () => {
    it('notifies the user who requested the referral that it was rejected', async () => {
      await handleReferralRejected({
        referralId: 'ref-100',
        caseId: 'case-5555-6666',
        referredBy: 'user-requesting-officer',
        rejectedBy: 'user-receiving-supervisor',
      });

      expect(store.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'user-requesting-officer',
          type: 'REFERRAL_REJECTED',
          title: 'Referral Rejected',
          body: expect.stringContaining('rejected'),
          data: expect.objectContaining({ url: '/referrals' }),
        })
      );
    });
  });
});
