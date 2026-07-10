import { NextResponse } from "next/server";
import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { reviseInsight } from "@/lib/analyst";
import { buildAnalystSources } from "@/lib/insight-source";
import {
  checkConsistency,
  generateConclusion,
  type ConsistencyIssue,
} from "@/lib/validator";

// POST — Validator untuk SATU platform report ini: cek konsistensi -> revisi (via Analyst,
// maks 1 putaran per section) -> cek ulang -> flag sisa masalah -> tulis kesimpulan.
// Satu tombol "Buat kesimpulan" menjalankan seluruh alur (Tahap 7a+7b).
// Body: JSON { platform }. Kesimpulan SELALU tetap ditulis (Prinsip #3: report jalan
// sampai selesai — masalah di-flag, bukan menghentikan proses).
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

  // Bahan = SEMUA insight section platform ini, urut alur cerita (narrativeOrder).
  const insights = await prisma.insight.findMany({
    where: { reportId, section: { platform } },
    include: {
      section: { select: { id: true, name: true, narrativeOrder: true, kbAnalysis: true } },
    },
  });
  if (insights.length === 0) {
    return NextResponse.json(
      { error: "Belum ada insight section untuk platform ini. Generate insight dulu." },
      { status: 400 }
    );
  }
  insights.sort((a, b) => a.section.narrativeOrder - b.section.narrativeOrder);

  // Daftar kerja: points bisa berubah setelah revisi — kesimpulan memakai poin FINAL.
  const working = insights.map((i) => ({
    insight: i,
    sectionName: i.section.name,
    points: i.points,
  }));
  const asCheckInput = () => ({
    platform: platform as Platform,
    sections: working.map((w) => ({ sectionName: w.sectionName, points: w.points })),
  });

  // ---- Tahap 7b: cek konsistensi (dua cek bawaan, TANPA KB) ----
  let issuesFound: ConsistencyIssue[] = [];
  try {
    issuesFound = (await checkConsistency(asCheckInput())).issues;
  } catch {
    return NextResponse.json(
      { error: "Cek konsistensi gagal. Coba lagi." },
      { status: 502 }
    );
  }

  // Revisi: kelompokkan temuan per section (maks 1 putaran revisi per section — beberapa
  // temuan untuk section yang sama digabung jadi satu daftar instruksi). Validator hanya
  // memberi instruksi; ANALYST yang merevisi dengan angka dari Extraction (helper bersama).
  const issuesBySection = new Map<number, ConsistencyIssue[]>();
  for (const issue of issuesFound) {
    const list = issuesBySection.get(issue.sectionIndex) ?? [];
    list.push(issue);
    issuesBySection.set(issue.sectionIndex, list);
  }

  type PendingRevision = {
    sectionIndex: number;
    insightId: string;
    sectionId: string;
    pointsBefore: string[];
    pointsAfter: string[];
    reason: string;
    instruction: string;
  };
  const pendingRevisions: PendingRevision[] = [];
  const escalated: { sectionIndex: number; note: string }[] = [];

  for (const [sectionIndex, issues] of issuesBySection) {
    const item = working[sectionIndex];
    const reason = issues.map((i) => `[${i.kind}] ${i.finding}`).join("\n");
    const instructions = issues.map((i) => i.instruction);

    // Angka TIDAK berubah: sumber disusun ulang dari Extraction terkini, sama persis
    // dengan generate awal (lib/insight-source.ts).
    const built = await buildAnalystSources(reportId, item.insight.sectionId);
    if (!built.ok) {
      escalated.push({ sectionIndex, note: `${reason}\n(revisi gagal: ${built.error})` });
      continue;
    }
    let revised;
    try {
      revised = await reviseInsight(
        {
          sectionName: item.sectionName,
          platform: platform as Platform,
          kbAnalysis: item.insight.section.kbAnalysis,
          sources: built.sources,
          periodComparison: built.periodComparison,
        },
        item.points,
        instructions
      );
    } catch {
      escalated.push({ sectionIndex, note: `${reason}\n(revisi gagal dijalankan)` });
      continue;
    }

    pendingRevisions.push({
      sectionIndex,
      insightId: item.insight.id,
      sectionId: item.insight.sectionId,
      pointsBefore: item.points,
      pointsAfter: revised.points,
      reason,
      instruction: instructions.join("\n"),
    });
    working[sectionIndex] = { ...item, points: revised.points };
  }

  // Cek ULANG sekali kalau ada revisi — masih bermasalah => escalate + flag, TIDAK loop
  // lagi. Cek ulang yang gagal dijalankan tidak menghentikan apa pun (Prinsip #3).
  let remaining: ConsistencyIssue[] = [];
  if (pendingRevisions.length > 0) {
    try {
      remaining = (await checkConsistency(asCheckInput())).issues;
    } catch {
      remaining = [];
    }
  }
  const unresolvedSections = new Set(remaining.map((i) => i.sectionIndex));

  // Simpan jejak revisi (before/after/alasan — tidak ada perubahan diam-diam) + update poin.
  const savedRevisions = [];
  for (const rev of pendingRevisions) {
    await prisma.insight.update({
      where: { id: rev.insightId },
      data: { points: rev.pointsAfter },
    });
    const row = await prisma.insightRevision.create({
      data: {
        insightId: rev.insightId,
        pointsBefore: rev.pointsBefore,
        pointsAfter: rev.pointsAfter,
        reason: rev.reason,
        instruction: rev.instruction,
        resolved: !unresolvedSections.has(rev.sectionIndex),
      },
    });
    savedRevisions.push({ ...row, sectionId: rev.sectionId });
  }

  // Flag = keadaan run TERAKHIR: hapus flag inkonsistensi lama (report, platform) ini,
  // tulis yang tersisa sekarang. Severity "info" — inkonsistensi narasi, bukan presisi angka.
  await prisma.flag.deleteMany({
    where: { reportId, platform, type: "inkonsistensi" },
  });
  const flagData = [
    ...escalated.map((e) => ({ sectionIndex: e.sectionIndex, note: e.note })),
    ...remaining.map((i) => ({
      sectionIndex: i.sectionIndex,
      note: `[${i.kind}] ${i.finding} (masih ditemukan setelah 1x revisi)`,
    })),
  ];
  const flags = [];
  for (const f of flagData) {
    flags.push(
      await prisma.flag.create({
        data: {
          reportId,
          platform,
          section: working[f.sectionIndex]?.sectionName ?? "?",
          type: "inkonsistensi",
          severity: "info",
          note: f.note,
        },
      })
    );
  }

  // ---- Tahap 7a: tulis kesimpulan dari poin FINAL — selalu jalan ----
  const numbers = [...new Set(insights.flatMap((i) => i.numbers))];
  const kb = await prisma.validatorKb.findUnique({ where: { platform } });

  let outcome;
  try {
    outcome = await generateConclusion({
      platform,
      reportPeriod: report.reportPeriod,
      kbGeneral: kb?.kbGeneral ?? "",
      kbConclusion: kb?.kbConclusion ?? "",
      sections: working.map((w) => ({ sectionName: w.sectionName, points: w.points })),
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Generate kesimpulan gagal. Coba lagi." +
          (savedRevisions.length > 0
            ? " (Catatan: revisi insight dari cek konsistensi sudah tersimpan.)"
            : ""),
      },
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

  // Insight yang terevisi ikut dikirim supaya UI memperbarui panel insight-nya.
  const revisedIds = new Set(pendingRevisions.map((r) => r.insightId));
  const revisedInsights = insights
    .filter((i) => revisedIds.has(i.id))
    .map((i) => ({
      sectionId: i.sectionId,
      points: working.find((w) => w.insight.id === i.id)?.points ?? i.points,
      numbers: i.numbers,
      kbVersion: i.kbVersion,
      generator: i.generator,
      updatedAt: new Date().toISOString(),
    }));

  return NextResponse.json({
    conclusion,
    generator: outcome.generator,
    insights: revisedInsights,
    revisions: savedRevisions,
    flags,
    consistency: {
      issuesFound: issuesFound.length,
      revised: savedRevisions.length,
      escalated: flags.length,
    },
  });
}
