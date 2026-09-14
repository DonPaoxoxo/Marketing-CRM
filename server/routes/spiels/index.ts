/** Shared Spiel Library API, mounted at /api/spiels. Everything needs a signed-in
 *  session; each route then decides who may see or change what. Documents and AI
 *  come first so their paths are never read as a spiel id. */

import { Router } from 'express';
import { requireAuth } from '../../auth/middleware';
import { aiRouter } from './ai';
import { documentsRouter } from './documents';
import { spielsRouter } from './spiels';

export const sharedSpielRouter = Router();
sharedSpielRouter.use(requireAuth);
sharedSpielRouter.use(aiRouter);
sharedSpielRouter.use(documentsRouter);
sharedSpielRouter.use(spielsRouter);
