import { prisma } from "@/lib/prisma";
import { abbreviateNumberID, type AnalystSource } from "@/lib/analyst";

// Satu-satunya jalan angka masuk ke model (generate insight Tahap 6a DAN revisi Validator
// Tahap 7b): susun sumber Analyst dari Extraction TERKINI (termasuk koreksi manual Tahap 5).
// Bentuk singkat (valueText) dihitung DETERMINISTIK di sini (Prinsip #6) — model hanya boleh
// mengutip bentuk ini, nilai penuh tetap utuh di Extraction. Karena revisi memakai helper yang
// sama, angka insight sesudah revisi PASTI tetap bersumber dari Extraction.

export type SourcesResult =
  | { ok: true; sources: AnalystSource[]; numbers: string[] }
  | { ok: false; error: string };

export async function buildAnalystSources(
  reportId: string,
  sectionId: string
): Promise<SourcesResult> {
  const metrics = await prisma.sectionMetric.findMany({ where: { sectionId } });

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

  const metricByKey = new Map(metrics.map((m) => [m.key, m]));
  const sources: AnalystSource[] = uploads.map((u, i) => ({
    sourceIndex: i + 1,
    metrics: u.extractions
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((e) => {
        const meta = metricByKey.get(e.key);
        const type = meta?.type ?? "number";
        return {
          key: e.key,
          label: meta?.label ?? e.key,
          type,
          value: e.value,
          valueText: e.value === null ? null : abbreviateNumberID(e.value, type),
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

  return { ok: true, sources, numbers };
}
