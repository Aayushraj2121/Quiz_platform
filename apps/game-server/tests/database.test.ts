
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase } from './test-database.js';

const testDatabase = createTestDatabase('constraints');
const prisma = testDatabase.prisma;

beforeAll(async () => {
  await testDatabase.migrate();
}, 60000);

afterAll(async () => {
  await testDatabase.disconnect();
});

describe('database constraints', () => {
  it(
    'prevents more than one answer per participant and question',
    async () => {
      const uniqueId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

      const quiz = await prisma.quiz.create({
        data: { title: `Constraint test ${uniqueId}` },
      });

      const question = await prisma.question.create({
        data: {
          quizId: quiz.id,
          order: 1,
          text: 'Test question',
          options: {
            create: [
              { text: 'Correct', isCorrect: true },
              { text: 'Incorrect', isCorrect: false },
            ],
          },
        },
        include: { options: true },
      });

      const session = await prisma.gameSession.create({
        data: {
          quizId: quiz.id,
          pin: `T${uniqueId.replace('-', '')}`,
        },
      });

      const participant = await prisma.participant.create({
        data: {
          sessionId: session.id,
          displayName: `Participant ${uniqueId}`,
        },
      });

      const correctOption = question.options.find(
        (option) => option.isCorrect,
      );

      expect(correctOption).toBeDefined();

      if (!correctOption) {
        throw new Error('Test fixture did not create a correct option');
      }

      const answerData = {
        participantId: participant.id,
        questionId: question.id,
        selectedOptionId: correctOption.id,
        isCorrect: true,
        awardedPoints: 1000,
      };

      await prisma.answer.create({ data: answerData });

      await expect(
        prisma.answer.create({ data: answerData }),
      ).rejects.toThrow();
    },
    30000,
  );
});
