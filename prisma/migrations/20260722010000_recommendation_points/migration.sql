-- AlterTable — dipecah manual (bukan hasil generate mentah) supaya baris lama terkonversi,
-- bukan hilang: "content" (teks bebas multi-baris) menjadi "points" (satu poin per baris,
-- baris kosong dibuang), sejalan dgn precedent insight_points.
ALTER TABLE "Recommendation" ADD COLUMN "points" TEXT[];

UPDATE "Recommendation"
SET "points" = ARRAY(
  SELECT btrim(ln)
  FROM unnest(string_to_array("content", E'\n')) AS ln
  WHERE btrim(ln) <> ''
);

ALTER TABLE "Recommendation" DROP COLUMN "content";
