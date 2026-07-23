-- Periode level report (Poin 2a, Jul 2026). ADITIF MURNI: dua kolom baru nullable.
-- reportPeriod & isPrimaryPeriod TIDAK disentuh (isPrimaryPeriod baru dibuang di 2c).
-- Backfill periodeUtama dari reportPeriod dilakukan TERPISAH (prisma/backfill-periode.ts),
-- karena butuh parser bulan Indonesia (lib/period-parser.ts) yang tak bisa jalan di SQL.
ALTER TABLE "Report" ADD COLUMN "periodeUtama" TEXT;
ALTER TABLE "Report" ADD COLUMN "periodePembanding" TEXT;
