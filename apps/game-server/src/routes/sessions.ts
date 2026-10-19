import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { SessionStatus, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAdmin, requireSessionAccess } from '../middleware/auth.js';
import { joinSession, createSession, getSession, listSessions, updateSessionStatus, deleteSession } from '../services/session-service.js';
import { getLeaderboard } from '../services/scoring-service.js';
import { validate } from '../validation/request.js';
import {
  createSessionSchema,
  joinSessionSchema,
  sessionIdParamSchema,
  sessionPaginationSchema,
  updateSessionStatusSchema
} from '../validation/session.js';

const pinSchema = z.object({ id: z.string().regex(/^\d{6}$/) });

export const createSessionRouter = (prisma: PrismaClient) => {
  const router = Router();
  const joinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many join attempts' } }
  });

  router.post('/join/:id', joinLimiter, validate(joinSessionSchema, 'body'), async (request, response) => {
    const { id: pin } = pinSchema.parse(request.params);
    response.status(201).json({ success: true, data: await joinSession(prisma, pin, request.body) });
  });

  router.get('/:id/leaderboard', requireSessionAccess(prisma), validate(sessionIdParamSchema, 'params'), async (request, response) => {
    const { id } = sessionIdParamSchema.parse(request.params);
    response.json({ success: true, data: await getLeaderboard(prisma, id) });
  });

  router.use(requireAdmin(prisma));
  router.get('/', validate(sessionPaginationSchema, 'query'), async (request, response) => {
    const { page, pageSize } = sessionPaginationSchema.parse(request.query);
    response.json({ success: true, data: await listSessions(prisma, page, pageSize) });
  });
  router.post('/', validate(createSessionSchema, 'body'), async (request, response) => {
    response.status(201).json({ success: true, data: await createSession(prisma, request.body.quizId) });
  });
  router.get('/:id', validate(sessionIdParamSchema, 'params'), async (request, response) => {
    const { id } = sessionIdParamSchema.parse(request.params);
    response.json({ success: true, data: await getSession(prisma, id) });
  });
  router.delete('/:id', validate(sessionIdParamSchema, 'params'), async (request, response) => {
    const { id } = sessionIdParamSchema.parse(request.params);
    await deleteSession(prisma, id);
    response.status(200).json({ success: true, data: { id, deleted: true } });
  });
  router.patch('/:id/status', validate(sessionIdParamSchema, 'params'), validate(updateSessionStatusSchema, 'body'), async (request, response) => {
    const { id } = sessionIdParamSchema.parse(request.params);
    response.json({
      success: true,
      data: await updateSessionStatus(prisma, id, request.body.status as SessionStatus)
    });
  });

  return router;
};
