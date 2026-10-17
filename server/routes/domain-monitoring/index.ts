/** Domain Monitoring: daily manual accessibility checks for Free Cash and
 *  Invite Domains, a manual Enabled/Disabled switch, and a manually-set
 *  next-rotation reminder date. See migration 019. */

import { Router } from 'express';
import { requirePermission } from '../../auth/middleware';
import { domainMonitorsRouter } from './monitors';
import { domainChecksRouter } from './checks';

export const domainMonitoringRouter = Router();
// The page permission gates every route under here, same as domainsRouter.
domainMonitoringRouter.use(requirePermission('access:domain-monitoring'));
domainMonitoringRouter.use(domainMonitorsRouter);
domainMonitoringRouter.use(domainChecksRouter);
