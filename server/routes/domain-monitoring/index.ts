/** Domain Monitoring & Rotation: daily accessibility checks for Free Cash and
 *  Invite Domains, and a 5-day rotation cycle for Invite Domains. A manual-
 *  operation-only module — see migration 019 and the module's own design
 *  notes in server/routes/domains.ts's sibling files here. */

import { Router } from 'express';
import { requirePermission } from '../../auth/middleware';
import { domainMonitorsRouter } from './monitors';
import { domainChecksRouter } from './checks';
import { rotationBatchesRouter } from './batches';
import { rotationRouter } from './rotation';

export const domainMonitoringRouter = Router();
// The page permission gates every route under here, same as domainsRouter.
domainMonitoringRouter.use(requirePermission('access:domain-monitoring'));
domainMonitoringRouter.use(domainMonitorsRouter);
domainMonitoringRouter.use(domainChecksRouter);
domainMonitoringRouter.use(rotationBatchesRouter);
domainMonitoringRouter.use(rotationRouter);
