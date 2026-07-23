-- Deteksi Bulan Otomatis (Jul 2026). Aditif & non-destruktif: tidak ada data lama yang
-- diubah atau dihapus. Melepas NOT NULL selalu aman untuk baris yang sudah ada.

-- Periode report jadi opsional supaya report bisa dibuat lebih dulu lalu bulannya terisi
-- dari teks periode yang terbaca di screenshot.
ALTER TABLE "Report" ALTER COLUMN "reportPeriod" DROP NOT NULL;

-- true = reportPeriod hasil deteksi (badge di UI). Edit manual mengembalikannya ke false.
ALTER TABLE "Report" ADD COLUMN "periodDetected" BOOLEAN NOT NULL DEFAULT false;

-- Jejak deteksi per foto: teks apa adanya + hasil pemetaan parser ("YYYY-MM").
ALTER TABLE "Upload" ADD COLUMN "detectedPeriodRaw" TEXT;
ALTER TABLE "Upload" ADD COLUMN "detectedPeriodMonth" TEXT;
