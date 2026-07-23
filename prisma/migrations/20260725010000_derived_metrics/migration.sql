-- Metrik turunan (Fase 2a, Jul 2026). Aditif murni: satu tabel baru, tidak ada kolom
-- atau constraint lama yang disentuh.
CREATE TABLE "DerivedMetric" (
    "id"          TEXT NOT NULL,
    "sectionId"   TEXT NOT NULL,
    "subGroupKey" TEXT NOT NULL DEFAULT '_default',
    "key"         TEXT NOT NULL,
    "label"       TEXT NOT NULL,
    "unit"        TEXT NOT NULL DEFAULT 'percent',
    "notes"       TEXT,
    "order"       INTEGER NOT NULL DEFAULT 0,
    "numeratorPlatform"      "Platform" NOT NULL,
    "numeratorSection"       TEXT NOT NULL,
    "numeratorSubGroupKey"   TEXT NOT NULL DEFAULT '_default',
    "numeratorMetricKey"     TEXT NOT NULL,
    "denominatorPlatform"    "Platform" NOT NULL,
    "denominatorSection"     TEXT NOT NULL,
    "denominatorSubGroupKey" TEXT NOT NULL DEFAULT '_default',
    "denominatorMetricKey"   TEXT NOT NULL,
    CONSTRAINT "DerivedMetric_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DerivedMetric_sectionId_subGroupKey_key_key"
  ON "DerivedMetric"("sectionId", "subGroupKey", "key");
ALTER TABLE "DerivedMetric"
  ADD CONSTRAINT "DerivedMetric_sectionId_fkey"
  FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
