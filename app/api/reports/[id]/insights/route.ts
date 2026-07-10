import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import {
  abbreviateNumberID,
  generateInsight,
  type AnalystSource,
} from "@/lib/analyst";

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

  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    include: { metrics: true },
  });
  if (!section) {
    return NextResponse.json({ error: "Section tidak ditemukan." }, { status: 404 });
  }
  if (!section.kbAnalysis.trim()) {
    return NextResponse.json(
      { error: "Section belum punya KB analisa." },
      { status: 400 }
    );
  }

  // Angka diambil dari Extraction TERKINI (termasuk koreksi/konfirmasi manual — Tahap 5).
  // Urutan createdAt asc = penomoran "Sumber #n" yang sama dengan UI.
  const uploads = await prisma.upload.findMany({
    where: { reportId, sectionId },
    orderBy: { createdAt: "asc" },
    include: { extractions: true },
  });
  if (uploads.length === 0) {
    return NextResponse.json(
      { error: "Belum ada foto untuk section ini di report ini." },
      { status: 400 }
    );
  }
  // JANGAN pakai angka yang belum diekstrak: tiap foto adalah sumber yang wajib dinarasikan,
  // melewatkannya diam-diam melanggar aturan "sumber terpisah" (DESIGN).
  const notExtracted = uploads.filter((u) => u.extractions.length === 0);
  if (notExtracted.length > 0) {
    return NextResponse.json(
      {
        error: `${notExtracted.length} foto section ini belum diekstrak angkanya. Ekstrak dulu sebelum generate insight.`,
      },
      { status: 400 }
    );
  }

  // Susun sumber untuk Analyst. Bentuk singkat (valueText) dihitung DETERMINISTIK di sini
  // (Prinsip #6) — model hanya boleh mengutip bentuk ini, nilai penuh tetap utuh di Extraction.
  const metricByKey = new Map(section.metrics.map((m) => [m.key, m]));
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

  return NextResponse.json({ insight, generator: outcome.generator });
}
