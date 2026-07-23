import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { getStorage } from "@/lib/storage";
import { extractMetrics, type ExpectedMetric } from "@/lib/extractor";

// POST — ekstrak angka dari satu upload, dipandu expected_metrics section-nya.
// Mengganti seluruh Extraction lama upload itu (idempoten / bisa re-run).
export async function POST(_request: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  const upload = await prisma.upload.findUnique({
    where: { id },
    include: {
      report: { select: { createdById: true } },
      section: { select: { name: true, platform: true, metrics: true } },
    },
  });
  if (!upload) {
    return NextResponse.json({ error: "Upload tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, upload.report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const metrics: ExpectedMetric[] = upload.section.metrics.map((m) => ({
    key: m.key,
    label: m.label,
    type: m.type,
  }));
  if (metrics.length === 0) {
    return NextResponse.json(
      { error: "Section tidak punya expected metrics." },
      { status: 400 }
    );
  }

  const image = await getStorage().read(upload.imageUrl);
  if (!image) {
    return NextResponse.json({ error: "Gambar tidak ditemukan di storage." }, { status: 404 });
  }

  let outcome;
  try {
    outcome = await extractMetrics(metrics, image, {
      sectionName: upload.section.name,
      platform: upload.section.platform,
    });
  } catch {
    return NextResponse.json(
      { error: "Ekstraksi gagal. Coba lagi." },
      { status: 502 }
    );
  }

  // Ganti Extraction lama, tulis hasil baru dalam satu transaksi.
  const extractions = await prisma.$transaction(async (tx) => {
    await tx.extraction.deleteMany({ where: { uploadId: id } });
    await tx.extraction.createMany({
      data: outcome.results.map((r) => ({
        uploadId: id,
        key: r.key,
        value: r.value,
        rawText: r.rawText,
        confidence: r.confidence,
        status: r.status,
      })),
    });
    return tx.extraction.findMany({ where: { uploadId: id }, orderBy: { key: "asc" } });
  });

  // TIPE tiap metrik ikut dikirim: tabel koreksi memakainya untuk memilih cara tampil &
  // cara edit (durasi manusiawi, teks sebagai teks). Tanpa ini state client kehilangan
  // `type` begitu hasil ekstraksi diganti dari respons ini.
  const typeByKey = new Map(upload.section.metrics.map((m) => [m.key, m.type]));

  return NextResponse.json({
    extractor: outcome.extractor,
    extractions: extractions.map((e) => ({ ...e, type: typeByKey.get(e.key) ?? "number" })),
  });
}
