-- Tipe metrik "text" (Jul 2026) — nama produk/affiliator dari tabel screenshot.
-- Aditif & non-destruktif: hanya menambah nilai enum, tidak ada kolom/tabel baru.
-- Nilai teks menumpang kolom Extraction.rawText yang sudah ada (value tetap NULL).
ALTER TYPE "MetricType" ADD VALUE 'text';
