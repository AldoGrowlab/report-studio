import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Founder lihat semua report; user hanya miliknya.
  const reports = await prisma.report.findMany({
    where: session.role === "founder" ? {} : { createdById: session.userId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { uploads: true } } },
  });

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

        <div className="mt-6 space-y-3">
          {reports.length === 0 ? (
            <p className="text-sm text-neutral-500">Belum ada report.</p>
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
                </div>
                <span className="text-xs text-neutral-500">{r._count.uploads} foto</span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
