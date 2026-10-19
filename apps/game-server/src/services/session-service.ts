import { Prisma, PrismaClient, SessionStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { AppError } from '../middleware/error-handler.js';
import { hashConnectionToken, signParticipantToken } from '../auth/jwt.js';
import { env } from '../config/env.js';

const safeSessionSelect = {
  id: true,
  quizId: true,
  pin: true,
  status: true,
  currentQuestionIndex: true,
  startTime: true,
  endTime: true,
  currentQuestionDeadline: true,
  createdAt: true,
  updatedAt: true,
  quiz: { select: { id: true, title: true, description: true, status: true } },
  _count: { select: { participants: true } }
} satisfies Prisma.GameSessionSelect;

const safeParticipantSelect = {
  id: true,
  participantIdentifier: true,
  displayName: true,
  email: true,
  studentId: true,
  joinedAt: true
} satisfies Prisma.ParticipantSelect;

const transitions: Record<SessionStatus, readonly SessionStatus[]> = {
  LOBBY: [SessionStatus.QUESTION, SessionStatus.ENDED],
  QUESTION: [SessionStatus.REVEAL, SessionStatus.LEADERBOARD, SessionStatus.ENDED],
  REVEAL: [SessionStatus.LEADERBOARD, SessionStatus.QUESTION, SessionStatus.ENDED],
  LEADERBOARD: [SessionStatus.QUESTION, SessionStatus.PODIUM, SessionStatus.ENDED],
  PODIUM: [SessionStatus.ENDED],
  ENDED: []
};

const generatePin = (): string => randomInt(100_000, 1_000_000).toString();
const participantName = (name: string, suffix: number): string => suffix === 0 ? name : `${name} (${suffix})`;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export const ensureSession = async (prisma: PrismaClient, id: string) => {
  const session = await prisma.gameSession.findUnique({ where: { id }, select: { id: true } });
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Session not found');
  return session;
};

const validateQuizEligibility = async (prisma: PrismaClient, quizId: string) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: {
      id: true,
      status: true,
      questions: {
        select: { id: true, options: { select: { isCorrect: true } } }
      }
    }
  });

  if (!quiz) throw new AppError(404, 'NOT_FOUND', 'Quiz not found');
  if (quiz.status !== 'PUBLISHED') {
    throw new AppError(400, 'QUIZ_NOT_ELIGIBLE', 'Only published quizzes can be used for sessions');
  }
  if (quiz.questions.length === 0) {
    throw new AppError(400, 'QUIZ_NOT_ELIGIBLE', 'The quiz must contain at least one question');
  }
  if (
    quiz.questions.some(
      (question) =>
        question.options.length < 2 ||
        question.options.length > 4 ||
        question.options.filter((option) => option.isCorrect).length !== 1
    )
  ) {
    throw new AppError(400, 'QUIZ_NOT_ELIGIBLE', 'Every question must have 2–4 options and exactly one correct option');
  }
};

export const createSession = async (prisma: PrismaClient, quizId: string) => {
  await validateQuizEligibility(prisma, quizId);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.gameSession.create({
        data: { quizId, pin: generatePin() },
        select: safeSessionSelect
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }

  throw new AppError(503, 'PIN_GENERATION_FAILED', 'Unable to allocate a unique session PIN');
};

export const listSessions = async (prisma: PrismaClient, page: number, pageSize: number) => {
  const skip = (page - 1) * pageSize;
  const [items, total] = await prisma.$transaction([
    prisma.gameSession.findMany({
      skip,
      take: pageSize,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: safeSessionSelect
    }),
    prisma.gameSession.count()
  ]);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
};

export const getSession = async (prisma: PrismaClient, id: string) => {
  const session = await prisma.gameSession.findUnique({
    where: { id },
    select: {
      ...safeSessionSelect,
      participants: { select: safeParticipantSelect, orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }] }
    }
  });
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Session not found');
  return session;
};

export const updateSessionStatus = async (prisma: PrismaClient, id: string, nextStatus: SessionStatus) => {
  const current = await prisma.gameSession.findUnique({ where: { id }, select: { status: true } });
  if (!current) throw new AppError(404, 'NOT_FOUND', 'Session not found');
  if (current.status !== nextStatus && !transitions[current.status].includes(nextStatus)) {
    throw new AppError(409, 'INVALID_SESSION_TRANSITION', `Cannot transition session from ${current.status} to ${nextStatus}`);
  }

  return prisma.gameSession.update({
    where: { id },
    data: {
      status: nextStatus,
      ...(nextStatus === SessionStatus.ENDED ? { endTime: new Date() } : {}),
      ...(nextStatus === SessionStatus.QUESTION ? { startTime: new Date() } : {})
    },
    select: safeSessionSelect
  });
};

export const joinSession = async (
  prisma: PrismaClient,
  pin: string,
  data: { displayName: string; email?: string; studentId?: string }
) => {
  const session = await prisma.gameSession.findUnique({
    where: { pin },
    select: { id: true, pin: true, status: true, quizId: true, quiz: { select: { id: true, title: true } } }
  });

  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found');
  if (session.status !== SessionStatus.LOBBY) {
    throw new AppError(409, 'SESSION_NOT_JOINABLE', 'This session is no longer accepting participants');
  }

  for (let suffix = 0; suffix < 1000; suffix += 1) {
    try {
      const participant = await prisma.participant.create({
        data: {
          sessionId: session.id,
          displayName: participantName(data.displayName, suffix),
          ...(data.email === undefined ? {} : { email: data.email }),
          ...(data.studentId === undefined ? {} : { studentId: data.studentId })
        },
        select: safeParticipantSelect
      });
    const participantToken = signParticipantToken({
      sub: participant.id,
      sessionId: session.id,
      participantIdentifier: participant.participantIdentifier
    });
    await prisma.participant.update({
      where: { id: participant.id },
      data: { tokenHash: hashConnectionToken(participantToken) }
    });

      return {
        session: {
          id: session.id,
          pin: session.pin,
          status: session.status,
          quiz: session.quiz,
          joinUrl: `${env.PUBLIC_APP_URL}/join/${session.pin}`
        },
        participant,
        connectionToken: participantToken
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) continue;
      throw error;
    }
  }

  throw new AppError(409, 'DUPLICATE_PARTICIPANT', 'Unable to allocate a unique participant name');
};
