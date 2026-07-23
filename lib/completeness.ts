import type { ExtractionStatus } from "@prisma/client";
import { DEFAULT_SUB_GROUP_KEY, displayMetricName, isDefaultSubGroup } from "@/lib/subgroups";

// Validator KELENGKAPAN (Fase 1c, Jul 2026) — MURNI & deterministik, tanpa model.
//
// DESIGN sudah lama menjanjikan "metrik `required` hilang → kekurangan di-flag", tapi
// sampai Jul 2026 janji itu belum pernah ditepati: `required` disimpan dan bisa dicentang
// founder, namun tidak ada kode yang memeriksanya. Ini implementasinya, dan sejak awal
// dibangun PER SUB-GRUP.
//
// Dua aturan yang membedakannya dari pemeriksaan per-foto yang naif:
//
// 1. Kelengkapan dinilai atas GABUNGAN semua foto satu sub-grup, bukan per foto. Satu foto
//    Flash Sale mungkin hanya memuat sebagian metriknya; yang lain melengkapi.
// 2. Sub-grup yang didefinisikan KB tapi TANPA SATU PUN FOTO bukan error — daftar tool
//    yang aktif berbeda tiap klien dan tiap bulan. Yang terbit cuma catatan info
//    "tidak ada aktivitas <label> bulan ini".

export type CompletenessSubGroup = { key: string; label: string };

export type CompletenessMetric = {
  subGroupKey: string;
  key: string;
  label: string;
  required: boolean;
};

export type CompletenessPhoto = {
  subGroupKey: string;
  extractions: { key: string; status: ExtractionStatus; manuallyConfirmed: boolean }[];
};

export type CompletenessInput = {
  sectionName: string;
  // Dari KB. KOSONG = section tanpa sub-grup (satu sub-grup tunggal implisit).
  subGroups: CompletenessSubGroup[];
  metrics: CompletenessMetric[];
  photos: CompletenessPhoto[];
};

export type CompletenessFinding = {
  subGroupKey: string;
  // "info"  = tidak menghalangi (tool tak aktif, metrik opsional hilang);
  // "tinggi" = menyentuh presisi (metrik WAJIB hilang / masih ragu).
  severity: "info" | "tinggi";
  note: string;
};

// Metrik dianggap ADA kalau setidaknya satu foto sub-grup itu punya angkanya. Yang masih
// `low_confidence` DAN belum dikonfirmasi manusia sengaja dihitung BELUM ada untuk metrik
// wajib: angka yang belum divetting tidak boleh diam-diam lolos sebagai lengkap.
function presence(photos: CompletenessPhoto[], metricKey: string): "ok" | "ragu" | "hilang" {
  let sawUnconfirmed = false;
  for (const p of photos) {
    for (const e of p.extractions) {
      if (e.key !== metricKey) continue;
      if (e.status === "ok") return "ok";
      if (e.status === "low_confidence") {
        if (e.manuallyConfirmed) return "ok";
        sawUnconfirmed = true;
      }
    }
  }
  return sawUnconfirmed ? "ragu" : "hilang";
}

export function checkCompleteness(input: CompletenessInput): CompletenessFinding[] {
  const findings: CompletenessFinding[] = [];

  // Section tanpa sub-grup diperlakukan sebagai SATU sub-grup tunggal implisit, sehingga
  // aturannya cuma satu — bukan satu jalur normal plus satu jalur khusus.
  const groups: CompletenessSubGroup[] =
    input.subGroups.length > 0
      ? input.subGroups
      : [{ key: DEFAULT_SUB_GROUP_KEY, label: "" }];

  for (const g of groups) {
    const photos = input.photos.filter((p) => p.subGroupKey === g.key);
    const metrics = input.metrics.filter((m) => m.subGroupKey === g.key);

    if (photos.length === 0) {
      // Sub-grup EKSPLISIT tanpa foto = tool itu memang tidak dipakai bulan ini.
      // Section tanpa sub-grup yang tak berfoto tidak sampai ke sini (dijaga pemanggil).
      if (!isDefaultSubGroup(g.key)) {
        findings.push({
          subGroupKey: g.key,
          severity: "info",
          note: `Tidak ada aktivitas ${g.label} bulan ini — tidak ada foto untuk sub-grup ini.`,
        });
      }
      continue;
    }

    const label = isDefaultSubGroup(g.key) ? null : g.label;
    const missingRequired: string[] = [];
    const unsureRequired: string[] = [];
    const missingOptional: string[] = [];

    for (const m of metrics) {
      const state = presence(photos, m.key);
      if (state === "ok") continue;
      const full = displayMetricName(label, m.label);
      if (!m.required) {
        missingOptional.push(full);
      } else if (state === "ragu") {
        unsureRequired.push(full);
      } else {
        missingRequired.push(full);
      }
    }

    if (missingRequired.length > 0) {
      findings.push({
        subGroupKey: g.key,
        severity: "tinggi",
        note: `Metrik WAJIB belum ada angkanya: ${missingRequired.join(", ")}.`,
      });
    }
    if (unsureRequired.length > 0) {
      findings.push({
        subGroupKey: g.key,
        severity: "tinggi",
        note: `Metrik WAJIB masih ragu dan belum dikonfirmasi manual: ${unsureRequired.join(", ")}.`,
      });
    }
    if (missingOptional.length > 0) {
      findings.push({
        subGroupKey: g.key,
        severity: "info",
        note: `Metrik opsional tidak ada di foto: ${missingOptional.join(", ")}.`,
      });
    }
  }

  return findings;
}
