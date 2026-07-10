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
      const data = await res.json();
      setFlags(data.flags || []);
      setLoading(false);
    })();
  }, [router]);

  const groups = groupFlags(flags);
  const reportCount = new Set(flags.map((f) => f.report.id)).size;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          ← Dashboard
        </button>
        <h1 className="mt-4 text-2xl font-semibold">Dashboard Flag</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Akumulasi flag lintas report, dikelompokkan per platform + section. Kombinasi yang
          sering ke-flag adalah sinyal KB section itu perlu dipertajam.
        </p>

        {loading ? (
          <p className="mt-8 text-sm text-neutral-500">Memuat…</p>
        ) : flags.length === 0 ? (
          <div className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-center">
            <p className="text-sm text-neutral-300">Belum ada flag. 🎉</p>
            <p className="mt-1 text-xs text-neutral-500">
              Flag muncul otomatis saat pipeline menemukan masalah — mis. inkonsistensi
              narasi yang tak selesai setelah revisi Validator (saat &ldquo;Buat
              kesimpulan&rdquo;).
            </p>
          </div>
        ) : (
          <>
            <p className="mt-6 text-xs text-neutral-500">
              {flags.length} flag · {groups.length} kombinasi section · {reportCount} report
              tersentuh
            </p>

            <div className="mt-3 space-y-4">
              {groups.map((g) => (
                <div
                  key={`${g.platform}-${g.section}`}
                  className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300">
                      {PLATFORM_LABEL[g.platform]}
                    </span>
                    <span className="text-sm font-medium text-neutral-100">{g.section}</span>
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                      {g.count}× ke-flag · {g.reportCount} report
                    </span>
                    {g.tinggiCount > 0 && (
                      <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300">
                        {g.tinggiCount} severity tinggi
                      </span>
                    )}
                  </div>
                  {g.count >= 2 && (
                    <p className="mt-1.5 text-xs text-amber-300/80">
                      Sering muncul — pertimbangkan pertajam KB section ini.
                    </p>
                  )}

                  <ul className="mt-3 space-y-2.5">
                    {g.flags.map((f) => (
                      <li
                        key={f.id}
                        className="rounded-lg border border-neutral-800 bg-neutral-950 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
                            {f.type}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              f.severity === "tinggi"
                                ? "bg-red-500/15 text-red-300"
                                : "bg-amber-500/15 text-amber-300"
                            }`}
                          >
                            {f.severity}
                          </span>
                          <Link
                            href={`/dashboard/reports/${f.report.id}`}
                            className="text-xs text-blue-400 hover:text-blue-300"
                          >
                            Report {f.report.reportPeriod} →
                          </Link>
                          <span className="text-[10px] text-neutral-600">
                            {new Date(f.createdAt).toLocaleString("id-ID")}
                          </span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-line text-xs text-neutral-300">
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
