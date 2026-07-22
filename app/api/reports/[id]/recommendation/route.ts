import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";

// PUT — simpan "Rekomendasi & Action Plan" per (report, platform). Fase A gaya agency.
// DIKETIK USER MANUAL (founder & operator) — poin demi poin, TANPA AI, TANPA pemrosesan.
// Tiap poin ditrim; poin kosong dibuang. Tanpa poin tersisa = baris dihapus (slide
// rekomendasi dilewati saat generate PPT).
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
  if (!Array.isArray(b?.points)) {
    return NextResponse.json({ error: "points harus berupa daftar poin." }, { status: 400 });
  }
  // Tiap poin ditrim; poin kosong dibuang. Urutan sisanya dipertahankan.
  const points = b.points
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.replace(/^\s+|\s+$/g, ""))
    .filter((p) => p !== "");

  if (points.length === 0) {
    await prisma.recommendation.deleteMany({ where: { reportId, platform } });
    return NextResponse.json({ recommendation: null });
  }

  const recommendation = await prisma.recommendation.upsert({
    where: { reportId_platform: { reportId, platform } },
    update: { points },
    create: { reportId, platform, points },
  });
  return NextResponse.json({ recommendation });
}
