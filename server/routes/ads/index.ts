/** Ads Monitoring API, mounted at /api/ads. Everything requires a signed-in
 *  session; each route then decides who may change what. */

import { Router } from 'express';
import { requireAuth } from '../../auth/middleware';
import { campaignsRouter } from './campaigns';
import { adsFilesRouter } from './files';
import { adsImportRouter } from './import';

export const adsRouter = Router();
adsRouter.use(requireAuth);
adsRouter.use(adsImportRouter);
adsRouter.use(adsFilesRouter);
adsRouter.use(campaignsRouter);
