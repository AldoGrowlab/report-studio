import type { DerivedMetricDef } from "@/lib/derived";

// Definisi metrik turunan -> baris DerivedMetric. Ref dipecah jadi EMPAT kolom eksplisit
// per operan (bukan satu string ber-pemisah) supaya tak ada escaping yang bisa salah:
// nama section boleh memuat "/" dan "—".
export function toDerivedRow(d: DerivedMetricDef, index = 0) {
  return {
    subGroupKey: d.subGroupKey,
    key: d.key,
    label: d.label,
    unit: d.unit,
    notes: d.notes ?? null,
    order: index,
    numeratorPlatform: d.numeratorRef.platform,
    numeratorSection: d.numeratorRef.section,
    numeratorSubGroupKey: d.numeratorRef.subGroupKey,
    numeratorMetricKey: d.numeratorRef.metricKey,
    denominatorPlatform: d.denominatorRef.platform,
    denominatorSection: d.denominatorRef.section,
    denominatorSubGroupKey: d.denominatorRef.subGroupKey,
    denominatorMetricKey: d.denominatorRef.metricKey,
  };
}
