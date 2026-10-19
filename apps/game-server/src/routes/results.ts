import { Router } from 'express';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAdmin, requireSessionAccess } from '../middleware/auth.js';
import { validate } from '../validation/request.js';
import { sessionIdParamSchema } from '../validation/session.js';
import { getParticipantResults, getSessionResults, getExportRows, getSummaryExportRows } from '../services/results-service.js';

const csvEscape = (value: unknown): string => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const createResultsRouter = (prisma: PrismaClient) => {
  const router = Router();
  const sessionResults = async (request: Request, response: Response) => {
    const { id } = sessionIdParamSchema.parse(request.params);
    response.json({
      success: true,
      data: request.admin ? await getSessionResults(prisma, id) : await getParticipantResults(prisma, id, request.participant!.id)
    });
  };
  router.get('/sessions/:id', requireSessionAccess(prisma), validate(sessionIdParamSchema, 'params'), sessionResults);
  router.get('/:id', requireSessionAccess(prisma), validate(sessionIdParamSchema, 'params'), sessionResults);
  const exportResults = async (request: Request, response: Response) => {
    const { id } = sessionIdParamSchema.parse(request.params);
    const detail = request.query.detail === '1';
    const rows = detail ? await getExportRows(prisma, id) : await getSummaryExportRows(prisma, id);
    const headers = detail
      ? ['participantIdentifier', 'displayName', 'email', 'studentId', 'totalScore', 'correctCount', 'questionOrder', 'question', 'selectedOption', 'isCorrect', 'awardedPoints', 'responseTimeMs', 'submittedAt']
      : ['participantIdentifier', 'displayName', 'email', 'studentId', 'totalScore', 'correctCount', 'streak', 'answerCount', 'joinedAt'];
    response.status(200);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="session-${id}-results.csv"`);
    response.write(`${headers.join(',')}\r\n`);
    for (const row of rows) response.write(`${headers.map((header) => csvEscape(row[header as keyof typeof row])).join(',')}\r\n`);
    response.end();
  };
  router.get('/sessions/:id/export.csv', requireAdmin(prisma), validate(sessionIdParamSchema, 'params'), exportResults);
  router.get('/:id/export', requireAdmin(prisma), validate(sessionIdParamSchema, 'params'), exportResults);
  return router;
};
