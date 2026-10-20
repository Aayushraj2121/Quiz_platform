import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().min(1).default('http://localhost:3000'),
  // Supabase Storage — required for production media uploads
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('media'),
  // Keep upload limits
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(104_857_600),
  MAX_IMAGE_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),
  MAX_VIDEO_UPLOAD_BYTES: z.coerce.number().int().positive().default(104_857_600),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  MAX_JSON_BODY_SIZE: z.string().min(1).default('1mb')
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = {
  ...parsedEnv.data,
  CORS_ORIGINS: parsedEnv.data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
};

export type Environment = typeof env;
