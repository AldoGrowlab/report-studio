import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { generateInsight } from "@/lib/analyst";
import { buildAnalystSources } from "@/lib/insight-source";

// POST — generate insight Analyst untuk satu section dalam report ini (Tahap 6a).
// Body: JSON { sectionId }. Satu insight per (report, section); generate ulang = replace.
// Founder & operator sama-sama boleh (aturan akses report biasa).
export async function POST(request: Request, ctx: RouteContext<"/api/reports/[id]/insights">) {
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
  const sectionId = (body as Record<string, unknown> | null)?.sectionId;
  if (typeof sectionId !== "string" || !sectionId) {
    return NextResponse.json({ error: "sectionId wajib ada." }, { status: 400 });
  }

  const section = await prisma.section.findUnique({ where: { id: sectionId } });
  if (!section) {
    return NextResponse.json({ error: "Section tidak ditemukan." }, { status: 404 });
  }
  if (!section.kbAnalysis.trim()) {
    return NextResponse.json(
      { error: "Section belum punya KB analisa." },
      { status: 400 }
    );
  }

  // Susun sumber Analyst dari Extraction TERKINI — helper bersama dengan langkah revisi
  // Validator (Tahap 7b), satu-satunya jalan angka masuk ke model (lib/insight-source.ts).
  const built = await buildAnalystSources(reportId, sectionId);
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }
  const { sources, numbers } = built;

  // Snapshot lazy KbVersion: pastikan ada baris versi yang isinya = KB yang dipakai SEKARANG.
  // Insight membawa nomor versi ini (DESIGN §Sistem Flag: pelacakan kb_version).
  const latestKb = await prisma.kbVersion.findFirst({
    where: { sectionId },
    orderBy: { version: "desc" },
  });
  const kbVersion =
    latestKb && latestKb.content === section.kbAnalysis
      ? latestKb.version
      : (
          await prisma.kbVersion.create({
            data: {
              sectionId,
              version: (latestKb?.version ?? 0) + 1,
              content: section.kbAnalysis,
            },
          })
        ).version;

  let outcome;
  try {
    outcome = await generateInsight({
      sectionName: section.name,
      platform: section.platform,
      kbAnalysis: section.kbAnalysis,
      sources,
    });
  } catch {
    return NextResponse.json(
      { error: "Generate insight gagal. Coba lagi." },
      { status: 502 }
    );
  }

  const insight = await prisma.insight.upsert({
    where: { reportId_sectionId: { reportId, sectionId } },
    update: { points: outcome.points, numbers, kbVersion, generator: outcome.generator },
    create: {
      reportId,
      sectionId,
      points: outcome.points,
      numbers,
      kbVersion,
      generator: outcome.generator,
    },
  });

  // Generate ulang = generasi baru: jejak revisi Validator (Tahap 7b) milik generasi
  // lama tidak relevan lagi — hapus supaya UI tidak menampilkan before/after yang basi.
  await prisma.insightRevision.deleteMany({ where: { insightId: insight.id } });

  return NextResponse.json({ insight, generator: outcome.generator });
}
