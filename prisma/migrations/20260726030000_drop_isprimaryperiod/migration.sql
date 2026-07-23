-- Poin 2c (Jul 2026): buang flag periode-utama per foto. Status "periode utama" kini
-- TURUNAN dari pasangan bulan report (Report.periodeUtama). Tak ada konsumen yang membaca
-- kolom ini lagi (dibuktikan grep). Non-destruktif terhadap data lain.
ALTER TABLE "Upload" DROP COLUMN "isPrimaryPeriod";
