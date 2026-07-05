"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Platform = "shopee" | "tiktok";

export default function NewReportPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>("shopee");
  const [reportPeriod, setReportPeriod] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, reportPeriod }),
      });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
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
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-md px-6 py-10">
        <button
          onClick={() => router.push("/dashboard/reports")}
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          ← Kembali
        </button>

        <h1 className="mt-4 text-2xl font-semibold">Report baru</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Pilih platform dan periode. Setelah dibuat, kamu bisa unggah & labeli screenshot.
        </p>

        <div className="mt-6 space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">Platform</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            >
              <option value="shopee">Shopee</option>
              <option value="tiktok">TikTok</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Periode report
            </label>
            <input
              type="text"
              value={reportPeriod}
              onChange={(e) => setReportPeriod(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              placeholder="mis. Juni 2026"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? "Membuat…" : "Buat report"}
          </button>
        </div>
      </div>
    </div>
  );
}
