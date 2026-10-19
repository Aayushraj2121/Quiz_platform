import bcrypt from 'bcryptjs';
import { PrismaClient, QuizStatus } from '@prisma/client';

const prisma = new PrismaClient();

const seed = async (): Promise<void> => {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (username && password) {
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.admin.upsert({
      where: { username },
      update: { passwordHash },
      create: { username, passwordHash }
    });
  }

  const quiz = await prisma.quiz.upsert({
    where: { id: 'seed-cybersecurity-awareness' },
    update: {
      title: 'Cybersecurity Awareness',
      description: 'Seed quiz for local development',
      status: QuizStatus.DRAFT
    },
    create: {
      id: 'seed-cybersecurity-awareness',
      title: 'Cybersecurity Awareness',
      description: 'Seed quiz for local development',
      status: QuizStatus.DRAFT
    }
  });

  await prisma.question.upsert({
    where: { id: 'seed-question-passwords' },
    update: {
      quizId: quiz.id,
      order: 1,
      text: 'Which practice best protects a password?',
      explanation: 'Use a unique password for each account and store it in a password manager.',
      timerSeconds: 30,
      basePoints: 1000
    },
    create: {
      id: 'seed-question-passwords',
      quizId: quiz.id,
      order: 1,
      text: 'Which practice best protects a password?',
      explanation: 'Use a unique password for each account and store it in a password manager.',
      timerSeconds: 30,
      basePoints: 1000,
      options: {
        create: [
          { id: 'seed-option-unique', text: 'Use a unique password for every account', isCorrect: true },
          { id: 'seed-option-share', text: 'Share it with a trusted friend', isCorrect: false },
          { id: 'seed-option-reuse', text: 'Reuse one strong password everywhere', isCorrect: false }
        ]
      }
    }
  });
};

try {
  await seed();
} finally {
  await prisma.$disconnect();
}
