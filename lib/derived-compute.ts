import { prisma } from "@/lib/prisma";
import { formatRef, type MetricRef } from "@/lib/derived";
import { resolveDerived, resolveOperand, type OperandPhoto } from "@/lib/derived-resolve";

// Langkah COMPUTE metrik turunan (Fase 2b) — deterministik, tanpa model.
//
// Dijalankan SETELAH ekstraksi dan sesudah tiap koreksi manual, jadi hasilnya selalu
// mencerminkan angka terkini. Ditulis-ulang TOTAL tiap kali (hapus lalu tulis) sehingga
// tak pernah ada duplikat maupun sisa nilai basi — pola yang sama dengan Extraction saat
// ekstrak ulang.
//
// Operan yang belum tersedia TIDAK menghasilkan angka: barisnya ditandai "menunggu"
// beserta ref yang kurang, dan begitu operannya muncul, hitung-ulang berikutnya
// memunculkan kontribusinya otomatis tanpa tindakan apa pun dari operator.

const refOf = (
  platform: "shopee" | "tiktok",
  section: string,
  subGroupKey: string,
  metricKey: string
): MetricRef => ({ platform, section, subGroupKey, metricKey });

export async function recomputeDerivedMetrics(reportId: string): Promise<number> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, platforms: true },
  });
  if (!report) return 0;

  // Definisi turunan HANYA dari section se-platform dengan report ini.
  const sections = await prisma.section.findMany({
    where: { platform: { in: report.platforms } },
    include: { derived: { orderBy: { order: "asc" } }, subGroups: true },
  });
  const owners = sections.filter((s) => s.derived.length > 0);

  // Tulis-ulang total: definisi yang dihapus founder tak boleh meninggalkan angka yatim.
  await prisma.computedMetric.deleteMany({ where: { reportId } });
  if (owners.length === 0) return 0;

  // Semua foto report ini + angkanya, sekali ambil.
  const uploads = await prisma.upload.findMany({
    where: { reportId },
    include: { section: { select: { name: true, platform: true, usesPeriodComparison: true } }, extractions: true },
  });

  // Kandidat foto untuk satu ref: (platform, nama section, sub-grup).
  const photosFor = (ref: MetricRef): { photos: OperandPhoto[]; usesPeriodComparison: boolean } => {
    const matching = uploads.filter(
      (u) =>
        u.section.platform === ref.platform &&
        u.section.name === ref.section &&
        u.subGroupKey === ref.subGroupKey
    );
    return {
      usesPeriodComparison: matching[0]?.section.usesPeriodComparison ?? false,
      photos: matching.map((u) => {
        const e = u.extractions.find((x) => x.key === ref.metricKey);
        return {
          isPrimaryPeriod: u.isPrimaryPeriod,
          value: e?.value ?? null,
          hasMetric: e !== undefined,
        };
      }),
    };
  };

  const rows = [];
  for (const sec of owners) {
    for (const d of sec.derived) {
      const numRef = refOf(d.numeratorPlatform, d.numeratorSection, d.numeratorSubGroupKey, d.numeratorMetricKey);
      const denRef = refOf(d.denominatorPlatform, d.denominatorSection, d.denominatorSubGroupKey, d.denominatorMetricKey);
      const num = photosFor(numRef);
      const den = photosFor(denRef);
      const outcome = resolveDerived(
        resolveOperand(numRef, num.photos, num.usesPeriodComparison),
        resolveOperand(denRef, den.photos, den.usesPeriodComparison),
        denRef
      );
      rows.push({
        reportId,
        sectionId: sec.id,
        subGroupKey: d.subGroupKey,
        key: d.key,
        label: d.label,
        unit: d.unit,
        value: outcome.value,
        status: outcome.status,
        note: outcome.note,
        numeratorValue: outcome.numeratorValue,
        denominatorValue: outcome.denominatorValue,
        numeratorRefText: formatRef(numRef),
        denominatorRefText: formatRef(denRef),
      });
    }
  }

  if (rows.length > 0) await prisma.computedMetric.createMany({ data: rows });
  return rows.filter((r) => r.status === "ok").length;
}
