import type { Platform, MetricType, SectionStatus } from "@prisma/client";

// Tipe metrik yang masuk dari request (sebelum disimpan)
export type MetricInput = {
  key: string;
  label: string;
  type: MetricType;
  required: boolean;
};

// Tipe payload section yang sudah divalidasi & dinormalisasi
export type SectionInput = {
  platform: Platform;
  name: string;
  narrativeOrder: number;
  kbAnalysis: string;
  // Tahap 6b — section ini pakai perbandingan periode (opt-in founder).
  usesPeriodComparison: boolean;
  metrics: MetricInput[];
};

const METRIC_TYPES: MetricType[] = ["number", "currency", "percent", "ratio"];

// Aturan inti: section "active" hanya kalau lengkap
// (nama terisi + KB terisi + minimal 1 metrik). Selain itu "draft".
export function computeSectionStatus(input: {
  name: string;
  kbAnalysis: string;
  metricsCount: number;
}): SectionStatus {
  const complete =
    input.name.trim().length > 0 &&
    input.kbAnalysis.trim().length > 0 &&
    input.metricsCount >= 1;
  return complete ? "active" : "draft";
}

// Validasi + normalisasi body request menjadi SectionInput.
// Mengembalikan { data } kalau valid, atau { error } kalau tidak.
export type ParseResult =
  | { ok: true; data: SectionInput }
  | { ok: false; error: string };

export function parseSectionBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Permintaan tidak valid." };
  }
  const b = body as Record<string, unknown>;

  const platform = b.platform;
  if (platform !== "shopee" && platform !== "tiktok") {
    return { ok: false, error: "Platform harus shopee atau tiktok." };
  }

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) {
    return { ok: false, error: "Nama section wajib diisi." };
  }

  // narrativeOrder: terima number atau string angka, default 0
  let narrativeOrder = 0;
  if (b.narrativeOrder !== undefined && b.narrativeOrder !== null && b.narrativeOrder !== "") {
    const n = Number(b.narrativeOrder);
    if (!Number.isInteger(n)) {
      return { ok: false, error: "Narrative order harus berupa angka bulat." };
    }
    narrativeOrder = n;
  }

  const kbAnalysis = typeof b.kbAnalysis === "string" ? b.kbAnalysis : "";

  const rawMetrics = Array.isArray(b.metrics) ? b.metrics : [];
  const metrics: MetricInput[] = [];
  const seenKeys = new Set<string>();

  for (const raw of rawMetrics) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "Format metrik tidak valid." };
    }
    const m = raw as Record<string, unknown>;
    const key = typeof m.key === "string" ? m.key.trim() : "";
    const label = typeof m.label === "string" ? m.label.trim() : "";

    // Lewati baris yang benar-benar kosong (key & label kosong)
    if (!key && !label) continue;

    if (!key) {
      return { ok: false, error: "Setiap metrik wajib punya key." };
    }
    if (!label) {
      return { ok: false, error: `Metrik "${key}" wajib punya label.` };
    }
    if (seenKeys.has(key)) {
      return { ok: false, error: `Key metrik "${key}" tidak boleh dobel dalam satu section.` };
    }
    seenKeys.add(key);

    const type = m.type;
    if (!METRIC_TYPES.includes(type as MetricType)) {
      return { ok: false, error: `Tipe metrik "${key}" tidak valid.` };
    }

    metrics.push({
      key,
      label,
      type: type as MetricType,
      required: Boolean(m.required),
    });
  }

  return {
    ok: true,
    data: {
      platform,
      name,
      narrativeOrder,
      kbAnalysis,
      usesPeriodComparison: Boolean(b.usesPeriodComparison),
      metrics,
    },
  };
}

export { METRIC_TYPES };
