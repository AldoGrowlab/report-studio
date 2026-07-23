import type { ExtractionStatus } from "@prisma/client";
import { cleanMetricText, MAX_TEXT_LENGTH } from "@/lib/text-metric";

// Tahap 5 — konfirmasi & koreksi manual angka ekstraksi.
// Titik presisi: hasil edit user PERSIST ke tabel Extraction (single source of truth),
// dipakai Analyst nanti. rawText & confidence asli TIDAK disentuh (provenance OCR).

export type ExtractionEditInput = { value: number | null };

export type ParseEditResult =
  | { ok: true; data: ExtractionEditInput }
  | { ok: false; error: string };

// Validasi body request edit/konfirmasi: { value: number | null }.
// - number: harus finite (tolak NaN/Infinity); string angka TIDAK diterima —
//   konversi tanggung jawab client, server ketat demi presisi.
// - null: user menyatakan angka memang tidak ada di foto (status -> missing).
export function parseExtractionEdit(body: unknown): ParseEditResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Permintaan tidak valid." };
  }
  const b = body as Record<string, unknown>;
  if (!("value" in b)) {
    return { ok: false, error: "Field value wajib ada (angka atau null)." };
  }
  const value = b.value;
  if (value === null) {
    return { ok: true, data: { value: null } };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: "Value harus berupa angka atau null." };
  }
  return { ok: true, data: { value } };
}

// Field yang ditulis ke Extraction saat user konfirmasi/koreksi.
// value null = metrik memang tidak ada -> missing; selain itu ok.
// manuallyConfirmed selalu true: angka sudah divetting manusia.
export function computeEditedFields(value: number | null): {
  value: number | null;
  status: ExtractionStatus;
  manuallyConfirmed: true;
} {
  return {
    value,
    status: value === null ? "missing" : "ok",
    manuallyConfirmed: true,
  };
}

// ---- Metrik bertipe TEKS (Jul 2026) ----
// Bedanya dengan angka: nilainya TINGGAL di rawText, jadi koreksi manual memang menimpa
// rawText (untuk metrik teks kolom itu bukan lagi provenance OCR murni — lihat
// docs/DESIGN.md §Tipe Metrik Teks). value dipaksa null: teks tidak pernah jadi angka.

export type ExtractionTextEditInput = { text: string | null };

export type ParseTextEditResult =
  | { ok: true; data: ExtractionTextEditInput }
  | { ok: false; error: string };

// Validasi body edit metrik teks: { rawText: string | null }.
// - string: ditrim, dibatasi MAX_TEXT_LENGTH, penanda potong di UJUNG dibuang
//   (aturan pembersihan SAMA dengan Extractor — satu helper dipakai berdua).
// - null / string kosong: user menyatakan teksnya memang tidak ada (status -> missing).
export function parseTextExtractionEdit(body: unknown): ParseTextEditResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Permintaan tidak valid." };
  }
  const b = body as Record<string, unknown>;
  if (!("rawText" in b)) {
    return { ok: false, error: "Field rawText wajib ada (teks atau null)." };
  }
  const raw = b.rawText;
  if (raw === null) {
    return { ok: true, data: { text: null } };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "rawText harus berupa teks atau null." };
  }
  if (raw.trim().length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `Teks maksimal ${MAX_TEXT_LENGTH} karakter.` };
  }
  return { ok: true, data: { text: cleanMetricText(raw) } };
}

export function computeEditedTextFields(text: string | null): {
  rawText: string | null;
  value: null;
  status: ExtractionStatus;
  manuallyConfirmed: true;
} {
  return {
    rawText: text,
    value: null,
    status: text === null ? "missing" : "ok",
    manuallyConfirmed: true,
  };
}
