/** Express app factory, kept separate from the listener so tests can mount it
 *  without binding a port. */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './env';
import { errorHandler, notFoundHandler } from './http/errors';
import { loadUser } from './auth/middleware';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { simsRouter } from './routes/sims';
import { agentsRouter } from './routes/agents';
import { socialAccountsRouter } from './routes/social-accounts';
import { domainsRouter } from './routes/domains';
import { pakistanCompetitorsRouter } from './routes/pakistan-competitors';
import { assignmentsRouter } from './routes/assignments';
import { credentialsRouter } from './routes/credentials';
import { growthRouter } from './routes/growth';
import { importRouter } from './routes/import';
import { agentProofsRouter } from './routes/agent-proofs';
import { teamReportsRouter } from './routes/team-reports';
import { adsRouter } from './routes/ads';
import { sharedSpielRouter } from './routes/spiels';
import { notificationsRouter } from './routes/notifications';
import { permissionsRouter } from './routes/permissions';
import { auditRouter } from './routes/audit';
import { requireAuth } from './auth/middleware';
import { asyncHandler } from './http/errors';
import { loadBootstrap } from './repositories/bootstrap';
import { checkConnection } from './db/pool';

/** The built browser app, as `npm run build` leaves it. */
export const DEFAULT_STATIC_DIR = fileURLToPath(new URL('../dist', import.meta.url));

export interface AppOptions {
  /** Serve the built browser app from here, or `null` for API only.
   *  Defaults to `dist/` in production and to nothing in development, where Vite
   *  serves the app and a stale `dist/` from an old build would only confuse. */
  staticDir?: string | null;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const staticDir = options.staticDir === undefined
    ? (env.isProduction ? DEFAULT_STATIC_DIR : null)
    : options.staticDir;

  // Behind aaPanel's nginx (and on the live site, Cloudflare before that), so
  // req.ip must come from X-Forwarded-For rather than a proxy's own address —
  // otherwise every rate limit is shared by everyone. See TRUST_PROXY in env.ts.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  // On every response, API and pages alike. The meta tags in index.html only
  // reach crawlers that parse HTML; this also covers JSON, assets and the
  // sign-in page. It is a request to crawlers, not access control — that is
  // what the session check is for.
  app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
    next();
  });

  app.use(
    helmet({
      // The API serves JSON, not documents; the browser app carries its own CSP.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'same-origin' },
    }),
  );

  // Bodies are small records. A low cap is a cheap guard against a request that
  // is trying to exhaust memory rather than save a SIM.
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // API responses are per-person and often carry register data. Nothing between
  // the browser and here — Cloudflare, a corporate proxy, the browser's own
  // back/forward cache — may keep a copy. Without this, a cache rule added later
  // for performance could serve one person's workspace to the next visitor.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // No CORS layer on purpose: in development Vite proxies /api to this server,
  // and in production both are served from one origin. Same-origin throughout
  // means the session cookie never needs to be cross-site.

  // Public and unauthenticated, so in production it says only whether things are
  // working. The database name, its version and a raw driver error are useful
  // on a laptop and a gift to anyone probing the live site.
  app.get('/api/health', async (_req, res) => {
    try {
      const info = await checkConnection();
      res.json(env.isProduction
        ? { ok: true }
        : { ok: true, database: info.database, mysql: info.version, env: env.NODE_ENV });
    } catch (error) {
      console.error('Health check failed:', (error as Error).message);
      res.status(503).json(env.isProduction
        ? { ok: false, message: 'Database unreachable.' }
        : { ok: false, message: 'Database unreachable.', detail: (error as Error).message });
    }
  });

  app.use(loadUser);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/permissions', permissionsRouter);

  /** The whole workspace in one round trip.
   *
   *  Deliberately not paginated per register: the client holds the full set and
   *  every screen filters it locally, which is what makes cross-register views
   *  (a SIM's accounts, an agent's projects) possible without a request each.
   *  Only the audit trail is capped, because it is the one table that grows
   *  without a ceiling. */
  app.get('/api/bootstrap', requireAuth, asyncHandler(async (req, res) => {
    res.json(await loadBootstrap(req.user!));
  }));

  app.use('/api/sims', simsRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api', agentProofsRouter);
  app.use('/api/social-accounts', socialAccountsRouter);
  app.use('/api/domains', domainsRouter);
  app.use('/api/pakistan-competitors', pakistanCompetitorsRouter);
  app.use('/api/assignments', assignmentsRouter);
  app.use('/api/credentials', credentialsRouter);
  app.use('/api/import', importRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/team-reports', teamReportsRouter);
  app.use('/api/ads', adsRouter);
  app.use('/api/spiels', sharedSpielRouter);
  app.use('/api/notifications', notificationsRouter);
  // Growth owns two paths that keep their own names in the client.
  app.use('/api', growthRouter);

  if (staticDir) mountBrowserApp(app, staticDir);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/** Serves the built browser app from the same origin as the API.
 *
 *  One process behind one proxy rule, rather than nginx serving files and
 *  proxying `/api` separately: fewer moving parts to configure in a panel, and
 *  the session cookie stays same-origin without any extra setup.
 *
 *  Hashed assets are cached for a year, since a new build gets new file names.
 *  `index.html` is never cached, so a deploy reaches people on their next load
 *  rather than whenever their browser decides. Unknown `/api` paths still fall
 *  through to the JSON 404 — a client bug must not come back as a web page. */
function mountBrowserApp(app: Express, staticDir: string): void {
  const indexHtml = path.join(staticDir, 'index.html');
  if (!existsSync(indexHtml)) {
    console.warn(`No built app at ${staticDir} — run \`npm run build\`. Serving the API only.`);
    return;
  }

  // The mock worker is copied out of public/ by every build. It is inert without
  // the mock flag, but a production site has no reason to serve it at all.
  app.get('/mockServiceWorker.js', (_req, res) => {
    res.status(404).end();
  });

  app.use('/assets', express.static(path.join(staticDir, 'assets'), {
    immutable: true,
    maxAge: '365d',
  }));
  // A missing hashed asset is a plain 404. Left to fall through, a script tag's
  // `Accept: */*` would match the app-shell fallback below and receive HTML,
  // which the browser then fails to run with a far less obvious error.
  app.use('/assets', (_req, res) => {
    res.status(404).end();
  });

  app.use(express.static(staticDir, {
    index: false,
    maxAge: '1h',
  }));

  // Client-side routes: /sims/SIM-0001 has no file, so it gets the app shell.
  app.get(/^(?!\/api(?:\/|$)).*/, (req: Request, res: Response, next: NextFunction) => {
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
