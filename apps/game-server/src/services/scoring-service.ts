import { Prisma, PrismaClient, SessionStatus } from '@prisma/client';
import { AppError } from '../middleware/error-handler.js';

export const POINTS_PER_CORRECT_ANSWER = 100;

export interface FinalizeQuestionResult {
  sessionId: string;
  questionId: string;
  status: SessionStatus;
  finalized: boolean;
  awardedPoints: number;
}

export interface LeaderboardEntry {
  rank: number;
  participantIdentifier: string;
  displayName: string;
  totalScore: number;
  correctCount: number;
}

const leaderboardParticipantSelect = {
  participantIdentifier: true,
  displayName: true,
  totalScore: true,
  correctCount: true
} satisfies Prisma.ParticipantSelect;

export const getLeaderboard = async (
  prisma: PrismaClient,
  sessionId: string
): Promise<LeaderboardEntry[]> => {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: { id: true }
  });

  if (!session) {
    throw new AppError(404, 'NOT_FOUND', 'Session not found');
  }

  const participants = await prisma.participant.findMany({
    where: { sessionId },
    orderBy: [
      { totalScore: 'desc' },
      { correctCount: 'desc' },
      { participantIdentifier: 'asc' }
    ],
    select: leaderboardParticipantSelect
  });

  let previousScore: number | undefined;
  let previousRank = 0;

  return participants.map((participant, index) => {
    const rank = participant.totalScore === previousScore ? previousRank : index + 1;
    previousScore = participant.totalScore;
    previousRank = rank;
    return { rank, ...participant };
  });
};

export const finalizeQuestion = async (
  prisma: PrismaClient,
  sessionId: string,
  _reason: 'timer' | 'manual'
): Promise<FinalizeQuestionResult> => {
  return prisma.$transaction(async (transaction) => {
    const session = await transaction.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        quizId: true,
        status: true,
        currentQuestionIndex: true
      }
    });

    if (!session) {
      throw new AppError(404, 'NOT_FOUND', 'Session not found');
    }

    if (session.status !== SessionStatus.QUESTION) {
      const question = await transaction.question.findFirst({
        where: {
          quizId: session.quizId,
          order: session.currentQuestionIndex + 1
        },
        select: { id: true }
      });
      if (!question) {
        throw new AppError(400, 'INVALID_QUESTION', 'Active question was not found');
      }
      return {
        sessionId,
        questionId: question.id,
        status: session.status,
        finalized: false,
        awardedPoints: 0
      };
    }

    const claimed = await transaction.gameSession.updateMany({
      where: { id: sessionId, status: SessionStatus.QUESTION },
      data: {
        status: SessionStatus.REVEAL,
        currentQuestionDeadline: null
      }
    });

    const question = await transaction.question.findFirst({
      where: {
        quizId: session.quizId,
        order: session.currentQuestionIndex + 1
      },
      select: {
        id: true,
        options: { select: { id: true, isCorrect: true } }
      }
    });

    if (!question) {
      throw new AppError(400, 'INVALID_QUESTION', 'Active question was not found');
    }

    if (claimed.count === 0) {
      return {
        sessionId,
        questionId: question.id,
        status: SessionStatus.REVEAL,
        finalized: false,
        awardedPoints: 0
      };
    }

    const correctOptions = question.options.filter((option) => option.isCorrect);
    if (correctOptions.length !== 1) {
      throw new AppError(400, 'INVALID_QUESTION', 'Question must have exactly one correct answer');
    }
    const correctOption = correctOptions[0];
    if (!correctOption) {
      throw new AppError(400, 'INVALID_QUESTION', 'Question must have exactly one correct answer');
    }
    const correctOptionId = correctOption.id;

    const answers = await transaction.answer.findMany({
      where: {
        questionId: question.id,
        participant: { sessionId }
      },
      select: {
        id: true,
        participantId: true,
        selectedOptionId: true
      }
    });

    let awardedPoints = 0;
    for (const answer of answers) {
      const isCorrect = answer.selectedOptionId === correctOptionId;
      const points = isCorrect ? POINTS_PER_CORRECT_ANSWER : 0;
      const updated = await transaction.answer.updateMany({
        where: { id: answer.id, awardedPoints: 0 },
        data: { isCorrect, awardedPoints: points }
      });

      if (updated.count === 1 && isCorrect) {
        await transaction.participant.update({
          where: { id: answer.participantId },
          data: {
            totalScore: { increment: points },
            correctCount: { increment: 1 }
          }
        });
        awardedPoints += points;
      }
    }

    return {
      sessionId,
      questionId: question.id,
      status: SessionStatus.REVEAL,
      finalized: true,
      awardedPoints
    };
  });
};
