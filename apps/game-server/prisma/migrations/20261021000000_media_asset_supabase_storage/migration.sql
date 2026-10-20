-- Rename filePath → storageKey on MediaAsset
-- Previously stored absolute local filesystem paths (e.g. /Users/.../uploads/uuid.jpg).
-- Now stores Supabase Storage object keys (e.g. media/uuid.jpg).
-- Existing rows with old local paths will return 404 until re-uploaded via the admin console.
ALTER TABLE "MediaAsset" RENAME COLUMN "filePath" TO "storageKey";
