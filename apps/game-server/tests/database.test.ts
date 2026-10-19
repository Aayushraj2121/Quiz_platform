import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'quiz-platform-db-'));
const databaseUrl = `file:${resolve(temporaryDirectory, 'test.db')}`;
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

beforeAll(() => {
  execFileSync(resolve('node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe'
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('database constraints', () => {
  it('prevents more than one answer per participant and question', async () => {
    const quiz = await prisma.quiz.create({ data: { title: 'Constraint test' } });
    const question = await prisma.question.create({
      data: {
        quizId: quiz.id,
        order: 1,
        text: 'Test question',
        options: {
          create: [
            { text: 'Correct', isCorrect: true },
            { text: 'Incorrect', isCorrect: false }
          ]
        }
      },
      include: { options: true }
    });
    const session = await prisma.gameSession.create({
      data: { quizId: quiz.id, pin: '123456' }
    });
    const participant = await prisma.participant.create({
      data: { sessionId: session.id, displayName: 'Participant' }
    });
    const correctOption = question.options.find((option) => option.isCorrect);

    expect(correctOption).toBeDefined();
    if (!correctOption) {
      throw new Error('Test fixture did not create a correct option');
    }

    await prisma.answer.create({
      data: {
        participantId: participant.id,
        questionId: question.id,
        selectedOptionId: correctOption.id,
        isCorrect: true,
        awardedPoints: 1000
      }
    });

    await expect(
      prisma.answer.create({
        data: {
          participantId: participant.id,
          questionId: question.id,
          selectedOptionId: correctOption.id,
          isCorrect: true,
          awardedPoints: 1000
        }
      })
    ).rejects.toThrow();
  });
});
