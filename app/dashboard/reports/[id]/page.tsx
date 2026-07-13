import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import UploadManager from "./UploadManager";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      uploads: {
        orderBy: { createdAt: "asc" },
        include: {
          section: { select: { id: true, name: true } },
          extractions: { orderBy: { key: "asc" } },
        },
      },
    },
  });
  if (!report) notFound();
  if (!canAccessReport(session, report)) redirect("/dashboard/reports");

  // Insight Analyst tersimpan (Tahap 6a) — satu per section, ditampilkan di grup section.
  const insights = await prisma.insight.findMany({
    where: { reportId: id },
    select: {
      sectionId: true,
      points: true,
      numbers: true,
      kbVersion: true,
      generator: true,
      updatedAt: true,
    },
  });
  const initialInsights = insights.map((i) => ({
    ...i,
    updatedAt: i.updatedAt.toISOString(),
  }));

  // Kesimpulan Validator tersimpan (Tahap 7a) — satu per platform report.
  const conclusions = await prisma.conclusion.findMany({
    where: { reportId: id },
    select: {
      platform: true,
      points: true,
      numbers: true,
      generator: true,
      updatedAt: true,
    },
  });
  const initialConclusions = conclusions.map((c) => ({
    ...c,
    updatedAt: c.updatedAt.toISOString(),
  }));

  // Rekomendasi & Action Plan tersimpan (Fase A) — ketikan user manual per platform.
  const recommendations = await prisma.recommendation.findMany({
    where: { reportId: id },
    select: { platform: true, content: true },
  });

  // Tahap 7b — jejak revisi Validator (before/after/alasan, per insight) + flag
  // inkonsistensi hasil escalate: WAJIB terlihat di halaman report, bukan terkubur di log.
  const revisions = await prisma.insightRevision.findMany({
    where: { insight: { reportId: id } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      pointsBefore: true,
      pointsAfter: true,
      reason: true,
      resolved: true,
      createdAt: true,
      insight: { select: { sectionId: true } },
    },
  });
  const initialRevisions = revisions.map((r) => ({
    id: r.id,
    sectionId: r.insight.sectionId,
    pointsBefore: r.pointsBefore,
    pointsAfter: r.pointsAfter,
    reason: r.reason,
    resolved: r.resolved,
    createdAt: r.createdAt.toISOString(),
  }));

  const flags = await prisma.flag.findMany({
    where: { reportId: id, type: "inkonsistensi" },
    orderBy: { createdAt: "desc" },
    select: { id: true, platform: true, section: true, note: true, createdAt: true },
  });
  const initialFlags = flags.map((f) => ({
    ...f,
    createdAt: f.createdAt.toISOString(),
  }));

  // Section aktif untuk platform report ini (urut narasi) — bahan dropdown label.
  const sections = await prisma.section.findMany({
    where: { status: "active", platform: { in: report.platforms } },
    orderBy: [{ platform: "asc" }, { narrativeOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      platform: true,
      narrativeOrder: true,
      usesPeriodComparison: true,
    },
  });

  const initialUploads = report.uploads.map((u) => ({
    id: u.id,
    sectionId: u.sectionId,
    sectionName: u.section.name,
    platform: u.platform,
    imageSrc: `/api/uploads/${u.id}/image`,
    periodMonth: u.periodMonth,
    isPrimaryPeriod: u.isPrimaryPeriod,
    extractions: u.extractions.map((e) => ({
      id: e.id,
      key: e.key,
      value: e.value,
      rawText: e.rawText,
      confidence: e.confidence,
      status: e.status,
      manuallyConfirmed: e.manuallyConfirmed,
    })),
  }));

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href="/dashboard/reports"
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          ← Kembali ke daftar report
        </Link>

        <div className="mt-4 flex items-center gap-2">
          {report.platforms.map((p) => (
            <span
              key={p}
              className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300"
            >
              {p === "shopee" ? "Shopee" : "TikTok"}
            </span>
          ))}
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
            {report.status}
          </span>
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold">{report.reportPeriod}</h1>

        <UploadManager
          reportId={report.id}
          platforms={report.platforms}
          sections={sections}
          initialUploads={initialUploads}
          initialInsights={initialInsights}
          initialConclusions={initialConclusions}
          initialRecommendations={recommendations}
          initialRevisions={initialRevisions}
          initialFlags={initialFlags}
        />
      </div>
    </div>
  );
}
