"use client";

import { formatMonthID } from "@/lib/period";
import { displayReportPeriod } from "@/lib/report-period";

// Periode report (Poin 2) — pasangan bulan level report. Di 2b TAMPILAN saja: menampilkan
// periode utama (+ pembanding bila ada) dengan aturan tampilan tunggal displayReportPeriod.
// Edit pasangan (dengan konfirmasi + warning anomali) menyusul di 2c; tombol edit teks bebas
// lama dibuang karena reportPeriod kini hanya label turunan, bukan sumber yang boleh disunting.
export default function ReportPeriodField({
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
  const label = displayReportPeriod({ periodeUtama, reportPeriod });
  const hasPeriod = Boolean(periodeUtama) || Boolean(reportPeriod?.trim());

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
    </div>
  );
}
