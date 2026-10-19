import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import rateLimit from 'express-rate-limit';
import { loginAdmin } from '../services/auth-service.js';
import { validate, loginSchema } from '../validation/request.js';
import { requireAdmin } from '../middleware/auth.js';

export const createAdminRouter = (prisma: PrismaClient) => {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts' } }
  });

  router.post('/login', loginLimiter, validate(loginSchema, 'body'), async (request, response) => {
    const result = await loginAdmin(prisma, request.body.username, request.body.password);
    response.status(200).json({ success: true, data: result });
  });
  router.get('/me', requireAdmin(prisma), (request, response) => {
    response.json({ success: true, data: { admin: request.admin } });
  });
  router.post('/logout', requireAdmin(prisma), (_request, response) => {
    response.status(204).send();
  });
  return router;
};
