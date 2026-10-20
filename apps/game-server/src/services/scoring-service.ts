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
      { joinedAt: 'asc' },
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
        awardedPoints: 0,
        feedback: [],
        distribution: []
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
        awardedPoints: 0,
        feedback: [],
        distribution: []
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

    // ── Fetch question timing ONCE (was fetched once per answer inside the loop) ──
    const questionWithTiming = await transaction.question.findUniqueOrThrow({
      where: { id: question.id },
      select: { basePoints: true, timerSeconds: true }
    });

    // ── Bulk-fetch all unscored answers with their participant data in one query ──
    // Filtering on awardedPoints:0 preserves the original idempotency guarantee.
    const answers = await transaction.answer.findMany({
      where: {
        questionId: question.id,
        participant: { sessionId },
        awardedPoints: 0
      },
      select: {
        id: true,
        participantId: true,
        selectedOptionId: true,
        responseTimeMs: true,
        participant: {
          select: { totalScore: true, correctCount: true, streak: true }
        }
      }
    });

    // ── Calculate all scores in memory (zero DB round-trips) ──
    let awardedPoints = 0;
    const distribution = new Map<string, number>();
    const feedback: FinalizeQuestionResult['feedback'] = [];

    interface ScoredAnswer {
      answerId: string;
      participantId: string;
      isCorrect: boolean;
      points: number;
      newStreak: number;
      newTotalScore: number;
      newCorrectCount: number;
    }
    const scoredAnswers: ScoredAnswer[] = [];

    for (const answer of answers) {
      const isCorrect = answer.selectedOptionId === correctOptionId;
      distribution.set(answer.selectedOptionId, (distribution.get(answer.selectedOptionId) ?? 0) + 1);

      const remainingRatio = Math.max(
        0,
        Math.min(1, (answer.responseTimeMs ?? 0) / (questionWithTiming.timerSeconds * 1000))
      );
      const basePoints = isCorrect
        ? Math.round(questionWithTiming.basePoints * (0.5 + 0.5 * remainingRatio))
        : 0;
      const newStreak = isCorrect ? answer.participant.streak + 1 : 0;
      const streakBonus = isCorrect ? Math.min(500, Math.max(0, newStreak - 2) * 100) : 0;
      const points = basePoints + streakBonus;
      const newTotalScore = answer.participant.totalScore + points;
      const newCorrectCount = answer.participant.correctCount + (isCorrect ? 1 : 0);

      awardedPoints += points;
      scoredAnswers.push({
        answerId: answer.id,
        participantId: answer.participantId,
        isCorrect,
        points,
        newStreak,
        newTotalScore,
        newCorrectCount
      });
      feedback.push({
        participantId: answer.participantId,
        questionId: question.id,
        correct: isCorrect,
        points,
        streak: newStreak,
        totalScore: newTotalScore
      });
    }

    // ── Apply all DB writes concurrently instead of sequentially ──
    await Promise.all([
      // Update every scored answer in parallel.
      ...scoredAnswers.map((sa) =>
        transaction.answer.update({
          where: { id: sa.answerId },
          data: { isCorrect: sa.isCorrect, awardedPoints: sa.points }
        })
      ),
      // Update every participant in parallel.
      ...scoredAnswers.map((sa) =>
        transaction.participant.update({
          where: { id: sa.participantId },
          data: {
            totalScore: sa.newTotalScore,
            correctCount: sa.newCorrectCount,
            streak: sa.newStreak
          }
        })
      ),
      // Reset streak for participants who did not answer this question.
      transaction.participant.updateMany({
        where: {
          sessionId,
          answers: { none: { questionId: question.id } }
        },
        data: { streak: 0 }
      })
    ]);

    return {
      sessionId,
      questionId: question.id,
      status: SessionStatus.REVEAL,
      finalized: true,
      awardedPoints,
      feedback,
      distribution: [...distribution.entries()].map(([optionId, count]) => ({ optionId, count }))
    };
  });
};
