import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import multer from 'multer';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { requireAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import { validate } from '../validation/request.js';
import { idParamSchema } from '../validation/request.js';

const allowedTypes = new Map([
  ['image/png', ['.png']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/gif', ['.gif']],
  ['image/webp', ['.webp']],
  ['video/mp4', ['.mp4']],
  ['video/webm', ['.webm']]
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => callback(null, allowedTypes.has(file.mimetype))
});

const hasExpectedSignature = (buffer: Buffer, mimeType: string): boolean => {
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mimeType === 'image/gif') return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'video/mp4') return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  return mimeType === 'video/webm' && buffer.subarray(0, 4).toString('ascii') === '\x1aE\xdf\xa3';
};

const safeExtension = (originalName: string, mimeType: string): string => {
  const extension = extname(basename(originalName)).toLowerCase();
  const allowed = allowedTypes.get(mimeType) ?? [];
  if (!allowed.includes(extension)) throw new AppError(400, 'UNSUPPORTED_MEDIA', 'File extension does not match its media type');
  return extension;
};

export const createMediaRouter = (prisma: PrismaClient) => {
  const router = Router();
  router.get('/:id', validate(idParamSchema, 'params'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { filePath: true, mimeType: true } });
    if (!asset) throw new AppError(404, 'NOT_FOUND', 'Media asset not found');
    const uploadRoot = resolve(env.UPLOAD_DIR);
    const filePath = resolve(asset.filePath);
    const fileRelativePath = relative(uploadRoot, filePath);
    if (fileRelativePath.startsWith('..') || fileRelativePath.includes('..' + '/')) {
      throw new AppError(404, 'NOT_FOUND', 'Media asset not found');
    }
    response.type(asset.mimeType).sendFile(filePath, (error) => {
      const statusCode = error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
      if (error && !response.headersSent) response.status(statusCode === 404 ? 404 : 500).json({ success: false, error: { code: 'MEDIA_UNAVAILABLE', message: 'Media asset is unavailable' } });
    });
  });
  router.use(requireAdmin(prisma));
  router.post('/questions/:id', validate(idParamSchema, 'params'), upload.single('file'), async (request, response) => {
    const { id: questionId } = idParamSchema.parse(request.params);
    const file = request.file;
    if (!file) throw new AppError(400, 'MEDIA_REQUIRED', 'A media file is required');
    const maxBytes = file.mimetype.startsWith('image/') ? env.MAX_IMAGE_UPLOAD_BYTES : env.MAX_VIDEO_UPLOAD_BYTES;
    if (file.size > maxBytes) throw new AppError(413, 'MEDIA_TOO_LARGE', 'Uploaded media exceeds the configured size limit');
    if (!hasExpectedSignature(file.buffer, file.mimetype)) throw new AppError(400, 'UNSUPPORTED_MEDIA', 'File content does not match its media type');
    const extension = safeExtension(file.originalname, file.mimetype);
    const question = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true, mediaAssetId: true } });
    if (!question) throw new AppError(404, 'NOT_FOUND', 'Question not found');
    const directory = resolve(env.UPLOAD_DIR);
    await mkdir(directory, { recursive: true });
    const fileName = `${randomUUID()}${extension}`;
    const filePath = join(directory, fileName);
    await writeFile(filePath, file.buffer, { flag: 'wx' });
    try {
      const asset = await prisma.$transaction(async (transaction) => {
        if (question.mediaAssetId) {
          await transaction.question.update({ where: { id: questionId }, data: { mediaAssetId: null } });
          await transaction.mediaAsset.delete({ where: { id: question.mediaAssetId } });
        }
        const created = await transaction.mediaAsset.create({
          data: {
            filePath,
            mediaType: file.mimetype.startsWith('image/') ? 'IMAGE' : 'VIDEO',
            originalName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size
          }
        });
        await transaction.question.update({ where: { id: questionId }, data: { mediaAssetId: created.id } });
        return created;
      });
      response.status(201).json({ success: true, data: { id: asset.id, originalName: asset.originalName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes } });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  });
  router.delete('/:id', validate(idParamSchema, 'params'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    const asset = await prisma.mediaAsset.findUnique({ where: { id }, select: { id: true, filePath: true, question: { select: { id: true } } } });
    if (!asset) throw new AppError(404, 'NOT_FOUND', 'Media asset not found');
    await prisma.$transaction([
      prisma.question.updateMany({ where: { mediaAssetId: id }, data: { mediaAssetId: null } }),
      prisma.mediaAsset.delete({ where: { id } })
    ]);
    await unlink(asset.filePath).catch(() => undefined);
    response.status(204).send();
  });
  return router;
};
