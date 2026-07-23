import { prisma } from "@/lib/prisma";
import { abbreviateNumberID, type AnalystSource } from "@/lib/analyst";
import {
  computeChainedChanges,
  formatMonthID,
  type PeriodChange,
  type PeriodData,
} from "@/lib/period";

// Satu-satunya jalan angka masuk ke model (generate insight Tahap 6a, revisi Validator
// Tahap 7b, DAN perbandingan periode Tahap 6b): susun sumber Analyst dari Extraction
// TERKINI (termasuk koreksi manual Tahap 5). Bentuk singkat (valueText) dihitung
// DETERMINISTIK di sini (Prinsip #6) — model hanya boleh mengutip bentuk ini, nilai penuh
// tetap utuh di Extraction. Untuk section ber-perbandingan, persen/pp antar bulan juga
// dihitung DI SINI (lib/period.ts) — model tinggal menarasikan, tidak pernah menghitung.

export type PeriodComparisonData = {
  primaryMonth: string; // "YYYY-MM" — fokus cerita
  changes: PeriodChange[]; // perubahan berantai antar bulan berdekatan, dihitung kode
};

export type SourcesResult =
  | {
      ok: true;
      sources: AnalystSource[];
      numbers: string[];
      periodComparison: PeriodComparisonData | null; // null = section biasa
    }
  | { ok: false; error: string };

export async function buildAnalystSources(
  reportId: string,
  sectionId: string
): Promise<SourcesResult> {
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: { metrics: true },
  });
  if (!section) {
    return { ok: false, error: "Section tidak ditemukan." };
  }

  // Urutan createdAt asc = penomoran "Sumber #n" yang sama dengan UI.
  const uploads = await prisma.upload.findMany({
    where: { reportId, sectionId },
    orderBy: { createdAt: "asc" },
    include: { extractions: true },
  });
  if (uploads.length === 0) {
    return { ok: false, error: "Belum ada foto untuk section ini di report ini." };
  }
  // JANGAN pakai angka yang belum diekstrak: tiap foto adalah sumber yang wajib dinarasikan,
  // melewatkannya diam-diam melanggar aturan "sumber terpisah" (DESIGN).
  const notExtracted = uploads.filter((u) => u.extractions.length === 0);
  if (notExtracted.length > 0) {
    return {
      ok: false,
      error: `${notExtracted.length} foto section ini belum diekstrak angkanya. Ekstrak dulu sebelum generate insight.`,
    };
  }

  // Validasi penanda periode (defensif — server sudah menegakkan saat upload/PATCH,
  // tapi data lama/sudut lain harus tertangkap dengan pesan yang menyuruh membereskan).
  if (section.usesPeriodComparison) {
    if (uploads.some((u) => !u.periodMonth)) {
      return {
        ok: false,
        error:
          "Section ini pakai perbandingan periode, tapi ada foto tanpa penanda bulan. Lengkapi bulan tiap foto dulu.",
      };
    }
    const months = uploads.map((u) => u.periodMonth as string);
    if (new Set(months).size !== months.length) {
      return {
        ok: false,
        error:
          "Ada dua foto dengan bulan yang sama di section ini — satu bulan satu foto. Bereskan penanda bulannya dulu.",
      };
    }
    const primaries = uploads.filter((u) => u.isPrimaryPeriod);
    if (primaries.length !== 1) {
      return {
        ok: false,
        error:
          "Tandai TEPAT satu foto sebagai periode utama dulu (tombol \"Jadikan utama\").",
      };
    }
  }

  const metricByKey = new Map(section.metrics.map((m) => [m.key, m]));
  const sources: AnalystSource[] = uploads.map((u, i) => ({
    sourceIndex: i + 1,
    ...(section.usesPeriodComparison
      ? {
          periodLabel: formatMonthID(u.periodMonth as string),
          isPrimary: u.isPrimaryPeriod,
        }
      : {}),
    metrics: u.extractions
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((e) => {
        const meta = metricByKey.get(e.key);
        const type = meta?.type ?? "number";
        // Metrik TEKS: nilainya tinggal di rawText; value/valueText dipaksa null supaya
        // tidak pernah masuk aritmetika (perbandingan periode) maupun kosakata bold.
        const isText = type === "text";
        return {
          key: e.key,
          label: meta?.label ?? e.key,
          type,
          value: isText ? null : e.value,
          valueText: isText || e.value === null ? null : abbreviateNumberID(e.value, type),
          text: isText ? e.rawText : null,
          status: e.status,
        };
      }),
  }));

  // Kosakata angka singkat yang dikirim ke model — di-snapshot di Insight.numbers supaya
  // renderer bisa mem-bold angka metrik deterministik (pencocokan substring, tanpa penanda LLM).
  const numbers = [
    ...new Set(
      sources
        .flatMap((s) => s.metrics.map((m) => m.valueText))
        .filter((v): v is string => v !== null)
    ),
  ];

  // Perbandingan periode (Tahap 6b-B): satu upload = satu bulan; persen/pp dihitung kode.
  // changeText masuk kosakata bold — persen di poin ikut ter-bold, splitter tak berubah.
  let periodComparison: PeriodComparisonData | null = null;
  if (section.usesPeriodComparison) {
    const periods: PeriodData[] = uploads.map((u, i) => ({
      month: u.periodMonth as string,
      metrics: sources[i].metrics.map((m) => ({
        key: m.key,
        label: m.label,
        type: m.type,
        value: m.value,
        valueText: m.valueText,
      })),
    }));
    const changes = computeChainedChanges(periods);
    numbers.push(...new Set(changes.map((c) => c.changeText)));
    periodComparison = {
      primaryMonth: uploads.find((u) => u.isPrimaryPeriod)!.periodMonth as string,
      changes,
    };
  }

  return { ok: true, sources, numbers, periodComparison };
}
