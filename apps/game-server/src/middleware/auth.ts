import type { RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { AppError } from './error-handler.js';
import { hashConnectionToken, verifyAdminToken, verifyParticipantToken } from '../auth/jwt.js';

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

export const requireSessionAccess = (prisma: PrismaClient): RequestHandler => async (request, _response, next) => {
  const authorization = request.header('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const sessionId = request.params.id;

  if (!token || !sessionId) {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication is required'));
    return;
  }

  try {
    try {
      const admin = verifyAdminToken(token);
      const adminRecord = await prisma.admin.findUnique({
        where: { id: admin.sub },
        select: { id: true, username: true }
      });
      if (adminRecord && adminRecord.username === admin.username) {
        request.admin = adminRecord;
        next();
        return;
      }
    } catch {
      // Try participant credentials below.
    }

    const participantToken = verifyParticipantToken(token);
    if (participantToken.sessionId !== sessionId) {
      throw new Error('Wrong session');
    }
    const participant = await prisma.participant.findUnique({
      where: { id: participantToken.sub },
      select: { id: true, sessionId: true, participantIdentifier: true, tokenHash: true }
    });
    if (
      !participant ||
      participant.sessionId !== sessionId ||
      participant.participantIdentifier !== participantToken.participantIdentifier ||
      participant.tokenHash !== hashConnectionToken(token)
    ) {
      throw new Error('Invalid participant');
    }
    request.participant = {
      id: participant.id,
      participantIdentifier: participant.participantIdentifier
    };
    next();
  } catch {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication is required'));
  }
};
