"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { groupFlags, type FlagItem } from "@/lib/flags-view";

// Tahap 9 — dashboard flag founder: ALAT PERBAIKAN KB, bukan sekadar daftar error
// (DESIGN §Sistem Flag). Flag lintas report dikelompokkan per (platform, section) dengan
// frekuensi — kombinasi yang sering muncul = sinyal KB section itu perlu dipertajam.
// READ-ONLY: tanpa aksi selesai/hapus; tiap flag menaut ke report asalnya.

const PLATFORM_LABEL: Record<"shopee" | "tiktok", string> = {
  shopee: "Shopee",
  tiktok: "TikTok",
};

export default function FlagsPage() {
  const router = useRouter();
  const [flags, setFlags] = useState<FlagItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Muat awal di-inline (setState setelah await — lihat catatan lint di halaman sections).
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/flags");
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setFlags(data.flags || []);
      setLoading(false);
    })();
  }, [router]);

  const groups = groupFlags(flags);
  const reportCount = new Set(flags.map((f) => f.report.id)).size;

  return (
    <div className="min-h-screen bg-ink text-fg">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-fg-3 transition-colors hover:text-fg"
        >
          ← Dashboard
        </button>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Dashboard Flag</h1>
        <p className="mt-1.5 text-sm text-fg-3">
          Akumulasi flag lintas report, dikelompokkan per platform + section. Kombinasi yang
          sering ke-flag adalah sinyal KB section itu perlu dipertajam.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-fg-3">Memuat…</p>
        ) : flags.length === 0 ? (
          <div className="mt-8 card p-6 text-center">
            <p className="text-sm text-fg-2">Belum ada flag. 🎉</p>
            <p className="mt-1 text-xs text-fg-3">
              Flag muncul otomatis saat pipeline menemukan masalah — mis. inkonsistensi
              narasi yang tak selesai setelah revisi Validator (saat &ldquo;Buat
              kesimpulan&rdquo;).
            </p>
          </div>
        ) : (
          <>
            <p className="mt-6 font-mono text-xs text-fg-3">
              {flags.length} flag · {groups.length} kombinasi section · {reportCount} report
              tersentuh
            </p>

            <div className="mt-3 space-y-4">
              {groups.map((g) => (
                <div
                  key={`${g.platform}-${g.section}`}
                  className="card p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge border border-line bg-surface-2 text-fg-2">
                      {PLATFORM_LABEL[g.platform]}
                    </span>
                    <span className="text-sm font-medium text-fg">{g.section}</span>
                    <span className="badge bg-warn/15 font-semibold text-warn">
                      {g.count}× ke-flag · {g.reportCount} report
                    </span>
                    {g.tinggiCount > 0 && (
                      <span className="badge bg-danger/15 font-semibold text-danger">
                        {g.tinggiCount} severity tinggi
                      </span>
                    )}
                  </div>
                  {g.count >= 2 && (
                    <p className="mt-1.5 text-xs text-warn/80">
                      Sering muncul — pertimbangkan pertajam KB section ini.
                    </p>
                  )}

                  <ul className="mt-3 space-y-2.5">
                    {g.flags.map((f) => (
                      <li
                        key={f.id}
                        className="rounded-[10px] border border-line bg-ink p-3.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="badge bg-surface-2 text-[10px] text-fg-3">
                            {f.type}
                          </span>
                          <span
                            className={`badge text-[10px] ${
                              f.severity === "tinggi"
                                ? "bg-danger/15 text-danger"
                                : "bg-warn/15 text-warn"
                            }`}
                          >
                            {f.severity}
                          </span>
                          <Link
                            href={`/dashboard/reports/${f.report.id}`}
                            className="text-xs text-accent transition-colors hover:text-accent-hi"
                          >
                            Report {f.report.reportPeriod} →
                          </Link>
                          <span className="text-[10px] text-fg-3">
                            {new Date(f.createdAt).toLocaleString("id-ID")}
                          </span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-line text-xs text-fg-2">
                          {f.note}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
