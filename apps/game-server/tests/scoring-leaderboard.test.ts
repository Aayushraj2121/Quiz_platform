import { QuizStatus, SessionStatus } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { finalizeQuestion, getLeaderboard } from '../src/services/scoring-service.js';
import { createTestDatabase } from './test-database.js';

const testDatabase = createTestDatabase('scoring');
const prisma = testDatabase.prisma;
let quizId = '';
let sessionId = '';
let correctParticipantId = '';
let incorrectParticipantId = '';
let correctOptionId = '';
let incorrectOptionId = '';

beforeAll(async () => {
  await testDatabase.migrate();
  const quiz = await prisma.quiz.create({
    data: {
      title: 'Scoring quiz',
      status: QuizStatus.PUBLISHED,
      questions: {
        create: {
          order: 1,
          text: 'Scoring question',
          options: {
            create: [
              { text: 'Correct', isCorrect: true },
              { text: 'Incorrect', isCorrect: false }
            ]
          }
        }
      }
    },
    include: { questions: { include: { options: true } } }
  });
  quizId = quiz.id;
  const question = quiz.questions[0];
  if (!question) throw new Error('Scoring question was not created');
  const correctOption = question.options.find((option) => option.isCorrect);
  const incorrectOption = question.options.find((option) => !option.isCorrect);
  if (!correctOption || !incorrectOption) throw new Error('Scoring options were not created');
  correctOptionId = correctOption.id;
  incorrectOptionId = incorrectOption.id;

  const sessionPin = String(
  100000 + Math.floor(Math.random() * 900000)
);

const session = await prisma.gameSession.create({
  data: {
    quizId,
    pin: sessionPin,
    status: SessionStatus.QUESTION,
    currentQuestionIndex: 0,
  },
});
  sessionId = session.id;
  const participants = await prisma.participant.createMany({
    data: [
      { sessionId, displayName: 'Correct player' },
      { sessionId, displayName: 'Incorrect player' },
      { sessionId, displayName: 'Unanswered player' }
    ]
  });
  expect(participants.count).toBe(3);
  correctParticipantId = (await prisma.participant.findUniqueOrThrow({
    where: { sessionId_displayName: { sessionId, displayName: 'Correct player' } }
  })).id;
  incorrectParticipantId = (await prisma.participant.findUniqueOrThrow({
    where: { sessionId_displayName: { sessionId, displayName: 'Incorrect player' } }
  })).id;
});

afterAll(async () => {
  await testDatabase.disconnect();
});

describe('server-authoritative scoring', () => {
  it('awards exactly 100 for correct answers and zero for incorrect/unanswered answers', async () => {
    const question = await prisma.question.findFirstOrThrow({ where: { quizId, order: 1 } });
    await prisma.answer.createMany({
      data: [
        {
          participantId: correctParticipantId,
          questionId: question.id,
          selectedOptionId: correctOptionId,
          isCorrect: true,
          awardedPoints: 0,
          responseTimeMs: 30_000
        },
        {
          participantId: incorrectParticipantId,
          questionId: question.id,
          selectedOptionId: incorrectOptionId,
          isCorrect: false,
          awardedPoints: 0
        }
      ]
    });

    const result = await finalizeQuestion(prisma, sessionId, 'manual');
    expect(result.finalized).toBe(true);
    expect(result.awardedPoints).toBe(1_000);

    const participants = await prisma.participant.findMany({
      where: { sessionId },
      orderBy: { displayName: 'asc' }
    });
    expect(participants.find((participant) => participant.id === correctParticipantId)?.totalScore).toBe(1_000);
    expect(participants.find((participant) => participant.id === incorrectParticipantId)?.totalScore).toBe(0);
    expect(participants.find((participant) => participant.displayName === 'Unanswered player')?.totalScore).toBe(0);
  });

  it('is idempotent when reveal/finalization is repeated', async () => {
    const repeated = await finalizeQuestion(prisma, sessionId, 'timer');
    expect(repeated.finalized).toBe(false);
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: correctParticipantId } }).then((item) => item.totalScore)).toBe(1_000);
  });

  it('returns deterministic competition ranks and isolates sessions', async () => {
    await prisma.participant.update({
      where: { id: incorrectParticipantId },
      data: { totalScore: 1_000, correctCount: 1 }
    });
    const otherSessionPin = String(
  100000 + Math.floor(Math.random() * 900000)
);

const otherSession = await prisma.gameSession.create({
  data: { quizId, pin: otherSessionPin }
});
    await prisma.participant.create({ data: { sessionId: otherSession.id, displayName: 'Other session player', totalScore: 1000 } });
    const leaderboard = await getLeaderboard(prisma, sessionId);
    expect(leaderboard[0]).toMatchObject({ rank: 1, displayName: 'Correct player', totalScore: 1_000 });
    expect(leaderboard[1]).toMatchObject({ rank: 1, displayName: 'Incorrect player', totalScore: 1_000 });
    expect(leaderboard[2]).toMatchObject({ rank: 3, displayName: 'Unanswered player', totalScore: 0 });
    expect(leaderboard).toHaveLength(3);
    expect(leaderboard.some((entry) => entry.displayName === 'Other session player')).toBe(false);
  });

  it('allows only one concurrent finalization to award points', async () => {
    const question = await prisma.question.findFirstOrThrow({ where: { quizId, order: 1 } });
    const concurrentSessionPin = String(
  100000 + Math.floor(Math.random() * 900000)
);

const concurrentSession = await prisma.gameSession.create({
  data: {
    quizId,
    pin: concurrentSessionPin,
    status: SessionStatus.QUESTION,
    currentQuestionIndex: 0
  }
});
    const participant = await prisma.participant.create({
      data: { sessionId: concurrentSession.id, displayName: 'Concurrent player' }
    });
    await prisma.answer.create({
      data: {
        participantId: participant.id,
        questionId: question.id,
        selectedOptionId: correctOptionId,
        isCorrect: true,
        awardedPoints: 0,
        responseTimeMs: 30_000
      }
    });

    const results = await Promise.all([
      finalizeQuestion(prisma, concurrentSession.id, 'manual'),
      finalizeQuestion(prisma, concurrentSession.id, 'timer')
    ]);
    expect(results.filter((result) => result.finalized)).toHaveLength(1);
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } }).then((item) => item.totalScore)).toBe(1_000);
  });
});
