import type { ExtractionStatus } from "@prisma/client";

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
