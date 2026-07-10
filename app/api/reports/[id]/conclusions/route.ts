import { NextResponse } from "next/server";
import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { generateConclusion, type ValidatorSection } from "@/lib/validator";

// POST — Validator menulis kesimpulan SATU platform untuk report ini (Tahap 7a).
// Body: JSON { platform }. Satu kesimpulan per (report, platform); generate ulang = replace.
// Dipicu MANUAL dari halaman report (bukan otomatis). Founder & operator sama-sama boleh.
// Peringatan "ada section aktif tanpa insight" ditangani ringan di UI (non-blocking) —
// server hanya mensyaratkan minimal SATU insight platform itu.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/reports/[id]/conclusions">
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
  const platform = (body as Record<string, unknown> | null)?.platform;
  if (platform !== "shopee" && platform !== "tiktok") {
    return NextResponse.json({ error: "platform wajib shopee/tiktok." }, { status: 400 });
  }
  if (!report.platforms.includes(platform as Platform)) {
    return NextResponse.json(
      { error: "Platform itu tidak termasuk dalam report ini." },
      { status: 400 }
    );
  }

  // Bahan kesimpulan = SEMUA insight section platform ini yang sudah ada, urut alur
  // cerita (narrativeOrder). Validator TIDAK menyentuh Extraction: angka diambil dari
  // teks insight yang sudah jadi — mengutip verbatim, bukan menghitung ulang.
  const insights = await prisma.insight.findMany({
    where: { reportId, section: { platform } },
    include: { section: { select: { name: true, narrativeOrder: true } } },
  });
  if (insights.length === 0) {
    return NextResponse.json(
      { error: "Belum ada insight section untuk platform ini. Generate insight dulu." },
      { status: 400 }
    );
  }
  insights.sort((a, b) => a.section.narrativeOrder - b.section.narrativeOrder);
  const sections: ValidatorSection[] = insights.map((i) => ({
    sectionName: i.section.name,
    points: i.points,
  }));

  // Kosakata bold kesimpulan = union kosakata semua insight platform ini: angka yang
  // dikutip Validator pasti berasal dari salah satu insight, jadi pasti tercakup.
  const numbers = [...new Set(insights.flatMap((i) => i.numbers))];

  // Dua KB Validator (boleh belum diisi founder — prompt memakai penilaian umum).
  const kb = await prisma.validatorKb.findUnique({ where: { platform } });

  let outcome;
  try {
    outcome = await generateConclusion({
      platform,
      reportPeriod: report.reportPeriod,
      kbGeneral: kb?.kbGeneral ?? "",
      kbConclusion: kb?.kbConclusion ?? "",
      sections,
    });
  } catch {
    return NextResponse.json(
      { error: "Generate kesimpulan gagal. Coba lagi." },
      { status: 502 }
    );
  }

  const conclusion = await prisma.conclusion.upsert({
    where: { reportId_platform: { reportId, platform } },
    update: { points: outcome.points, numbers, generator: outcome.generator },
    create: {
      reportId,
      platform,
      points: outcome.points,
      numbers,
      generator: outcome.generator,
    },
  });

  return NextResponse.json({ conclusion, generator: outcome.generator });
}
