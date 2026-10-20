
import { Prisma, PrismaClient, SessionStatus } from '@prisma/client';
import { AppError } from '../middleware/error-handler.js';

export const POINTS_PER_CORRECT_ANSWER = 100;

export interface FinalizeQuestionResult {
  sessionId: string;
  questionId: string;
  status: SessionStatus;
  finalized: boolean;
  awardedPoints: number;
  feedback: Array<{
    participantId: string;
    questionId: string;
    correct: boolean;
    points: number;
    streak: number;
    totalScore: number;
  }>;
  distribution: Array<{ optionId: string; count: number }>;
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
  correctCount: true,
} satisfies Prisma.ParticipantSelect;

export const getLeaderboard = async (
  prisma: PrismaClient,
  sessionId: string,
): Promise<LeaderboardEntry[]> => {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: { id: true },
  });

  if (!session) {
    throw new AppError(404, 'NOT_FOUND', 'Session not found');
  }

  const participants = await prisma.participant.findMany({
    where: { sessionId },
    orderBy: [
      { totalScore: 'desc' },
      { correctCount: 'desc' },
      { joinedAt: 'asc' },
      { participantIdentifier: 'asc' },
    ],
    select: leaderboardParticipantSelect,
  });

  let previousScore: number | undefined;
  let previousRank = 0;

  return participants.map((participant, index) => {
    const rank =
      participant.totalScore === previousScore ? previousRank : index + 1;

    previousScore = participant.totalScore;
    previousRank = rank;

    return { rank, ...participant };
  });
};

export const finalizeQuestion = async (
  prisma: PrismaClient,
  sessionId: string,
  _reason: 'timer' | 'manual',
): Promise<FinalizeQuestionResult> => {
  return prisma.$transaction(
    async (transaction) => {
      const session = await transaction.gameSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          quizId: true,
          status: true,
          currentQuestionIndex: true,
        },
      });

      if (!session) {
        throw new AppError(404, 'NOT_FOUND', 'Session not found');
      }

      if (session.status !== SessionStatus.QUESTION) {
        const question = await transaction.question.findFirst({
          where: {
            quizId: session.quizId,
            order: session.currentQuestionIndex + 1,
          },
          select: { id: true },
        });

        if (!question) {
          throw new AppError(
            400,
            'INVALID_QUESTION',
            'Active question was not found',
          );
        }

        return {
          sessionId,
          questionId: question.id,
          status: session.status,
          finalized: false,
          awardedPoints: 0,
          feedback: [],
          distribution: [],
        };
      }

      const claimed = await transaction.gameSession.updateMany({
        where: {
          id: sessionId,
          status: SessionStatus.QUESTION,
        },
        data: {
          status: SessionStatus.REVEAL,
          currentQuestionDeadline: null,
        },
      });

      const question = await transaction.question.findFirst({
        where: {
          quizId: session.quizId,
          order: session.currentQuestionIndex + 1,
        },
        select: {
          id: true,
          options: {
            select: {
              id: true,
              isCorrect: true,
            },
          },
        },
      });

      if (!question) {
        throw new AppError(
          400,
          'INVALID_QUESTION',
          'Active question was not found',
        );
      }

      if (claimed.count === 0) {
        return {
          sessionId,
          questionId: question.id,
          status: SessionStatus.REVEAL,
          finalized: false,
          awardedPoints: 0,
          feedback: [],
          distribution: [],
        };
      }

      const correctOptions = question.options.filter(
        (option) => option.isCorrect,
      );

      if (correctOptions.length !== 1) {
        throw new AppError(
          400,
          'INVALID_QUESTION',
          'Question must have exactly one correct answer',
        );
      }

      const correctOption = correctOptions[0];

      if (!correctOption) {
        throw new AppError(
          400,
          'INVALID_QUESTION',
          'Question must have exactly one correct answer',
        );
      }

      const correctOptionId = correctOption.id;

      const answers = await transaction.answer.findMany({
        where: {
          questionId: question.id,
          participant: { sessionId },
        },
        select: {
          id: true,
          participantId: true,
          selectedOptionId: true,
        },
      });

      let awardedPoints = 0;
      const distribution = new Map<string, number>();
      const feedback: FinalizeQuestionResult['feedback'] = [];

      for (const answer of answers) {
        const isCorrect = answer.selectedOptionId === correctOptionId;

        distribution.set(
          answer.selectedOptionId,
          (distribution.get(answer.selectedOptionId) ?? 0) + 1,
        );

        const updated = await transaction.answer.updateMany({
          where: {
            id: answer.id,
            awardedPoints: 0,
          },
          data: { isCorrect },
        });

        if (updated.count !== 1) {
          continue;
        }

        const participant =
          await transaction.participant.findUniqueOrThrow({
            where: { id: answer.participantId },
            select: {
              totalScore: true,
              correctCount: true,
              streak: true,
            },
          });

        const questionWithTiming =
          await transaction.question.findUniqueOrThrow({
            where: { id: question.id },
            select: {
              basePoints: true,
              timerSeconds: true,
            },
          });

        const storedAnswer = await transaction.answer.findUniqueOrThrow({
          where: { id: answer.id },
          select: { responseTimeMs: true },
        });

        const remainingRatio = Math.max(
          0,
          Math.min(
            1,
            (storedAnswer.responseTimeMs ?? 0) /
              (questionWithTiming.timerSeconds * 1000),
          ),
        );

        const basePoints = isCorrect
          ? Math.round(
              questionWithTiming.basePoints * (0.5 + 0.5 * remainingRatio),
            )
          : 0;

        const streak = isCorrect ? participant.streak + 1 : 0;

        const streakBonus = isCorrect
          ? Math.min(500, Math.max(0, streak - 2) * 100)
          : 0;

        const points = basePoints + streakBonus;

        const updatedParticipant = await transaction.participant.update({
          where: { id: answer.participantId },
          data: {
            totalScore: { increment: points },
            ...(isCorrect ? { correctCount: { increment: 1 } } : {}),
            streak,
          },
          select: {
            totalScore: true,
            streak: true,
          },
        });

        await transaction.answer.update({
          where: { id: answer.id },
          data: { awardedPoints: points },
        });

        awardedPoints += points;

        feedback.push({
          participantId: answer.participantId,
          questionId: question.id,
          correct: isCorrect,
          points,
          streak: updatedParticipant.streak,
          totalScore: updatedParticipant.totalScore,
        });
      }

      const allAnswers = await transaction.answer.findMany({
        where: {
          questionId: question.id,
          participant: { sessionId },
        },
        select: { selectedOptionId: true },
      });

      for (const answer of allAnswers) {
        if (!distribution.has(answer.selectedOptionId)) {
          distribution.set(answer.selectedOptionId, 0);
        }
      }

      await transaction.participant.updateMany({
        where: {
          sessionId,
          answers: {
            none: { questionId: question.id },
          },
        },
        data: { streak: 0 },
      });

      return {
        sessionId,
        questionId: question.id,
        status: SessionStatus.REVEAL,
        finalized: true,
        awardedPoints,
        feedback,
        distribution: [...distribution.entries()].map(
          ([optionId, count]) => ({ optionId, count }),
        ),
      };
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
};
