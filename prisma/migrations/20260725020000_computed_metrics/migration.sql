-- Hasil metrik turunan per report (Fase 2b). Aditif murni: satu tabel baru.
CREATE TABLE "ComputedMetric" (
    "id"          TEXT NOT NULL,
    "reportId"    TEXT NOT NULL,
    "sectionId"   TEXT NOT NULL,
    "subGroupKey" TEXT NOT NULL DEFAULT '_default',
    "key"         TEXT NOT NULL,
    "label"       TEXT NOT NULL,
    "unit"        TEXT NOT NULL DEFAULT 'percent',
    "value"       DOUBLE PRECISION,
    "status"      TEXT NOT NULL,
    "note"        TEXT,
    "numeratorValue"     DOUBLE PRECISION,
    "denominatorValue"   DOUBLE PRECISION,
    "numeratorRefText"   TEXT NOT NULL,
    "denominatorRefText" TEXT NOT NULL,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComputedMetric_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComputedMetric_reportId_sectionId_subGroupKey_key_key"
  ON "ComputedMetric"("reportId", "sectionId", "subGroupKey", "key");
ALTER TABLE "ComputedMetric"
  ADD CONSTRAINT "ComputedMetric_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
