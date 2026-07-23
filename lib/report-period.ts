import { formatMonthID, isValidPeriodMonth } from "@/lib/period";

// Periode di LEVEL REPORT (Poin 2, Jul 2026) — MURNI & deterministik, tanpa DB.
//
// Pasangan bulan (utama + pembanding opsional) ditetapkan sekali di level report; seluruh
// label bulan foto dan status "periode utama" per foto menjadi TURUNAN dari pasangan itu.
// Menggantikan flag `isPrimaryPeriod` per foto (dibuang di 2c).
//
// Bentuk kanonik = "YYYY-MM" (sama dengan Upload.periodMonth), supaya perbandingan
// `bulanFoto == periodeUtama` cukup kesetaraan string. Label Indonesia hanya saat ditampilkan.

export type PeriodPair = {
  periodeUtama: string | null; // "YYYY-MM" kanonik; null = belum ditetapkan
  periodePembanding: string | null; // "YYYY-MM" kanonik; null = tanpa pembanding
};

// Status "periode utama" foto = TURUNAN: bulan foto sama dengan periode utama report.
// Tak ada lagi flag tersimpan per foto.
export function isPrimaryMonth(pair: PeriodPair, periodMonth: string | null | undefined): boolean {
  return (
    typeof periodMonth === "string" &&
    pair.periodeUtama !== null &&
    periodMonth === pair.periodeUtama
  );
}

// Label bulan foto HANYA boleh salah satu dari pasangan (dropdown 2 pilihan; 1 bila
// pembanding kosong). Urutan: utama dulu, lalu pembanding.
export function periodMonthOptions(pair: PeriodPair): string[] {
  const out: string[] = [];
  if (pair.periodeUtama) out.push(pair.periodeUtama);
  if (pair.periodePembanding && pair.periodePembanding !== pair.periodeUtama) {
    out.push(pair.periodePembanding);
  }
  return out;
}

export type MonthMatch = "utama" | "pembanding" | "lain";

// Cocokkan satu bulan kanonik ke pasangan report. "lain" = bukan salah satu pasangan
// (dipakai deteksi bulan: rawText terparse ke bulan LAIN -> warning salah-bulan; dan
// deteksi anomali saat pasangan diubah -> label foto yang tak lagi cocok).
export function matchMonthToPair(
  pair: PeriodPair,
  periodMonth: string | null | undefined
): MonthMatch {
  if (typeof periodMonth !== "string") return "lain";
  if (pair.periodeUtama && periodMonth === pair.periodeUtama) return "utama";
  if (pair.periodePembanding && periodMonth === pair.periodePembanding) return "pembanding";
  return "lain";
}

// SATU-SATUNYA aturan tampilan periode report, dipakai di SEMUA tempat (cover PPT, nama
// berkas, filter, daftar): bulan kanonik dulu, lalu reportPeriod lama (label kustom yang
// deprecated & read-only), lalu fallback terakhir. Menjaga report lama ber-label kustom
// tampil PERSIS seperti sebelum perubahan.
export function displayReportPeriod(input: {
  periodeUtama: string | null;
  reportPeriod: string | null;
}): string {
  if (input.periodeUtama && isValidPeriodMonth(input.periodeUtama)) {
    return formatMonthID(input.periodeUtama);
  }
  const legacy = input.reportPeriod?.trim();
  if (legacy) return legacy;
  return "Periode belum ditentukan";
}
