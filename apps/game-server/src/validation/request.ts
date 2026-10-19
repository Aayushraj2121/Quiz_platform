import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodType } from 'zod';

export const validate = <T extends ZodType>(
  schema: T,
  source: 'body' | 'params' | 'query'
): RequestHandler => (request: Request, _response: Response, next: NextFunction) => {
  const parsed = schema.parse(request[source]);
  if (source !== 'query') {
    request[source] = parsed;
  }
  next();
};

export const idParamSchema = z.object({ id: z.string().trim().min(1).max(100) });
export const quizIdParamSchema = z.object({ id: z.string().trim().min(1).max(100) });

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200)
});

const optionSchema = z.object({
  id: z.string().cuid().optional(),
  text: z.string().trim().min(1).max(500),
  isCorrect: z.boolean()
});

export const optionsSchema = z
  .array(optionSchema)
  .min(2)
  .max(4)
  .refine((options) => options.filter((option) => option.isCorrect).length === 1, {
    message: 'Exactly one answer option must be correct',
    path: ['options']
  });

export const createQuizSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional()
});

export const updateQuizSchema = createQuizSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required'
});

const questionFields = {
  order: z.number().int().min(1),
  text: z.string().trim().min(1).max(10_000),
  explanation: z.string().trim().max(5_000).nullable().optional(),
  timerSeconds: z.number().int().min(10).max(120).optional(),
  basePoints: z.number().int().min(1).max(100_000).optional(),
  mediaAssetId: z.string().cuid().nullable().optional()
};

export const createQuestionSchema = z.object({
  ...questionFields,
  options: optionsSchema
});

export const updateQuestionSchema = z
  .object({ ...questionFields, options: optionsSchema.optional() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const createOptionSchema = optionSchema.omit({ id: true });
export const updateOptionSchema = createOptionSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required'
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
