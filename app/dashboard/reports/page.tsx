import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { reportProgress } from "@/lib/reports";

// Daftar report siap-volume (~100 report/bulan): pencarian judul + filter periode/platform
// + pagination — SEMUA di sisi server (query DB, bukan filter client) supaya tetap ringan
// saat ribuan report. Form filter = GET polos (tanpa JS), konsisten pola server component.

const PAGE_SIZE = 20;

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

// Query string untuk link pagination — mempertahankan pencarian/filter aktif.
function buildQuery(params: Record<string, string>, page: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const q = first(sp.q).trim();
  const periode = first(sp.periode).trim();
  const platformRaw = first(sp.platform);
  const platform =
    platformRaw === "shopee" || platformRaw === "tiktok" ? platformRaw : "";
  const pageRaw = parseInt(first(sp.page), 10);

  // MODEL B (Jul 2026): semua akun terautentikasi melihat SEMUA report — operator
  // bekerja bergantian pada report yang sama (lihat aturan di lib/reports.ts).
  const where: Prisma.ReportWhereInput = {
    // Pencarian mencakup nama brand DAN periode (brand ditambahkan Jul 2026).
    ...(q
      ? {
          OR: [
            { brandName: { contains: q, mode: "insensitive" as const } },
            { reportPeriod: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(periode ? { reportPeriod: periode } : {}),
    ...(platform ? { platforms: { has: platform } } : {}),
  };

  const [total, periodRows] = await Promise.all([
    prisma.report.count({ where }),
    // Opsi dropdown periode: nilai unik yang benar-benar ada (murah — hanya satu kolom).
    prisma.report.findMany({
      distinct: ["reportPeriod"],
      // Report yang periodenya belum ditentukan (NULL) tidak jadi opsi filter.
      where: { reportPeriod: { not: null } },
      select: { reportPeriod: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const pageTotal = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(Number.isFinite(pageRaw) ? pageRaw : 1, 1), pageTotal);

  const reports = await prisma.report.findMany({
    where,
    orderBy: { createdAt: "desc" }, // terbaru dulu (default terkunci)
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      _count: { select: { uploads: true, insights: true, conclusions: true } },
      createdBy: { select: { email: true } },
    },
  });

  // Badge diturunkan dari data (Batch C). Butuh jumlah section & platform yang BENAR-BENAR
  // punya foto — tidak bisa dari _count. Satu groupBy untuk seluruh halaman (maks 20 report),
  // bukan query per baris.
  const uploadGroups = await prisma.upload.groupBy({
    by: ["reportId", "sectionId", "platform"],
    where: { reportId: { in: reports.map((r) => r.id) } },
  });
  const coverage = new Map<string, { sections: Set<string>; platforms: Set<string> }>();
  for (const g of uploadGroups) {
    const c = coverage.get(g.reportId) ?? { sections: new Set(), platforms: new Set() };
    c.sections.add(g.sectionId);
    c.platforms.add(g.platform);
    coverage.set(g.reportId, c);
  }

  const activeParams = { q, periode, platform };

  return (
    <div className="min-h-screen bg-ink text-fg">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <Link href="/dashboard" className="text-sm text-fg-3 transition-colors hover:text-fg">
          ← Kembali ke dashboard
        </Link>

        <div className="mt-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Generate report</h1>
          <Link
            href="/dashboard/reports/new"
            className="btn-primary px-4 py-2.5"
          >
            + Report baru
          </Link>
        </div>
        <p className="mt-1.5 text-sm text-fg-3">
          Buat report, unggah screenshot, lalu labeli tiap foto ke section.
        </p>

        {/* Pencarian + filter — GET form: query jalan di server, bisa di-bookmark */}
        <form
          method="GET"
          className="card mt-7 flex flex-wrap items-center gap-2 p-3"
        >
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Cari nama brand atau periode…"
            className="input min-w-40 flex-1"
          />
          <select
            name="periode"
            defaultValue={periode}
            className="select"
          >
            <option value="">Semua periode</option>
            {periodRows.map((p) => (
              <option key={p.reportPeriod as string} value={p.reportPeriod as string}>
                {p.reportPeriod}
              </option>
            ))}
          </select>
          <select
            name="platform"
            defaultValue={platform}
            className="select"
          >
            <option value="">Semua platform</option>
            <option value="shopee">Shopee</option>
            <option value="tiktok">TikTok</option>
          </select>
          <button
            type="submit"
            className="btn-ghost px-4 py-2"
          >
            Terapkan
          </button>
          {(q || periode || platform) && (
            <Link
              href="/dashboard/reports"
              className="text-xs text-fg-3 transition-colors hover:text-fg-2"
            >
              Reset
            </Link>
          )}
        </form>

        <p className="mt-4 text-xs font-mono text-fg-3">
          {total} report{total > PAGE_SIZE && ` · halaman ${page} dari ${pageTotal}`}
        </p>

        <div className="mt-3 space-y-3">
          {reports.length === 0 ? (
            <p className="text-sm text-fg-3">
              {total === 0 && !q && !periode && !platform
                ? "Belum ada report."
                : "Tidak ada report yang cocok dengan pencarian/filter."}
            </p>
          ) : (
            reports.map((r) => (
              <Link
                key={r.id}
                href={`/dashboard/reports/${r.id}`}
                className="card card-lift flex items-center justify-between px-5 py-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    {r.platforms.map((p) => (
                      <span
                        key={p}
                        className="badge bg-surface-2 text-fg-2 border border-line"
                      >
                        {p === "shopee" ? "Shopee" : "TikTok"}
                      </span>
                    ))}
                    {(() => {
                      const cov = coverage.get(r.id);
                      const p = reportProgress({
                        status: r.status,
                        uploadCount: r._count.uploads,
                        sectionsWithPhotos: cov?.sections.size ?? 0,
                        insightCount: r._count.insights,
                        platformsWithPhotos: cov?.platforms.size ?? 0,
                        conclusionCount: r._count.conclusions,
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
                  <p className="mt-2 text-sm font-medium text-fg">
                    {r.brandName ?? "Tanpa nama brand"}
                    <span className="ml-2 font-normal text-fg-3">· {r.reportPeriod ?? "periode belum ditentukan"}</span>
                  </p>
                  <p className="mt-1 text-xs text-fg-3">
                    {r.createdBy.email} ·{" "}
                    {r.createdAt.toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <span className="font-mono text-xs text-fg-3">{r._count.uploads} foto</span>
              </Link>
            ))
          )}
        </div>

        {/* Pagination server-side: link prev/next mempertahankan filter aktif */}
        {pageTotal > 1 && (
          <div className="mt-6 flex items-center justify-between">
            {page > 1 ? (
              <Link
                href={`/dashboard/reports${buildQuery(activeParams, page - 1)}`}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                ← Sebelumnya
              </Link>
            ) : (
              <span />
            )}
            <span className="font-mono text-xs text-fg-3">
              Halaman {page} / {pageTotal}
            </span>
            {page < pageTotal ? (
              <Link
                href={`/dashboard/reports${buildQuery(activeParams, page + 1)}`}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                Berikutnya →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
