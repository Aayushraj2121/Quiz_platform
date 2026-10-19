import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { hashConnectionToken, verifyParticipantToken } from '../auth/jwt.js';
import { AppError } from '../middleware/error-handler.js';
import { issueCertificate, verifyCertificate } from '../services/certificate-service.js';

export const createCertificateRouter = (prisma: PrismaClient) => {
  const router = Router();
  router.get('/verify/:code', async (request, response) => {
    response.json({ success: true, data: await verifyCertificate(prisma, request.params.code) });
  });
  router.get('/:participantToken', async (request, response) => {
    let payload;
    try {
      payload = verifyParticipantToken(request.params.participantToken);
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid participant token');
    }
    const participant = await prisma.participant.findUnique({
      where: { id: payload.sub },
      select: { id: true, sessionId: true, participantIdentifier: true, tokenHash: true }
    });
    if (
      !participant ||
      participant.sessionId !== payload.sessionId ||
      participant.participantIdentifier !== payload.participantIdentifier ||
      participant.tokenHash !== hashConnectionToken(request.params.participantToken)
    ) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid participant token');
    }
    response.json({ success: true, data: await issueCertificate(prisma, participant.id) });
  });
  return router;
};
