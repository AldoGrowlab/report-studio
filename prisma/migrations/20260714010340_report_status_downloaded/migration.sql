-- Audit P5: nilai enum baru untuk transisi status saat PPT pertama diunduh.
-- ADD VALUE aman & idempoten; tidak dipakai di migrasi ini (hanya menambah).
ALTER TYPE "ReportStatus" ADD VALUE IF NOT EXISTS 'downloaded';
