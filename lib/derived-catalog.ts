import { prisma } from "@/lib/prisma";
import type { CatalogEntry } from "@/lib/derived";

// Katalog metrik yang BENAR-BENAR ada di seluruh KB — bahan validasi ref metrik turunan.
// Dibaca lintas section karena ref memang boleh lintas section (kontribusi promo ÷ GMV
// yang tinggal di section lain).
export async function buildMetricCatalog(): Promise<CatalogEntry[]> {
  const sections = await prisma.section.findMany({
    select: { name: true, platform: true, metrics: { select: { key: true, subGroupKey: true, type: true } } },
  });
  return sections.flatMap((s) =>
    s.metrics.map((m) => ({
      platform: s.platform,
      section: s.name,
      subGroupKey: m.subGroupKey,
      metricKey: m.key,
      isText: m.type === "text",
    }))
  );
}
