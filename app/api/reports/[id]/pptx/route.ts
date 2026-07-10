import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { getStorage } from "@/lib/storage";
import { groupBySection } from "@/lib/uploads-view";
import { buildReportPptx, type PptBlock, type PptPhoto } from "@/lib/ppt";

// GET — unduh report sebagai .pptx (Tahap 8, Template Engine DETERMINISTIK — tanpa AI).
// GET supaya browser mengunduh langsung (cookie session ikut). Founder & operator.
export async function GET(_request: Request, ctx: RouteContext<"/api/reports/[id]/pptx">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id: reportId } = await ctx.params;

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      uploads: {
        orderBy: { createdAt: "asc" }, // urutan input = nomor "Sumber #n" (konsisten UI/Analyst)
        include: { section: { select: { id: true, name: true, platform: true, narrativeOrder: true } } },
      },
      insights: { select: { sectionId: true, points: true, numbers: true } },
    },
  });
  if (!report) {
    return NextResponse.json({ error: "Report tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  if (report.uploads.length === 0) {
    return NextResponse.json(
      { error: "Report belum punya foto — tidak ada yang bisa dirangkai jadi PPT." },
      { status: 400 }
    );
  }

  const insightBySection = new Map(
    report.insights.map((i) => [i.sectionId, { points: i.points, numbers: i.numbers }])
  );
  const storage = getStorage();

  // Blok per platform, urutan TETAP Shopee lalu TikTok (DESIGN §Platform).
  const blocks: PptBlock[] = [];
  for (const platform of ["shopee", "tiktok"] as const) {
    const uploads = report.uploads.filter((u) => u.platform === platform);
    if (uploads.length === 0) continue;

    // Section masuk PPT = yang punya upload; urut narrativeOrder (section non-aktif yang
    // masih punya upload tetap ikut, di belakang — perilaku groupBySection yang sama dgn UI).
    const sectionOrder = [...new Map(uploads.map((u) => [u.sectionId, u.section])).values()]
      .sort((a, b) => a.narrativeOrder - b.narrativeOrder)
      .map((s) => s.id);
    const groups = groupBySection(uploads, sectionOrder);

    const sections = [];
    for (const g of groups) {
      const photos: PptPhoto[] = [];
      let missingPhotos = 0;
      for (let i = 0; i < g.items.length; i++) {
        const u = g.items[i];
        // Foto disematkan (embedded) supaya file mandiri — Prinsip #5: foto asli wajib tampil.
        const image = await storage.read(u.imageUrl);
        if (!image) {
          // Foto hilang di storage: catat & lanjut — report selalu selesai (Prinsip #3).
          missingPhotos++;
          continue;
        }
        photos.push({
          data: `${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`,
          bytes: image.bytes,
          contentType: image.contentType,
          sourceIndex: i + 1,
        });
      }
      sections.push({
        name: g.items[0].section.name,
        insight: insightBySection.get(g.sectionId) ?? null,
        photos,
        multiSource: g.multiSource,
        missingPhotos,
      });
    }
    blocks.push({ platform, sections });
  }

  const buffer = await buildReportPptx({ reportPeriod: report.reportPeriod, blocks });

  // Nama file: fallback ASCII + filename* UTF-8 (periode bisa mengandung karakter non-ASCII).
  const baseName = `Laporan Performa ${report.reportPeriod}.pptx`;
  const asciiName = baseName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(baseName)}`,
      "Content-Length": String(buffer.length),
    },
  });
}
