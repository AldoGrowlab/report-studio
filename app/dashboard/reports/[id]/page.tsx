import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport, reportProgress } from "@/lib/reports";
import UploadManager from "./UploadManager";
import DeleteReportButton from "./DeleteReportButton";
import ReportPeriodField from "./ReportPeriodField";

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
          // metrics ikut dibaca supaya tabel koreksi tahu TIPE tiap angka — durasi
          // ditampilkan & diedit sebagai "1j 23mnt", bukan detik mentah.
          section: {
            select: { id: true, name: true, metrics: { select: { key: true, type: true } } },
          },
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
  // Audit P2/P3 — deteksi basi: kapan terakhir DATA (foto/angka) satu section berubah.
  // Max dari Upload.updatedAt & Extraction.updatedAt semua foto section itu. Kalau lebih
  // baru dari insight/kesimpulan yang sudah ada → tandai "angka berubah, generate ulang".
  const dataChangedAt = new Map<string, number>();
  const sectionPlatform = new Map<string, string>();
  for (const u of report.uploads) {
    sectionPlatform.set(u.sectionId, u.platform);
    const t = Math.max(
      u.updatedAt.getTime(),
      ...u.extractions.map((e) => e.updatedAt.getTime())
    );
    dataChangedAt.set(u.sectionId, Math.max(dataChangedAt.get(u.sectionId) ?? 0, t));
  }

  const initialInsights = insights.map((i) => ({
    ...i,
    updatedAt: i.updatedAt.toISOString(),
    stale: (dataChangedAt.get(i.sectionId) ?? 0) > i.updatedAt.getTime(),
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
  // Kesimpulan basi kalau ada insight se-platform yang di-generate ulang ATAU datanya
  // berubah SETELAH kesimpulan ditulis (kesimpulan merangkum poin insight yang kini beda).
  const initialConclusions = conclusions.map((c) => {
    const cTime = c.updatedAt.getTime();
    const stale = insights.some(
      (i) =>
        sectionPlatform.get(i.sectionId) === c.platform &&
        (i.updatedAt.getTime() > cTime || (dataChangedAt.get(i.sectionId) ?? 0) > cTime)
    );
    return { ...c, updatedAt: c.updatedAt.toISOString(), stale };
  });

  // Rekomendasi & Action Plan tersimpan (Fase A) — poin demi poin, ketikan user manual.
  const recommendations = await prisma.recommendation.findMany({
    where: { reportId: id },
    select: { platform: true, points: true },
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
    // Jul 2026: flag "periode" (screenshot salah bulan) tampil di panel yang sama.
    where: { reportId: id, type: { in: ["inkonsistensi", "periode"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, platform: true, section: true, note: true, type: true, severity: true, createdAt: true },
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

  const initialUploads = report.uploads.map((u) => {
    // Tipe metrik dicocokkan per key. Metrik yang sudah dihapus dari section tapi
    // angkanya masih tersimpan jatuh ke "number" — apa adanya, seperti sebelumnya.
    const typeByKey = new Map(u.section.metrics.map((m) => [m.key, m.type]));
    return {
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
        type: typeByKey.get(e.key) ?? "number",
      })),
    };
  });

  return (
    <div className="min-h-screen bg-ink text-fg">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <Link
          href="/dashboard/reports"
          className="text-sm text-fg-3 transition-colors hover:text-fg"
        >
          ← Kembali ke daftar report
        </Link>

        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {report.platforms.map((p) => (
                <span
                  key={p}
                  className="badge border border-line bg-surface-2 text-fg-2"
                >
                  {p === "shopee" ? "Shopee" : "TikTok"}
                </span>
              ))}
              {(() => {
                // Aturan badge sama persis dengan daftar report (lib/reports.ts) —
                // datanya sudah ada di halaman ini, tak perlu query tambahan.
                const p = reportProgress({
                  status: report.status,
                  uploadCount: report.uploads.length,
                  sectionsWithPhotos: new Set(report.uploads.map((u) => u.sectionId)).size,
                  insightCount: insights.length,
                  platformsWithPhotos: new Set(report.uploads.map((u) => u.platform)).size,
                  conclusionCount: conclusions.length,
                  hasStale:
                    initialInsights.some((i) => i.stale) ||
                    initialConclusions.some((c) => c.stale),
                });
                return (
                  <span
                    className={`badge ${
                      p.tone === "ok"
                        ? "bg-ok/15 text-ok"
                        : p.tone === "warn"
                          ? "bg-warn/15 text-warn"
                          : "bg-surface-2 text-fg-3 border border-line"
                    }`}
                  >
                    {p.label}
                  </span>
                );
              })()}
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold">
              {report.brandName ?? "Tanpa nama brand"}
            </h1>
            <ReportPeriodField
              reportId={report.id}
              initialPeriod={report.reportPeriod}
              initialDetected={report.periodDetected}
            />
          </div>
          <DeleteReportButton reportId={report.id} />
        </div>

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
