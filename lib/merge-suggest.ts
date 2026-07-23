import { MIN_REMAINING, type MergeDirection, type Trim } from "@/lib/merge-images";

// Auto-potong (AI) untuk Gabung Foto (Jul 2026).
//
// Peran AI di sini SEMPIT dan disengaja: ia hanya MENGISI SARAN nilai trim ke kontrol yang
// sudah ada. Crop + penggabungan tetap dieksekusi deterministik di client lewat
// lib/merge-images.ts, dan preview tetap gerbang keputusan operator — model tidak pernah
// menyimpan apa pun sendiri. Sejalan Prinsip #1: yang menyentuh bahan angka wajib bisa
// diperiksa mata manusia sebelum dipakai.
//
// Prioritas nilai trim saat modal dibuka: preset localStorage > tombol Auto-potong > 0.
// Hasil AI yang disimpan operator otomatis jadi preset bulan berikutnya — jadi biaya
// analisisnya sekali per section, bukan tiap bulan.

// Foto dikecilkan SEBELUM dikirim ke model: yang dianalisis cuma tata letak (mana blok yang
// terulang), bukan angka, jadi 1200px sudah cukup dan hemat token. Fraksi yang dikembalikan
// berlaku ke resolusi ASLI di client — itu keuntungan menyimpan trim sebagai fraksi.
export const ANALYSIS_MAX_PX = 1200;

// Atap saran AI per sisi. Model yang keliru membaca satu foto sebagai "hampir seluruhnya
// duplikat" akan membuang data yang tak tergantikan; 0.7 memberi ruang untuk kasus nyata
// (kolom beku ~56%, grafik ~44%) tanpa membuka pintu ke pemangkasan ekstrem.
export const MAX_AI_TRIM = 0.7;

// Bentuk KAWAT (sama dengan keluaran model) supaya tidak ada penerjemahan nama field
// diam-diam antara model, endpoint, dan client. Client mengubahnya ke Trim lewat helper.
export type PhotoSuggestion = {
  trimTop: number;
  trimBottom: number;
  trimLeft: number;
  trimRight: number;
};

const NO_SUGGESTION: PhotoSuggestion = { trimTop: 0, trimBottom: 0, trimLeft: 0, trimRight: 0 };

export function suggestionToTrim(p: PhotoSuggestion): Trim {
  return { top: p.trimTop, bottom: p.trimBottom, left: p.trimLeft, right: p.trimRight };
}

export type MergeSuggestion = {
  direction: MergeDirection;
  photos: PhotoSuggestion[];
  confidence: number;
  reason: string;
};

const clamp01 = (v: unknown, max: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.min(max, Math.max(0, n));
};

// Keluaran model -> saran yang aman dipakai. TIDAK pernah melempar: saran yang tak masuk
// akal diturunkan jadi "tanpa potong" (lebih baik hasil dobel daripada data terbuang).
export function sanitizeSuggestion(
  raw: unknown,
  count: number,
  hint?: MergeDirection
): MergeSuggestion {
  const fallback: MergeSuggestion = {
    direction: hint ?? "vertical",
    photos: Array.from({ length: count }, () => ({ ...NO_SUGGESTION })),
    confidence: 0,
    reason: "",
  };
  if (typeof raw !== "object" || raw === null) return fallback;
  const r = raw as Record<string, unknown>;

  const direction: MergeDirection =
    r.direction === "vertical" || r.direction === "horizontal" ? r.direction : fallback.direction;

  const confidence = clamp01(r.confidence, 1);
  const reason = typeof r.reason === "string" ? r.reason.trim().slice(0, 300) : "";

  const list = Array.isArray(r.photos) ? r.photos : null;
  // Jumlah tidak cocok = model salah memahami permintaan; jangan tebak-tebak pasangannya.
  if (!list || list.length !== count) {
    return { direction, photos: fallback.photos, confidence, reason };
  }

  const photos = list.map((item) => {
    const p = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const trim: PhotoSuggestion = {
      trimTop: clamp01(p.trimTop, MAX_AI_TRIM),
      trimBottom: clamp01(p.trimBottom, MAX_AI_TRIM),
      trimLeft: clamp01(p.trimLeft, MAX_AI_TRIM),
      trimRight: clamp01(p.trimRight, MAX_AI_TRIM),
    };
    // Menyisakan < 10% pada sumbu mana pun = saran ditolak untuk foto itu (bukan
    // dipaksa masuk batas): potongan sedalam itu hampir pasti salah baca.
    if (
      1 - trim.trimTop - trim.trimBottom < MIN_REMAINING ||
      1 - trim.trimLeft - trim.trimRight < MIN_REMAINING
    ) {
      return { ...NO_SUGGESTION };
    }
    return trim;
  });

  return { direction, photos, confidence, reason };
}
