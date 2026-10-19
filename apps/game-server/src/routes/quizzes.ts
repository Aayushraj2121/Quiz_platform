import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/auth.js';
import { createQuiz, deleteQuiz, getQuiz, listQuizzes, updateQuiz } from '../services/quiz-service.js';
import { createQuizSchema, idParamSchema, paginationSchema, updateQuizSchema, validate } from '../validation/request.js';

export const createQuizRouter = (prisma: PrismaClient) => {
  const router = Router();
  router.use(requireAdmin(prisma));
  router.get('/', validate(paginationSchema, 'query'), async (request, response) => {
    const { page, pageSize } = paginationSchema.parse(request.query);
    const result = await listQuizzes(prisma, page, pageSize);
    response.json({ success: true, data: result });
  });
  router.post('/', validate(createQuizSchema, 'body'), async (request, response) => {
    const quiz = await createQuiz(prisma, request.body);
    response.status(201).json({ success: true, data: quiz });
  });
  router.get('/:id', validate(idParamSchema, 'params'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    response.json({ success: true, data: await getQuiz(prisma, id) });
  });
  router.patch('/:id', validate(idParamSchema, 'params'), validate(updateQuizSchema, 'body'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    response.json({ success: true, data: await updateQuiz(prisma, id, request.body) });
  });
  router.delete('/:id', validate(idParamSchema, 'params'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    await deleteQuiz(prisma, id);
    response.status(204).send();
  });
  return router;
};
