import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error-handler.js';
import type { CreateQuestionInput } from '../validation/request.js';

const quizSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { questions: true, sessions: true } }
} satisfies Prisma.QuizSelect;

const questionInclude = {
  options: { select: { id: true, text: true, isCorrect: true }, orderBy: { id: 'asc' as const } },
  mediaAsset: true
} satisfies Prisma.QuestionInclude;

export const listQuizzes = async (prisma: PrismaClient, page: number, pageSize: number) => {
  const skip = (page - 1) * pageSize;
  const [items, total] = await prisma.$transaction([
    prisma.quiz.findMany({ skip, take: pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: quizSelect }),
    prisma.quiz.count()
  ]);
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
};

export const getQuiz = async (prisma: PrismaClient, id: string) => {
  const quiz = await prisma.quiz.findUnique({
    where: { id },
    include: {
      questions: { orderBy: [{ order: 'asc' }, { id: 'asc' }], include: questionInclude }
    }
  });
  if (!quiz) throw new AppError(404, 'NOT_FOUND', 'Quiz not found');
  return quiz;
};

export const createQuiz = (prisma: PrismaClient, data: Prisma.QuizCreateInput) =>
  prisma.quiz.create({ data, select: quizSelect });

export const updateQuiz = async (prisma: PrismaClient, id: string, data: Prisma.QuizUpdateInput) => {
  await ensureQuiz(prisma, id);
  return prisma.quiz.update({ where: { id }, data, select: quizSelect });
};

export const deleteQuiz = async (prisma: PrismaClient, id: string) => {
  await ensureQuiz(prisma, id);
  await prisma.quiz.delete({ where: { id } });
};

export const ensureQuiz = async (prisma: PrismaClient, id: string) => {
  const quiz = await prisma.quiz.findUnique({ where: { id }, select: { id: true } });
  if (!quiz) throw new AppError(404, 'NOT_FOUND', 'Quiz not found');
  return quiz;
};

export const listQuestions = async (prisma: PrismaClient, quizId: string) => {
  await ensureQuiz(prisma, quizId);
  return prisma.question.findMany({
    where: { quizId },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
    include: questionInclude
  });
};

export const getQuestion = async (prisma: PrismaClient, id: string) => {
  const question = await prisma.question.findUnique({ where: { id }, include: questionInclude });
  if (!question) throw new AppError(404, 'NOT_FOUND', 'Question not found');
  return question;
};

export const createQuestion = async (prisma: PrismaClient, quizId: string, data: CreateQuestionInput) => {
  await ensureQuiz(prisma, quizId);
  return prisma.$transaction(async (transaction) => {
    const { options, ...question } = data;
    const createData: Prisma.QuestionCreateInput = {
      quiz: { connect: { id: quizId } },
      order: question.order,
      text: question.text,
      ...(question.explanation === undefined ? {} : { explanation: question.explanation }),
      ...(question.timerSeconds === undefined ? {} : { timerSeconds: question.timerSeconds }),
      ...(question.basePoints === undefined ? {} : { basePoints: question.basePoints }),
      ...(question.mediaAssetId === undefined || question.mediaAssetId === null
        ? {}
        : { mediaAsset: { connect: { id: question.mediaAssetId } } }),
      options: { create: options.map(({ text, isCorrect }) => ({ text, isCorrect })) }
    };
    return transaction.question.create({
      data: createData,
      include: questionInclude
    });
  });
};

export const updateQuestion = async (
  prisma: PrismaClient,
  id: string,
  data: Omit<CreateQuestionInput, 'options'> & { options?: CreateQuestionInput['options'] }
) => {
  await getQuestion(prisma, id);
  return prisma.$transaction(async (transaction) => {
    const { options, ...question } = data;
    if (options) {
      await transaction.questionOption.deleteMany({ where: { questionId: id } });
    }
    const updateData: Prisma.QuestionUpdateInput = {
      ...(question.order === undefined ? {} : { order: question.order }),
      ...(question.text === undefined ? {} : { text: question.text }),
      ...(question.explanation === undefined ? {} : { explanation: question.explanation }),
      ...(question.timerSeconds === undefined ? {} : { timerSeconds: question.timerSeconds }),
      ...(question.basePoints === undefined ? {} : { basePoints: question.basePoints }),
      ...(question.mediaAssetId === undefined ? {} : { mediaAsset: question.mediaAssetId === null ? { disconnect: true } : { connect: { id: question.mediaAssetId } } }),
      ...(options ? { options: { create: options.map(({ text, isCorrect }) => ({ text, isCorrect })) } } : {})
    };
    return transaction.question.update({
      where: { id },
      data: updateData,
      include: questionInclude
    });
  });
};

export const deleteQuestion = async (prisma: PrismaClient, id: string) => {
  await getQuestion(prisma, id);
  await prisma.question.delete({ where: { id } });
};

export const createOption = async (prisma: PrismaClient, questionId: string, text: string, isCorrect: boolean) => {
  const question = await getQuestion(prisma, questionId);
  if (question.options.length >= 4) throw new AppError(400, 'INVALID_OPTIONS', 'A question cannot have more than four options');
  if (isCorrect && question.options.some((option) => option.isCorrect)) {
    throw new AppError(400, 'INVALID_OPTIONS', 'A question can have only one correct option');
  }
  return prisma.questionOption.create({ data: { questionId, text, isCorrect } });
};

export const updateOption = async (prisma: PrismaClient, id: string, text?: string, isCorrect?: boolean) => {
  const option = await prisma.questionOption.findUnique({ where: { id }, include: { question: { include: { options: true } } } });
  if (!option) throw new AppError(404, 'NOT_FOUND', 'Answer option not found');
  if (isCorrect === true && option.question.options.some((item) => item.isCorrect && item.id !== id)) {
    throw new AppError(400, 'INVALID_OPTIONS', 'A question can have only one correct option');
  }
  if (isCorrect === false && option.isCorrect && !option.question.options.some((item) => item.isCorrect && item.id !== id)) {
    throw new AppError(400, 'INVALID_OPTIONS', 'A question must have exactly one correct option');
  }
  return prisma.questionOption.update({ where: { id }, data: { ...(text === undefined ? {} : { text }), ...(isCorrect === undefined ? {} : { isCorrect }) } });
};
