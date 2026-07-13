-- Fase B (gaya agency): default primer jadi hitam. Baris Theme existing ikut dipindah
-- HANYA bila masih bernilai default lama (founder yang sudah mengganti tidak disentuh).
ALTER TABLE "Theme" ALTER COLUMN "primaryColor" SET DEFAULT '111111';
UPDATE "Theme" SET "primaryColor" = '111111' WHERE "primaryColor" = '1F2937';
