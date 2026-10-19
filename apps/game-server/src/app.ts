import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.js';

export const createApp = () => {
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
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
