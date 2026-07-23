"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMonthID } from "@/lib/period";

type Platform = "shopee" | "tiktok";

// Opsi periode: bulan lalu / ini / depan — nilai = label bulan sebenarnya ("Juli 2026")
// supaya bermakna di report; teks opsi menjelaskan posisinya. Dihitung sekali saat mount.
function buildPeriodOptions(now: Date) {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-11
  const monthLabel = (offset: number) => {
    const d = new Date(y, m + offset, 1);
    return formatMonthID(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  return [
    { value: monthLabel(-1), text: `Bulan lalu — ${monthLabel(-1)}` },
    { value: monthLabel(0), text: `Bulan ini — ${monthLabel(0)}` },
    { value: monthLabel(1), text: `Bulan depan — ${monthLabel(1)}` },
  ];
}

export default function NewReportPage() {
  const router = useRouter();
  // Satu report boleh mencakup dua platform sekaligus — PPT-nya jadi satu file dengan
  // blok Shopee lalu blok TikTok. Urutan kanonik ditegakkan lagi di server.
  const [platforms, setPlatforms] = useState<Platform[]>(["shopee"]);
  const togglePlatform = (p: Platform) =>
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  const [brandName, setBrandName] = useState("");
  const [periodOptions] = useState(() => buildPeriodOptions(new Date()));
  const [reportPeriod, setReportPeriod] = useState(() => buildPeriodOptions(new Date())[1].value);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms, brandName, reportPeriod }),
      });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Gagal membuat report.");
        setSubmitting(false);
        return;
      }
      router.push(`/dashboard/reports/${data.report.id}`);
    } catch {
      setError("Terjadi kesalahan jaringan.");
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-grid-texture min-h-screen bg-ink text-fg">
      <div className="mx-auto max-w-md px-6 py-14">
        <button
          onClick={() => router.push("/dashboard/reports")}
          className="text-sm text-fg-3 transition-colors hover:text-fg"
        >
          ← Kembali
        </button>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Report baru</h1>
        <p className="mt-1.5 text-sm text-fg-3">
          Isi nama brand, platform, dan periode. Setelah dibuat, kamu bisa unggah &amp; labeli
          screenshot.
        </p>

        <div className="card mt-7 space-y-5 p-6">
          <div>
            <label className="label-sm mb-1.5 block">Nama brand</label>
            <input
              type="text"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !submitting && platforms.length > 0 && handleCreate()
              }
              maxLength={120}
              className="input w-full"
              placeholder="mis. Toko Sepatu Aurora"
            />
          </div>
          <div>
            <label className="label-sm mb-1.5 block">Platform</label>
            <div className="grid grid-cols-2 gap-2">
              {(["shopee", "tiktok"] as const).map((p) => {
                const active = platforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={active}
                    onClick={() => togglePlatform(p)}
                    className={`rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                      active
                        ? "border-accent bg-accent/10 text-fg"
                        : "border-line bg-surface-2 text-fg-3 hover:text-fg-2"
                    }`}
                  >
                    {p === "shopee" ? "Shopee" : "TikTok"}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-fg-3">
              Pilih dua-duanya kalau report ini mencakup Shopee dan TikTok — hasilnya satu
              PPT dengan dua bagian.
            </p>
          </div>
          <div>
            <label className="label-sm mb-1.5 block">Periode report</label>
            <select
              value={reportPeriod}
              onChange={(e) => setReportPeriod(e.target.value)}
              className="select w-full"
            >
              {/* Jul 2026 — boleh dikosongkan: bulan terisi sendiri dari teks periode yang
                  terbaca di screenshot pertama yang diekstrak (lihat DESIGN §Deteksi Bulan). */}
              <option value="">— deteksi dari foto —</option>
              {periodOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.text}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-fg-3">
              Kosongkan untuk mengisi otomatis dari periode yang tertulis di screenshot.
              Bisa diubah kapan saja di halaman report.
            </p>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={submitting || platforms.length === 0}
            className="btn-primary w-full py-2.5"
          >
            {submitting ? "Membuat…" : "Buat report"}
          </button>
        </div>
      </div>
    </div>
  );
}
