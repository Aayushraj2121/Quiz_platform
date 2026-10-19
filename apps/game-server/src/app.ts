import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { prisma as defaultPrisma } from './db/client.js';
import type { PrismaClient } from '@prisma/client';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';
import { createAdminRouter } from './routes/admin.js';
import { createQuestionRouter } from './routes/questions.js';
import { createQuizRouter } from './routes/quizzes.js';
import { createSessionRouter } from './routes/sessions.js';
import { createResultsRouter } from './routes/results.js';
import { createMediaRouter } from './routes/media.js';
import { createCertificateRouter } from './routes/certificates.js';

export const createApp = (prisma: PrismaClient = defaultPrisma) => {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true
    })
  );
  app.use(express.json({ limit: env.MAX_JSON_BODY_SIZE }));
  app.use(express.urlencoded({ extended: false, limit: env.MAX_JSON_BODY_SIZE }));

  app.use('/api', healthRouter);
  app.use('/api/admin', createAdminRouter(prisma));
  app.use('/api/quizzes', createQuizRouter(prisma));
  app.use('/api/questions', createQuestionRouter(prisma));
  app.use('/api/sessions', createSessionRouter(prisma));
  app.use('/api/results', createResultsRouter(prisma));
  app.use('/api/media', createMediaRouter(prisma));
  app.use('/api/cert', createCertificateRouter(prisma));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
