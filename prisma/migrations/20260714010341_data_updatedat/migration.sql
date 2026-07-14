-- Audit P2: jejak waktu perubahan data untuk deteksi insight basi. Baris lama di-backfill
-- epoch (belum berubah sejak insight dibuat -> tidak memicu badge basi palsu). Default
-- di-DROP setelah backfill supaya Prisma @updatedAt (app-managed) yang mengelola ke depan.
ALTER TABLE "Extraction" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00';
ALTER TABLE "Extraction" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Upload" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00';
ALTER TABLE "Upload" ALTER COLUMN "updatedAt" DROP DEFAULT;
