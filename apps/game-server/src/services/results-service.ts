import type { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error-handler.js';
import { getLeaderboard } from './scoring-service.js';

const ensureSession = async (prisma: PrismaClient, sessionId: string) => {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: { id: true, pin: true, status: true, quiz: { select: { id: true, title: true } } }
  });
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Session not found');
  return session;
};

export const getSessionResults = async (
  prisma: PrismaClient,
  sessionId: string,
  participantId?: string
) => {
  const session = await ensureSession(prisma, sessionId);
  const participants = await prisma.participant.findMany({
    where: { sessionId, ...(participantId ? { id: participantId } : {}) },
    orderBy: [{ totalScore: 'desc' }, { correctCount: 'desc' }, { participantIdentifier: 'asc' }],
    select: {
      id: true,
      participantIdentifier: true,
      displayName: true,
      email: true,
      studentId: true,
      joinedAt: true,
      totalScore: true,
      correctCount: true,
      streak: true,
      answers: {
        orderBy: [{ question: { order: 'asc' } }, { submittedAt: 'asc' }],
        select: {
          id: true,
          questionId: true,
          selectedOptionId: true,
          isCorrect: true,
          awardedPoints: true,
          responseTimeMs: true,
          submittedAt: true,
          question: { select: { order: true, text: true } },
          selectedOption: { select: { id: true, text: true } }
        }
      }
    }
  });
  const leaderboard = await getLeaderboard(prisma, sessionId);
  const questions = await prisma.question.findMany({
    where: { quizId: session.quiz.id },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      order: true,
      text: true,
      answers: {
        where: { participant: { sessionId } },
        select: { isCorrect: true, awardedPoints: true }
      }
    }
  });
  const questionStats = questions.map((question) => ({
    questionId: question.id,
    order: question.order,
    text: question.text,
    answerCount: question.answers.length,
    correctCount: question.answers.filter((answer) => answer.isCorrect).length,
    awardedPoints: question.answers.reduce((total, answer) => total + answer.awardedPoints, 0)
  }));
  return {
    session: { id: session.id, pin: session.pin, status: session.status, quiz: session.quiz },
    leaderboard,
    podium: leaderboard.slice(0, 3),
    questionStats,
    participants
  };
};

export const getParticipantResults = async (prisma: PrismaClient, sessionId: string, participantId: string) =>
  getSessionResults(prisma, sessionId, participantId).then((result) => {
    const participant = result.participants[0];
    const ownLeaderboardEntry = result.leaderboard.find(
      (entry) => entry.participantIdentifier === participant?.participantIdentifier
    );
    return {
      ...result,
      leaderboard: ownLeaderboardEntry ? [ownLeaderboardEntry] : [],
      podium: [],
      participants: result.participants.map(({ email: _email, studentId: _studentId, ...safeParticipant }) => safeParticipant)
    };
  });

export const getExportRows = async (prisma: PrismaClient, sessionId: string) => {
  const result = await getSessionResults(prisma, sessionId);
  return result.participants.flatMap((participant) => {
    const rows = participant.answers.length > 0 ? participant.answers : [{ questionId: '', question: { order: 0, text: '' }, selectedOptionId: '', selectedOption: { id: '', text: '' }, isCorrect: false, awardedPoints: 0, responseTimeMs: null, submittedAt: participant.joinedAt, id: '' }];
    return rows.map((answer) => ({
      participantIdentifier: participant.participantIdentifier,
      displayName: participant.displayName,
      email: participant.email ?? '',
      studentId: participant.studentId ?? '',
      totalScore: participant.totalScore,
      correctCount: participant.correctCount,
      questionOrder: answer.question.order,
      question: answer.question.text,
      selectedOption: answer.selectedOption.text,
      isCorrect: answer.isCorrect,
      awardedPoints: answer.awardedPoints,
      responseTimeMs: answer.responseTimeMs ?? '',
      submittedAt: answer.submittedAt.toISOString()
    }));
  });
};

export const getSummaryExportRows = async (prisma: PrismaClient, sessionId: string) => {
  const result = await getSessionResults(prisma, sessionId);
  return result.participants.map((participant) => ({
    participantIdentifier: participant.participantIdentifier,
    displayName: participant.displayName,
    email: participant.email ?? '',
    studentId: participant.studentId ?? '',
    totalScore: participant.totalScore,
    correctCount: participant.correctCount,
    streak: participant.streak,
    answerCount: participant.answers.length,
    joinedAt: participant.joinedAt.toISOString()
  }));
};
