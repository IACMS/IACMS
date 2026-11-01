/**
 * interaction.routes.js
 * Mounts the OIDC interaction endpoints.
 * Registered in server.js AFTER the OIDC provider middleware.
 */

import express, { Router } from 'express';
import {
  getInteraction,
  postLogin,
  postConsent,
  abortInteraction,
} from './interaction.controller.js';

const router = Router();

// Body parsers for interaction endpoints (form submissions & JSON SPAs)
router.use(express.urlencoded({ extended: true }));
router.use(express.json());

// GET  /oauth/interaction/:uid        — render login/consent page (or JSON for SPAs)
router.get('/:uid', getInteraction);

// POST /oauth/interaction/:uid/login  — submit credentials
router.post('/:uid/login', postLogin);

// POST /oauth/interaction/:uid/confirm — grant consent
router.post('/:uid/confirm', postConsent);

// GET  /oauth/interaction/:uid/abort  — user cancelled
router.get('/:uid/abort', abortInteraction);

export default router;
