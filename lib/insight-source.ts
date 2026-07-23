import { prisma } from "@/lib/prisma";
import { abbreviateNumberID, type AnalystSource } from "@/lib/analyst";
import { displayMetricName, scopedMetricKey } from "@/lib/subgroups";
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
    include: { metrics: true, subGroups: { orderBy: { order: "asc" } } },
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

  // Fase 1 — semua aturan periode di bawah berlaku PER SUB-GRUP. Flash Sale Juni dan
  // Voucher Juni adalah dua foto sah, dan tiap tool punya periode utamanya sendiri.
  const groupLabel = new Map(section.subGroups.map((g) => [g.key, g.label]));
  const byGroup = new Map<string, typeof uploads>();
  for (const u of uploads) {
    const list = byGroup.get(u.subGroupKey);
    if (list) list.push(u);
    else byGroup.set(u.subGroupKey, [u]);
  }
  const scopeName = (key: string) => {
    const label = groupLabel.get(key);
    return label ? `sub-grup ${label}` : "section ini";
  };

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
    for (const [key, list] of byGroup) {
      const months = list.map((u) => u.periodMonth as string);
      if (new Set(months).size !== months.length) {
        return {
          ok: false,
          error: `Ada dua foto dengan bulan yang sama di ${scopeName(key)} — satu bulan satu foto. Bereskan penanda bulannya dulu.`,
        };
      }
      if (list.filter((u) => u.isPrimaryPeriod).length !== 1) {
        return {
          ok: false,
          error: `Tandai TEPAT satu foto sebagai periode utama di ${scopeName(key)} dulu (tombol "Jadikan utama").`,
        };
      }
    }
  }

  // Metrik dicari BER-SCOPE: "penjualan" milik Flash Sale dan milik Voucher adalah dua
  // entitas berbeda dengan label & tipe sendiri (Fase 1).
  const metricByScoped = new Map(
    section.metrics.map((m) => [scopedMetricKey(m.subGroupKey, m.key), m])
  );
  const sources: AnalystSource[] = uploads.map((u, i) => ({
    sourceIndex: i + 1,
    // Label sub-grup jadi bagian identitas sumber, supaya Analyst tahu foto ini tool mana.
    ...(groupLabel.get(u.subGroupKey) ? { subGroupLabel: groupLabel.get(u.subGroupKey) } : {}),
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
        const meta = metricByScoped.get(scopedMetricKey(u.subGroupKey, e.key));
        const type = meta?.type ?? "number";
        // Metrik TEKS: nilainya tinggal di rawText; value/valueText dipaksa null supaya
        // tidak pernah masuk aritmetika (perbandingan periode) maupun kosakata bold.
        const isText = type === "text";
        return {
          // Kunci ber-scope: dipakai perbandingan periode supaya "penjualan" Flash Sale
          // tak pernah dibandingkan dengan "penjualan" Voucher.
          key: scopedMetricKey(u.subGroupKey, e.key),
          // Nama LENGKAP ber-prefix ("Flash Sale — Penjualan") dipakai Analyst, Validator,
          // dan PPT. Tanpa sub-grup: nama metrik apa adanya, persis seperti sebelumnya.
          label: displayMetricName(groupLabel.get(u.subGroupKey) ?? null, meta?.label ?? e.key),
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
    // Rantai perbandingan dihitung PER SUB-GRUP lalu digabung. Kalau seluruh foto section
    // dirantai jadi satu, dua tool yang difoto pada bulan yang sama tampak sebagai dua
    // "periode" berbeda dan persennya jadi ngawur.
    const changes: PeriodChange[] = [];
    for (const [key, list] of byGroup) {
      const periods: PeriodData[] = list.map((u) => {
        const src = sources[uploads.indexOf(u)];
        return {
          month: u.periodMonth as string,
          metrics: src.metrics.map((m) => ({
            key: m.key,
            label: m.label,
            type: m.type,
            value: m.value,
            valueText: m.valueText,
          })),
        };
      });
      void key;
      changes.push(...computeChainedChanges(periods));
    }
    numbers.push(...new Set(changes.map((c) => c.changeText)));
    periodComparison = {
      // Periode utama = milik sub-grup pertama; semua sub-grup dalam satu section
      // dilaporkan untuk bulan yang sama, jadi fokus ceritanya tetap satu.
      primaryMonth: uploads.find((u) => u.isPrimaryPeriod)!.periodMonth as string,
      changes,
    };
  }

  return { ok: true, sources, numbers, periodComparison };
}
