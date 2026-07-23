import { computeRatioPercent, formatRef, type MetricRef } from "@/lib/derived";

// Penyelesaian operan metrik turunan — MURNI & deterministik, tanpa DB dan tanpa model.
// Dipisah dari lib/derived-compute.ts (yang menyentuh Prisma) supaya seluruh aturan
// pemilihan nilai bisa diuji tanpa database.

export type OperandPhoto = {
  // Foto yang menjadi kandidat sumber nilai operan.
  isPrimary: boolean;
  value: number | null;
  hasMetric: boolean; // metrik itu ADA barisnya di foto ini (walau nilainya null)
};

export type OperandResolution =
  | { status: "ok"; value: number }
  | { status: "menunggu" | "ambigu"; note: string };

// Nilai satu operan dari foto-foto satu (section, sub-grup) dalam satu report.
//
// ATURAN PEMILIHAN — sengaja TIDAK pernah menjumlah:
// - section ber-perbandingan-periode: pakai foto PERIODE UTAMA (fokus cerita);
// - selain itu: harus TEPAT SATU foto. Lebih dari satu foto = "sumber terpisah" yang
//   menurut DESIGN tak boleh digabung/dijumlah, jadi nilainya tak bisa ditentukan dan
//   hasilnya ditandai ambigu — bukan dijumlah diam-diam.
export function resolveOperand(
  ref: MetricRef,
  photos: OperandPhoto[],
  usesPeriodComparison: boolean
): OperandResolution {
  const label = formatRef(ref);
  if (photos.length === 0) {
    return { status: "menunggu", note: `menunggu ${label} — belum ada fotonya.` };
  }

  const candidates = usesPeriodComparison ? photos.filter((p) => p.isPrimary) : photos;

  if (usesPeriodComparison && candidates.length !== 1) {
    return {
      status: "ambigu",
      note: `${label} belum punya tepat satu foto periode utama — tandai dulu.`,
    };
  }
  if (!usesPeriodComparison && candidates.length > 1) {
    return {
      status: "ambigu",
      note:
        `${label} punya ${candidates.length} foto sebagai sumber TERPISAH — nilainya tak bisa ` +
        `ditentukan tanpa menjumlah, dan menjumlah sumber terpisah dilarang.`,
    };
  }

  const picked = candidates[0];
  if (!picked || !picked.hasMetric) {
    return { status: "menunggu", note: `menunggu ${label} — belum diekstrak.` };
  }
  if (picked.value === null || !Number.isFinite(picked.value)) {
    return { status: "menunggu", note: `menunggu ${label} — angkanya belum ada.` };
  }
  return { status: "ok", value: picked.value };
}

export type DerivedOutcome = {
  status: "ok" | "menunggu" | "penyebut_nol" | "ambigu";
  value: number | null;
  note: string | null;
  numeratorValue: number | null;
  denominatorValue: number | null;
};

// Gabungkan dua operan jadi hasil akhir. NaN/Infinity tak pernah bisa lolos ke `value`
// karena computeRatioPercent mengembalikan null untuk keduanya.
export function resolveDerived(
  numerator: OperandResolution,
  denominator: OperandResolution,
  denominatorRef: MetricRef
): DerivedOutcome {
  const numValue = numerator.status === "ok" ? numerator.value : null;
  const denValue = denominator.status === "ok" ? denominator.value : null;

  // Operan belum siap -> metrik TIDAK jadi fakta. Catatannya menyebut ref yang kurang,
  // dan begitu operannya tersedia, hitung-ulang berikutnya memunculkannya otomatis.
  for (const side of [numerator, denominator]) {
    if (side.status !== "ok") {
      return {
        status: side.status,
        value: null,
        note: side.note,
        numeratorValue: numValue,
        denominatorValue: denValue,
      };
    }
  }

  const value = computeRatioPercent(numValue, denValue);
  if (value === null) {
    return {
      status: "penyebut_nol",
      value: null,
      note: `${formatRef(denominatorRef)} bernilai nol — kontribusi tidak dihitung.`,
      numeratorValue: numValue,
      denominatorValue: denValue,
    };
  }
  return { status: "ok", value, note: null, numeratorValue: numValue, denominatorValue: denValue };
}
