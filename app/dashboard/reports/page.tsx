import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

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
    ...(q ? { reportPeriod: { contains: q, mode: "insensitive" } } : {}),
    ...(periode ? { reportPeriod: periode } : {}),
    ...(platform ? { platforms: { has: platform } } : {}),
  };

  const [total, periodRows] = await Promise.all([
    prisma.report.count({ where }),
    // Opsi dropdown periode: nilai unik yang benar-benar ada (murah — hanya satu kolom).
    prisma.report.findMany({
      distinct: ["reportPeriod"],
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
      _count: { select: { uploads: true } },
      createdBy: { select: { email: true } },
    },
  });

  const activeParams = { q, periode, platform };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">
          ← Kembali ke dashboard
        </Link>

        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Generate report</h1>
          <Link
            href="/dashboard/reports/new"
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            + Report baru
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-400">
          Buat report, unggah screenshot, lalu labeli tiap foto ke section.
        </p>

        {/* Pencarian + filter — GET form: query jalan di server, bisa di-bookmark */}
        <form
          method="GET"
          className="mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-3"
        >
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Cari judul report…"
            className="min-w-40 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <select
            name="periode"
            defaultValue={periode}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">Semua periode</option>
            {periodRows.map((p) => (
              <option key={p.reportPeriod} value={p.reportPeriod}>
                {p.reportPeriod}
              </option>
            ))}
          </select>
          <select
            name="platform"
            defaultValue={platform}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">Semua platform</option>
            <option value="shopee">Shopee</option>
            <option value="tiktok">TikTok</option>
          </select>
          <button
            type="submit"
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            Terapkan
          </button>
          {(q || periode || platform) && (
            <Link
              href="/dashboard/reports"
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              Reset
            </Link>
          )}
        </form>

        <p className="mt-3 text-xs text-neutral-500">
          {total} report{total > PAGE_SIZE && ` · halaman ${page} dari ${pageTotal}`}
        </p>

        <div className="mt-3 space-y-3">
          {reports.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {total === 0 && !q && !periode && !platform
                ? "Belum ada report."
                : "Tidak ada report yang cocok dengan pencarian/filter."}
            </p>
          ) : (
            reports.map((r) => (
              <Link
                key={r.id}
                href={`/dashboard/reports/${r.id}`}
                className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-5 py-4 hover:border-neutral-700 hover:bg-neutral-800"
              >
                <div>
                  <div className="flex items-center gap-2">
                    {r.platforms.map((p) => (
                      <span
                        key={p}
                        className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300"
                      >
                        {p === "shopee" ? "Shopee" : "TikTok"}
                      </span>
                    ))}
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        r.status === "done"
                          ? "bg-teal-500/15 text-teal-300"
                          : r.status === "processing"
                            ? "bg-blue-500/15 text-blue-300"
                            : "bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-neutral-100">{r.reportPeriod}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {r.createdBy.email} ·{" "}
                    {r.createdAt.toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <span className="text-xs text-neutral-500">{r._count.uploads} foto</span>
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
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
              >
                ← Sebelumnya
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-neutral-500">
              Halaman {page} / {pageTotal}
            </span>
            {page < pageTotal ? (
              <Link
                href={`/dashboard/reports${buildQuery(activeParams, page + 1)}`}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
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
