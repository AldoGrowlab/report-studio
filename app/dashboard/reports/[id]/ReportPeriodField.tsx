"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMonthID } from "@/lib/period";
import { displayReportPeriod } from "@/lib/report-period";

// 13 bulan terakhir berjalan (kanonik "YYYY-MM"), dihitung sekali.
function buildMonthOptions(now: Date) {
  const opts: { value: string; label: string }[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  for (let i = 0; i < 13; i++) {
    const value = `${y}-${String(m).padStart(2, "0")}`;
    opts.push({ value, label: formatMonthID(value) });
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return opts;
}

// Periode report (Poin 2c) — TAMPILAN + EDITOR PASANGAN bulan. Mengubah pasangan mengubah
// status "periode utama" semua foto (turunan) dan menghitung ulang kontribusi; karena itu
// disertai KONFIRMASI. Foto berlabel di luar pasangan baru tidak dipetakan ulang — jadi
// anomali yang diperingatkan di daftar foto.
export default function ReportPeriodField({
  reportId,
  periodeUtama,
  periodePembanding,
  reportPeriod,
  detected,
}: {
  reportId: string;
  periodeUtama: string | null;
  periodePembanding: string | null;
  reportPeriod: string | null;
  detected: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [utama, setUtama] = useState(periodeUtama ?? "");
  const [pembanding, setPembanding] = useState(periodePembanding ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [monthOptions] = useState(() => buildMonthOptions(new Date()));

  const label = displayReportPeriod({ periodeUtama, reportPeriod });
  const hasPeriod = Boolean(periodeUtama) || Boolean(reportPeriod?.trim());

  async function save() {
    if (
      !window.confirm(
        "Mengubah pasangan bulan mengubah status periode utama semua foto dan menghitung " +
          "ulang kontribusi. Foto yang bulannya di luar pasangan baru akan ditandai anomali " +
          "(tidak dipindah otomatis). Lanjutkan?"
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodeUtama: utama || null, periodePembanding: pembanding || null }),
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
      setEditing(false);
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
          <select
            value={utama}
            onChange={(e) => {
              const v = e.target.value;
              setUtama(v);
              if (!v || v === pembanding) setPembanding("");
            }}
            className="select px-2 py-1 text-sm"
          >
            <option value="">— utama: tak ditentukan —</option>
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>
                Utama: {o.label}
              </option>
            ))}
          </select>
          <select
            value={pembanding}
            onChange={(e) => setPembanding(e.target.value)}
            disabled={!utama}
            className="select px-2 py-1 text-sm disabled:opacity-50"
          >
            <option value="">— tanpa pembanding —</option>
            {monthOptions
              .filter((o) => o.value !== utama)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  vs {o.label}
                </option>
              ))}
          </select>
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
      <p className={`text-sm ${hasPeriod ? "text-fg-3" : "text-warn"}`}>{label}</p>
      {periodePembanding && (
        <span
          title="Periode pembanding — dipakai section perbandingan antar bulan."
          className="badge border border-line bg-surface-2 px-2 text-[10px] text-fg-3"
        >
          vs {formatMonthID(periodePembanding)}
        </span>
      )}
      {detected && periodeUtama && (
        <span
          title="Periode utama terisi otomatis dari teks periode yang terbaca di screenshot."
          className="badge bg-accent/15 px-2 text-[10px] text-accent-hi"
        >
          terdeteksi dari foto
        </span>
      )}
      <button
        onClick={() => {
          setUtama(periodeUtama ?? "");
          setPembanding(periodePembanding ?? "");
          setError("");
          setEditing(true);
        }}
        className="text-[11px] text-fg-3 underline underline-offset-2 hover:text-fg-2"
      >
        Ubah periode
      </button>
    </div>
  );
}
