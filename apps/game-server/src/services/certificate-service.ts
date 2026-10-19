import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error-handler.js';
import { getLeaderboard } from './scoring-service.js';

const eventName = 'GLITCH IN REALITY';

export const issueCertificate = async (prisma: PrismaClient, participantId: string) => {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    select: {
      id: true,
      displayName: true,
      participantIdentifier: true,
      sessionId: true,
      session: { select: { id: true, status: true, endTime: true, createdAt: true, quiz: { select: { title: true } } } }
    }
  });
  if (!participant) throw new AppError(404, 'NOT_FOUND', 'Participant not found');
  if (participant.session.status !== 'PODIUM' && participant.session.status !== 'ENDED') {
    throw new AppError(409, 'CERTIFICATE_NOT_READY', 'Certificates are available after the game ends');
  }
  const leaderboard = await getLeaderboard(prisma, participant.sessionId);
  const entry = leaderboard.find((item) => item.participantIdentifier === participant.participantIdentifier);
  if (!entry) throw new AppError(404, 'NOT_FOUND', 'Participant result not found');
  const certificate = await prisma.certificate.upsert({
    where: { participantId_sessionId: { participantId: participant.id, sessionId: participant.sessionId } },
    update: {},
    create: {
      participantId: participant.id,
      sessionId: participant.sessionId,
      verificationCode: randomBytes(16).toString('hex')
    },
    select: { id: true, verificationCode: true, issuedAt: true }
  });
  return {
    id: certificate.id,
    verificationCode: certificate.verificationCode,
    issuedAt: certificate.issuedAt,
    participantName: participant.displayName,
    event: eventName,
    quizTitle: participant.session.quiz.title,
    date: (participant.session.endTime ?? participant.session.createdAt).toISOString().slice(0, 10),
    rank: entry.rank,
    score: entry.totalScore,
    place: entry.rank <= 3 ? entry.rank : null
  };
};

export const verifyCertificate = async (prisma: PrismaClient, verificationCode: string) => {
  const certificate = await prisma.certificate.findUnique({
    where: { verificationCode },
    select: {
      verificationCode: true,
      issuedAt: true,
      participant: { select: { displayName: true } },
      session: { select: { status: true, endTime: true, createdAt: true, quiz: { select: { title: true } } } }
    }
  });
  if (!certificate) throw new AppError(404, 'NOT_FOUND', 'Certificate not found');
  return {
    verificationCode: certificate.verificationCode,
    issuedAt: certificate.issuedAt,
    participantName: certificate.participant.displayName,
    event: eventName,
    quizTitle: certificate.session.quiz.title,
    date: (certificate.session.endTime ?? certificate.session.createdAt).toISOString().slice(0, 10)
  };
};

export const issueSessionCertificates = async (prisma: PrismaClient, sessionId: string) => {
  const participants = await prisma.participant.findMany({ where: { sessionId }, select: { id: true } });
  for (const participant of participants) await issueCertificate(prisma, participant.id);
};
