"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tombol hapus report (Jul 2026). Konfirmasi dulu; server menghapus file storage semua
// upload lalu cascade DB. Sukses -> kembali ke daftar report.
export default function DeleteReportButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    if (
      !window.confirm(
        "Hapus report ini beserta semua foto, ekstraksi, insight, dan kesimpulannya? Tindakan ini tidak bisa dibatalkan."
      )
    ) {
      return;
    }
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/${reportId}`, { method: "DELETE" });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Gagal menghapus report.");
        setDeleting(false);
        return;
      }
      router.push("/dashboard/reports");
    } catch {
      setError("Kesalahan jaringan.");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={handleDelete} disabled={deleting} className="btn-danger px-3 py-1.5">
        {deleting ? "Menghapus…" : "Hapus report"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
