/**
 * prisma.adapter.js
 * node-oidc-provider Adapter backed by the `oidc_payloads` Prisma model.
 *
 * Implements all 7 required methods:
 *   upsert, find, findByUserCode, findByUid, destroy, revokeByGrantId, consume
 *
 * Key correctness constraint (from the definitive plan):
 *   consume() MUST be atomic — use prisma.$executeRaw so the UPDATE only
 *   touches rows where consumed_at IS NULL, preventing double-spend.
 */

import prisma from '../config/database.js';

export class PrismaAdapter {
  /**
   * @param {string} name  — model name as passed by the library
   *   e.g. 'Session', 'Grant', 'AuthorizationCode', 'AccessToken', 'RefreshToken',
   *        'DeviceCode', 'Interaction', 'ReplayDetection',
   *        'PushedAuthorizationRequest', 'BackchannelAuthenticationRequest'
   */
  constructor(name) {
    this.name = name;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Map a DB row back to the shape the library expects. */
  static #toResult(row) {
    if (!row) return undefined;
    return {
      ...row.payload,
      ...(row.consumedAt ? { consumed: Math.floor(row.consumedAt.getTime() / 1000) } : {}),
    };
  }

  // ── Adapter methods ───────────────────────────────────────────────────────

  /**
   * Insert or replace a record.
   * The library calls this for every token / artefact creation.
   */
  async upsert(id, payload, expiresIn) {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

    await prisma.oidcPayload.upsert({
      where: { id },
      create: {
        id,
        modelName: this.name,
        payload,
        grantId: payload.grantId ?? null,
        userCode: payload.userCode ?? null,
        uid: payload.uid ?? null,
        expiresAt,
      },
      update: {
        payload,
        grantId: payload.grantId ?? null,
        userCode: payload.userCode ?? null,
        uid: payload.uid ?? null,
        expiresAt,
      },
    });
  }

  /** Find by primary key (id). Returns undefined when not found or expired. */
  async find(id) {
    const row = await prisma.oidcPayload.findFirst({
      where: {
        id,
        modelName: this.name,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return PrismaAdapter.#toResult(row);
  }

  /** Find a DeviceCode by its user-facing code. */
  async findByUserCode(userCode) {
    const row = await prisma.oidcPayload.findFirst({
      where: {
        userCode,
        modelName: this.name,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return PrismaAdapter.#toResult(row);
  }

  /** Find a Session by its uid. */
  async findByUid(uid) {
    const row = await prisma.oidcPayload.findFirst({
      where: {
        uid,
        modelName: this.name,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return PrismaAdapter.#toResult(row);
  }

  /**
   * Mark a token/code as consumed (one-time use).
   * MUST be atomic — only set consumed_at if it is currently NULL.
   * Using $executeRaw ensures the UPDATE is a single DB round-trip and
   * avoids the read-modify-write race that prisma.update() would introduce.
   */
  async consume(id) {
    await prisma.$executeRaw`
      UPDATE oidc_payloads
      SET    consumed_at = NOW()
      WHERE  id          = ${id}
        AND  model_name  = ${this.name}
        AND  consumed_at IS NULL
    `;
  }

  /** Hard-delete a single record. */
  async destroy(id) {
    await prisma.oidcPayload.deleteMany({
      where: { id, modelName: this.name },
    });
  }

  /**
   * Cascade-delete all artefacts belonging to a grant.
   * Called when a Grant is revoked (e.g. user revokes a client's access).
   */
  async revokeByGrantId(grantId) {
    await prisma.oidcPayload.deleteMany({
      where: { grantId },
    });
  }
}
