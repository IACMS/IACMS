import express from 'express';
import {
  getPlatformDashboard,
  listPlatformUsers,
  createPlatformUser,
  updatePlatformUser,
  deletePlatformUser,
  getTenantPlatformStats,
  setTenantStatus,
  deleteTenant,

  getPlatformSettings,
  updatePlatformSettings,
  getFeatureFlags,
  setFeatureFlag,
  listAnnouncements,
  getActiveAnnouncements,
  createAnnouncement,
  deleteAnnouncement,
  listSupportTickets,
  createSupportTicket,
  updateSupportTicket,
  getAllTenantQuotas,
  getTenantQuota,
  updateTenantQuota,
  getPendingAgencies,
  approveAgency,
  declineAgency,
} from '../controllers/platform.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

const router = express.Router();

// All platform routes require authentication
router.use(authenticateToken);

// ── Dashboard ──────────────────────────────────────────────────────────────
router.get('/dashboard', getPlatformDashboard);

// ── Platform Users (super-admins) ─────────────────────────────────────────
router.get('/users', listPlatformUsers);
router.post('/users', createPlatformUser);
router.patch('/users/:userId', updatePlatformUser);
router.delete('/users/:userId', deletePlatformUser);

// ── Tenant / Agency Management ────────────────────────────────────────────
router.get('/tenants/:tenantId/stats', getTenantPlatformStats);
router.patch('/tenants/:tenantId/status', setTenantStatus);
router.delete('/tenants/:tenantId', deleteTenant);



// ── Global Settings ───────────────────────────────────────────────────────
router.get('/settings', getPlatformSettings);
router.patch('/settings', updatePlatformSettings);

// ── Feature Flags ─────────────────────────────────────────────────────────
router.get('/feature-flags', getFeatureFlags);
router.post('/feature-flags', setFeatureFlag);

// ── Announcements ─────────────────────────────────────────────────────────
router.get('/announcements', listAnnouncements);
router.get('/announcements/active', getActiveAnnouncements);
router.post('/announcements', createAnnouncement);
router.delete('/announcements/:id', deleteAnnouncement);

// ── Pending Agencies ──────────────────────────────────────────────────────
router.get('/agencies/pending', getPendingAgencies);
router.post('/agencies/:id/approve', approveAgency);
router.post('/agencies/:id/decline', declineAgency);

// ── Support Tickets ───────────────────────────────────────────────────────
router.get('/support-tickets', listSupportTickets);
router.post('/support-tickets', createSupportTicket);
router.patch('/support-tickets/:id', updateSupportTicket);

// ── Resource Quotas ───────────────────────────────────────────────────────
router.get('/quotas', getAllTenantQuotas);
router.get('/tenants/:tenantId/quota', getTenantQuota);
router.patch('/tenants/:tenantId/quota', updateTenantQuota);

export default router;
