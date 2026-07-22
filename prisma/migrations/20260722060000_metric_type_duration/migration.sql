-- AlterEnum — tambah tipe metrik "duration" (durasi).
-- Aman & non-destruktif: hanya menambah nilai enum, tidak menyentuh baris yang ada.
ALTER TYPE "MetricType" ADD VALUE 'duration';
