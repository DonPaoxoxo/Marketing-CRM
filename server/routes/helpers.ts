/** Pieces every register route needs.
 *
 *  The mock accepted an `actorId` query parameter and fell back to a
 *  client-claimed identity when it did not recognise one. That was honest about
 *  being unverified, and it is exactly the hole this file closes: here the actor
 *  is the session row, and a request cannot say who sent it. */

import type { Request } from 'express';
import type { RoleName } from '../../src/lib/types';
import { hasPermission } from '../../src/lib/permissions';
import { badRequest, forbidden, unauthorized } from '../http/errors';

export interface Actor { id: string; name: string; role: RoleName }

/** The authenticated caller, for attribution.
 *
 *  Routes are already behind `requirePermission`, so reaching here without a
 *  user would mean the middleware was skipped — throw rather than attribute the
 *  change to nobody. */
export function actorOf(req: Request): Actor {
  const user = req.user;
  if (!user) throw unauthorized();
  return { id: user.id, name: user.name, role: user.role };
}

export const nowDate = (): Date => new Date();
export const today = (): string => new Date().toISOString().slice(0, 10);

/** MySQL's duplicate-key error, so a race between two writers that both passed
 *  the pre-check surfaces as the same conflict message the pre-check would have
 *  given rather than as an unhandled 500. */
export function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ER_DUP_ENTRY';
}

/** Body parsing that does not assume the client sent an object. */
export function bodyOf<T extends object>(req: Request): T {
  const body: unknown = req.body;
  return (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as T;
}

/** Archiving is the destructive action this system has, so it carries its own
 *  permission and needs a written reason.
 *
 *  Register edits are gated on `edit:resources`, which several roles hold; a
 *  request that also flips `archived` has to clear the higher bar separately,
 *  rather than arriving as one more field in an ordinary save. */
export function assertMayArchive(
  req: Request,
  patch: { archived?: unknown },
  reason: string | undefined,
): void {
  if (patch.archived !== true) return;

  const user = req.user;
  if (!user) throw unauthorized();
  if (!hasPermission(user, 'archive:records')) {
    throw forbidden(`Your role (${user.role}) cannot archive records.`);
  }
  if (!reason?.trim()) {
    throw badRequest('Archiving needs a written reason.', { field: 'reason' });
  }
}
