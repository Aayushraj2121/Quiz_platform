import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../middleware/auth.js';
import { createOption, createQuestion, deleteQuestion, getQuestion, listQuestions, updateOption, updateQuestion } from '../services/quiz-service.js';
import { createOptionSchema, createQuestionSchema, idParamSchema, quizIdParamSchema, updateOptionSchema, updateQuestionSchema, validate } from '../validation/request.js';

export const createQuestionRouter = (prisma: PrismaClient) => {
  const router = Router();
  router.use(requireAdmin(prisma));
  router.get('/quiz/:id', validate(quizIdParamSchema, 'params'), async (request, response) => {
    const { id } = quizIdParamSchema.parse(request.params);
    response.json({ success: true, data: await listQuestions(prisma, id) });
  });
  router.post('/quiz/:id', validate(quizIdParamSchema, 'params'), validate(createQuestionSchema, 'body'), async (request, response) => {
    const { id } = quizIdParamSchema.parse(request.params);
    response.status(201).json({ success: true, data: await createQuestion(prisma, id, request.body) });
  });
  router.get('/:id', validate(idParamSchema, 'params'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    response.json({ success: true, data: await getQuestion(prisma, id) });
  });
  router.patch('/:id', validate(idParamSchema, 'params'), validate(updateQuestionSchema, 'body'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    response.json({ success: true, data: await updateQuestion(prisma, id, request.body) });
  });
  router.delete('/:id', validate(idParamSchema, 'params'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    await deleteQuestion(prisma, id);
    response.status(200).json({ success: true, data: { id, deleted: true } });
  });
  router.post('/:id/options', validate(idParamSchema, 'params'), validate(createOptionSchema, 'body'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    response.status(201).json({ success: true, data: await createOption(prisma, id, request.body.text, request.body.isCorrect) });
  });
  router.patch('/options/:id', validate(idParamSchema, 'params'), validate(updateOptionSchema, 'body'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    response.json({ success: true, data: await updateOption(prisma, id, request.body.text, request.body.isCorrect) });
  });
  return router;
};
