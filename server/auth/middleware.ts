/** Authentication and authorization middleware.
 *
 *  This is the file the whole project has been pointing at. Until now the
 *  permission matrix only decided which buttons rendered, which is not a security
 *  control — a hidden button is not a check. Here the same matrix, imported from
 *  the same module the UI uses, decides whether a request is allowed to proceed. */

import type { NextFunction, Request, Response } from 'express';
import { hasPermission } from '../../src/lib/permissions';
import type { Permission } from '../../src/lib/types';
import { readSession, type SessionUser } from './sessions';
import { forbidden, unauthorized } from '../http/errors';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Never populated from anything the client sends. */
      user?: SessionUser;
    }
  }
}

/** Attaches the caller if there is a valid session, without requiring one. */
export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.user = (await readSession(req)) ?? undefined;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user ?? (await readSession(req)) ?? undefined;
    if (!user) return next(unauthorized());
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/** Gate a route on a permission from the shared matrix.
 *
 *  The role comes from the session row, never from the request — the old mock
 *  API accepted an `actorId` query parameter, and that would be an impersonation
 *  hole the moment it met a real database. */
export function requirePermission(permission: Permission) {
  return async function check(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user ?? (await readSession(req)) ?? undefined;
      if (!user) return next(unauthorized());
      req.user = user;

      if (!hasPermission(user, permission)) {
        return next(forbidden(`Your role (${user.role}) cannot ${describe(permission)}.`));
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

const DESCRIPTIONS: Record<Permission, string> = {
  'view:contact-details': 'view contact details',
  'edit:resources': 'edit resources',
  'assign:resources': 'assign resources',
  'import:records': 'import records in bulk',
  'export:data': 'export data',
  'manage:credential-refs': 'manage credential references',
  'request:credential-access': 'request credential access',
  'archive:records': 'archive records',
  'manage:users': 'manage user accounts',
  'access:domains': 'open Domains',
  'access:import': 'open Import',
  'access:credential-refs': 'open Credential Refs',
  'access:roles-audit': 'open Roles & Audit',
};

function describe(permission: Permission): string {
  return DESCRIPTIONS[permission] ?? permission;
}
