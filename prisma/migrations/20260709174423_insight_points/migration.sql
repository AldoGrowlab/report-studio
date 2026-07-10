-- AlterTable — dipecah manual (bukan hasil generate mentah) supaya baris lama terkonversi,
-- bukan hilang: paragraf tunggal "content" menjadi satu poin di "points".
ALTER TABLE "Insight" ADD COLUMN "numbers" TEXT[],
ADD COLUMN     "points" TEXT[];

UPDATE "Insight" SET "points" = ARRAY["content"], "numbers" = ARRAY[]::TEXT[];

ALTER TABLE "Insight" DROP COLUMN "content";
