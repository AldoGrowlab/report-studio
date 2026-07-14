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
          Pilih platform dan periode. Setelah dibuat, kamu bisa unggah &amp; labeli screenshot.
        </p>

        <div className="card mt-7 space-y-5 p-6">
          <div>
            <label className="label-sm mb-1.5 block">Platform</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className="select w-full"
            >
              <option value="shopee">Shopee</option>
              <option value="tiktok">TikTok</option>
            </select>
          </div>
          <div>
            <label className="label-sm mb-1.5 block">Periode report</label>
            <input
              type="text"
              value={reportPeriod}
              onChange={(e) => setReportPeriod(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="input w-full"
              placeholder="mis. Juni 2026"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            onClick={handleCreate}
            disabled={submitting}
            className="btn-primary w-full py-2.5"
          >
            {submitting ? "Membuat…" : "Buat report"}
          </button>
        </div>
      </div>
    </div>
  );
}
