import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import multer from 'multer';
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { requireAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import { validate } from '../validation/request.js';
import { idParamSchema } from '../validation/request.js';

// ── Supabase Storage client (service-role key bypasses RLS) ──────────────────
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

// ── Allowed MIME types and their extensions ───────────────────────────────────
const allowedTypes = new Map([
  ['image/png',  ['.png']],
  ['image/jpeg', ['.jpg', '.jpeg']],
  ['image/gif',  ['.gif']],
  ['image/webp', ['.webp']],
  ['video/mp4',  ['.mp4']],
  ['video/webm', ['.webm']]
]);

// ── Multer: keep file in RAM, validate size + MIME before reaching the route ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, allowedTypes.has(file.mimetype))
});

// ── Magic-byte validation (prevents content-type spoofing) ────────────────────
const hasExpectedSignature = (buffer: Buffer, mimeType: string): boolean => {
  if (mimeType === 'image/png')  return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/jpeg') return buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mimeType === 'image/gif')  return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'video/mp4')  return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  return mimeType === 'video/webm' && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
};

// ── Validate extension matches MIME type ──────────────────────────────────────
const safeExtension = (originalName: string, mimeType: string): string => {
  const extension = extname(basename(originalName)).toLowerCase();
  const allowed = allowedTypes.get(mimeType) ?? [];
  if (!allowed.includes(extension)) throw new AppError(400, 'UNSUPPORTED_MEDIA', 'File extension does not match its media type');
  return extension;
};

// ── Get public URL for a storage key ─────────────────────────────────────────
const getPublicUrl = (storageKey: string): string => {
  const { data } = supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).getPublicUrl(storageKey);
  return data.publicUrl;
};

export const createMediaRouter = (prisma: PrismaClient) => {
  const router = Router();

  // ── GET /api/media/:id — redirect to Supabase CDN public URL ───────────────
  router.get('/:id', validate(idParamSchema, 'params'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    const asset = await prisma.mediaAsset.findUnique({
      where: { id },
      select: { storageKey: true, mimeType: true }
    });
    if (!asset) throw new AppError(404, 'NOT_FOUND', 'Media asset not found');

    // Permanent redirect to Supabase CDN — browser caches the image URL directly
    const publicUrl = getPublicUrl(asset.storageKey);
    response.redirect(301, publicUrl);
  });

  // ── All routes below require admin auth ───────────────────────────────────
  router.use(requireAdmin(prisma));

  // ── POST /api/media/questions/:id — upload image/video to Supabase Storage ─
  router.post('/questions/:id', validate(idParamSchema, 'params'), upload.single('file'), async (request, response) => {
    const { id: questionId } = idParamSchema.parse(request.params);
    const file = request.file;
    if (!file) throw new AppError(400, 'MEDIA_REQUIRED', 'A media file is required');

    // Per-type size check
    const maxBytes = file.mimetype.startsWith('image/') ? env.MAX_IMAGE_UPLOAD_BYTES : env.MAX_VIDEO_UPLOAD_BYTES;
    if (file.size > maxBytes) throw new AppError(413, 'MEDIA_TOO_LARGE', 'Uploaded media exceeds the configured size limit');

    // Magic-byte validation
    if (!hasExpectedSignature(file.buffer, file.mimetype)) throw new AppError(400, 'UNSUPPORTED_MEDIA', 'File content does not match its media type');

    const extension = safeExtension(file.originalname, file.mimetype);

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      select: { id: true, mediaAssetId: true }
    });
    if (!question) throw new AppError(404, 'NOT_FOUND', 'Question not found');

    // Build a unique storage key: "media/<uuid>.<ext>"
    const storageKey = `media/${randomUUID()}${extension}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(env.SUPABASE_STORAGE_BUCKET)
      .upload(storageKey, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      throw new AppError(500, 'MEDIA_UPLOAD_ERROR', `Supabase Storage upload failed: ${uploadError.message}`);
    }

    try {
      const asset = await prisma.$transaction(async (transaction) => {
        // Remove the previous media asset for this question if one exists
        if (question.mediaAssetId) {
          const oldAsset = await transaction.mediaAsset.findUnique({
            where: { id: question.mediaAssetId },
            select: { storageKey: true }
          });
          await transaction.question.update({ where: { id: questionId }, data: { mediaAssetId: null } });
          await transaction.mediaAsset.delete({ where: { id: question.mediaAssetId } });
          // Best-effort delete old file from Supabase Storage
          if (oldAsset) {
            await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).remove([oldAsset.storageKey]);
          }
        }

        const created = await transaction.mediaAsset.create({
          data: {
            storageKey,
            mediaType: file.mimetype.startsWith('image/') ? 'IMAGE' : 'VIDEO',
            originalName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size
          }
        });

        await transaction.question.update({
          where: { id: questionId },
          data: { mediaAssetId: created.id }
        });

        return created;
      });

      response.status(201).json({
        success: true,
        data: {
          id: asset.id,
          originalName: asset.originalName,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          url: getPublicUrl(asset.storageKey)
        }
      });
    } catch (error) {
      // Roll back the storage upload if the DB transaction failed
      await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).remove([storageKey]);
      throw error;
    }
  });

  // ── DELETE /api/media/:id — remove from Storage + DB ─────────────────────
  router.delete('/:id', validate(idParamSchema, 'params'), async (request, response) => {
    const { id } = idParamSchema.parse(request.params);
    const asset = await prisma.mediaAsset.findUnique({
      where: { id },
      select: { id: true, storageKey: true, question: { select: { id: true } } }
    });
    if (!asset) throw new AppError(404, 'NOT_FOUND', 'Media asset not found');

    await prisma.$transaction([
      prisma.question.updateMany({ where: { mediaAssetId: id }, data: { mediaAssetId: null } }),
      prisma.mediaAsset.delete({ where: { id } })
    ]);

    // Best-effort delete from Supabase Storage
    await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).remove([asset.storageKey]);

    response.status(204).send();
  });

  return router;
};
