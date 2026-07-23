-- Sub-grup section (Fase 1, Jul 2026). Aditif; data lama TIDAK berubah makna.

-- Tabel sub-grup. Section tanpa baris di sini = perilaku lama (sub-grup tunggal implisit).
CREATE TABLE "SectionSubGroup" (
    "id"        TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "key"       TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "aliases"   TEXT[],
    "order"     INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SectionSubGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SectionSubGroup_sectionId_key_key" ON "SectionSubGroup"("sectionId", "key");
ALTER TABLE "SectionSubGroup"
  ADD CONSTRAINT "SectionSubGroup_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sub-grup pemilik tiap metrik & foto. NOT NULL dengan sentinel: Postgres memperlakukan
-- NULL sebagai saling berbeda di unique constraint, jadi kolom nullable akan diam-diam
-- mencabut proteksi duplikat foto pada section lama. DEFAULT mengisi baris lama otomatis.
ALTER TABLE "SectionMetric" ADD COLUMN "subGroupKey" TEXT NOT NULL DEFAULT '_default';
ALTER TABLE "Upload"        ADD COLUMN "subGroupKey" TEXT NOT NULL DEFAULT '_default';

-- "Satu bulan satu foto" kini per (report, section, SUB-GRUP): Flash Sale Juni dan
-- Voucher Juni di section yang sama adalah dua foto SAH. Constraint lama akan menolak
-- yang kedua. Hanya MELONGGARKAN — tak ada baris lama yang jadi melanggar.
ALTER TABLE "Upload" DROP CONSTRAINT IF EXISTS "Upload_reportId_sectionId_periodMonth_key";
DROP INDEX IF EXISTS "Upload_reportId_sectionId_periodMonth_key";
CREATE UNIQUE INDEX "Upload_reportId_sectionId_subGroupKey_periodMonth_key"
  ON "Upload"("reportId", "sectionId", "subGroupKey", "periodMonth");
