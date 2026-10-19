import { z } from 'zod';

export const sessionIdParamSchema = z.object({ id: z.string().trim().min(1).max(100) });

export const createSessionSchema = z.object({
  quizId: z.string().trim().min(1).max(100)
});

export const updateSessionStatusSchema = z.object({
  status: z.enum(['LOBBY', 'QUESTION', 'REVEAL', 'LEADERBOARD', 'PODIUM', 'ENDED'])
});

export const joinSessionSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320).optional(),
  studentId: z.string().trim().min(1).max(100).optional()
});

export const sessionPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});
