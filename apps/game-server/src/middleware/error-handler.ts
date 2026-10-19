import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import multer from 'multer';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.path} was not found`
    }
  });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      success: false,
      error: {
        code: error.code === 'LIMIT_FILE_SIZE' ? 'MEDIA_TOO_LARGE' : 'MEDIA_UPLOAD_ERROR',
        message: error.code === 'LIMIT_FILE_SIZE' ? 'Uploaded media exceeds the configured size limit' : 'Media upload failed'
      }
    });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.flatten()
      }
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message
      }
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      response.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'The requested resource was not found' }
      });
      return;
    }

    if (error.code === 'P2002') {
      response.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'A resource with these values already exists' }
      });
      return;
    }
  }

  console.error(
    JSON.stringify({
      level: 'error',
      message: 'Unhandled request error',
      error: error instanceof Error ? error.message : String(error)
    })
  );

  response.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred'
    }
  });
};
