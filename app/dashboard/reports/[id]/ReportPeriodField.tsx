"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Periode report yang bisa diedit di tempat (Jul 2026, Deteksi Bulan Otomatis).
//
// Aturan yang dijaga di sini: nilai hasil DETEKSI diberi badge "terdeteksi dari foto",
// dan begitu operator menyuntingnya, badge hilang dan suntingan itu MENANG PERMANEN —
// server menyetel periodDetected=false sehingga ekstraksi berikutnya tidak pernah
// menimpanya lagi. Autofill hanya berlaku saat nilainya masih kosong.
export default function ReportPeriodField({
  reportId,
  initialPeriod,
  initialDetected,
}: {
  reportId: string;
  initialPeriod: string | null;
  initialDetected: boolean;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState(initialPeriod ?? "");
  const [detected, setDetected] = useState(initialDetected);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialPeriod ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportPeriod: draft }),
      });
      if (res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Gagal menyimpan (kode ${res.status}).`);
        return;
      }
      setPeriod(data.report?.reportPeriod ?? "");
      // Disunting manusia -> bukan lagi hasil deteksi.
      setDetected(Boolean(data.report?.periodDetected));
      setEditing(false);
      // Periode ikut ke cover PPT, nama berkas, dan prompt Validator — muat ulang data
      // server supaya bagian lain halaman tidak memakai nilai lama.
      router.refresh();
    } catch {
      setError("Kesalahan jaringan.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="mt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
            placeholder="mis. Juni 2026"
            className="input w-48 px-2 py-1 text-sm"
          />
          <button onClick={save} disabled={saving} className="btn-primary px-3 py-1 text-xs">
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="btn-ghost px-3 py-1 text-xs"
          >
            Batal
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-2">
      <p className={`text-sm ${period ? "text-fg-3" : "text-warn"}`}>
        {period || "Periode belum ditentukan"}
      </p>
      {detected && period && (
        <span
          title="Diisi otomatis dari teks periode yang terbaca di screenshot. Ubah kapan saja."
          className="badge bg-accent/15 px-2 text-[10px] text-accent-hi"
        >
          terdeteksi dari foto
        </span>
      )}
      <button
        onClick={() => {
          setDraft(period);
          setError("");
          setEditing(true);
        }}
        className="text-[11px] text-fg-3 underline underline-offset-2 hover:text-fg-2"
      >
        Ubah
      </button>
    </div>
  );
}
