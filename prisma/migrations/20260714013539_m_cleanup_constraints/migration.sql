-- Audit M3/M7/M8 — pembersihan skema:
-- M3: buang kolom denormalisasi mati Upload.reportPeriod (hanya ditulis, tak pernah dibaca).
ALTER TABLE "Upload" DROP COLUMN "reportPeriod";
-- M7: satu bulan satu foto per (report, section) di level DB (NULL = distinct, non-perbandingan bebas).
CREATE UNIQUE INDEX "Upload_reportId_sectionId_periodMonth_key" ON "Upload"("reportId", "sectionId", "periodMonth");
-- M8: cegah dua baris KbVersion versi sama per section (race generate insight).
CREATE UNIQUE INDEX "KbVersion_sectionId_version_key" ON "KbVersion"("sectionId", "version");
