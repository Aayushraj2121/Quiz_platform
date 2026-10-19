import type { RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { AppError } from './error-handler.js';
import { verifyAdminToken } from '../auth/jwt.js';

export const requireAdmin = (prisma: PrismaClient): RequestHandler => async (request, _response, next) => {
  const authorization = request.header('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

  if (!token) {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication is required'));
    return;
  }

  try {
    const payload = verifyAdminToken(token);
    const admin = await prisma.admin.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true }
    });
    if (!admin || admin.username !== payload.username) {
      next(new AppError(401, 'UNAUTHORIZED', 'Authentication is required'));
      return;
    }
    request.admin = admin;
    next();
  } catch {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication is required'));
  }
};
