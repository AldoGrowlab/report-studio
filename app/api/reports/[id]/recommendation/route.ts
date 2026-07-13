import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";

// PUT — simpan "Rekomendasi & Action Plan" per (report, platform). Fase A gaya agency.
// DIKETIK USER MANUAL (founder & operator) — teks bebas apa adanya, TANPA AI, TANPA
// pemrosesan. Kosong = baris dihapus (slide rekomendasi dilewati saat generate PPT).
export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/reports/[id]/recommendation">
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id: reportId } = await ctx.params;

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) {
    return NextResponse.json({ error: "Report tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  const b = body as Record<string, unknown> | null;
  const platform = b?.platform;
  if (platform !== "shopee" && platform !== "tiktok") {
    return NextResponse.json({ error: "Platform tidak valid." }, { status: 400 });
  }
  if (!report.platforms.includes(platform)) {
    return NextResponse.json(
      { error: "Platform tidak termasuk dalam report ini." },
      { status: 400 }
    );
  }
  if (typeof b?.content !== "string") {
    return NextResponse.json({ error: "content harus berupa teks." }, { status: 400 });
  }
  // Trim ujung saja — baris baru & spasi DI DALAM teks dipertahankan apa adanya.
  const content = b.content.replace(/^\s+|\s+$/g, "");

  if (content === "") {
    await prisma.recommendation.deleteMany({ where: { reportId, platform } });
    return NextResponse.json({ recommendation: null });
  }

  const recommendation = await prisma.recommendation.upsert({
    where: { reportId_platform: { reportId, platform } },
    update: { content },
    create: { reportId, platform, content },
  });
  return NextResponse.json({ recommendation });
}
