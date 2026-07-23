// Tahap 6b — logika periode (perbandingan antar bulan), MURNI & deterministik.
// Bulan disimpan kanonik "YYYY-MM" (Upload.periodMonth): urut kronologis = urut string,
// perbandingan berantai tinggal sort. Label Indonesia ("Juni 2026") HANYA di render.

import type { MetricType } from "@prisma/client";

const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

// "YYYY-MM" dengan bulan 01–12.
export function isValidPeriodMonth(value: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

// "2026-06" -> "Juni 2026". Nilai tak valid dikembalikan apa adanya (jangan crash render).
export function formatMonthID(periodMonth: string): string {
  if (!isValidPeriodMonth(periodMonth)) return periodMonth;
  const [year, month] = periodMonth.split("-");
  return `${MONTH_NAMES_ID[Number(month) - 1]} ${year}`;
}

export type MonthOption = { value: string; label: string };

// Daftar bulan untuk dropdown penanda periode: `count` bulan terakhir BERJALAN dari `now`
// (bulan ini dulu, mundur ke belakang). Default pemakaian: 13 bulan.
export function monthOptions(now: Date, count: number): MonthOption[] {
  const options: MonthOption[] = [];
  let year = now.getFullYear();
  let month = now.getMonth() + 1; // 1–12
  for (let i = 0; i < count; i++) {
    const value = `${year}-${String(month).padStart(2, "0")}`;
    options.push({ value, label: formatMonthID(value) });
    month--;
    if (month === 0) {
      month = 12;
      year--;
    }
  }
  return options;
}

// ---- Perhitungan perubahan antar periode (Tahap 6b-B) ----
// DETERMINISTIK DI KODE dari angka Extraction — BUKAN oleh LLM (Prinsip #1, pola sama
// dengan normalisasi notasi). Persen/pp = TURUNAN dihitung saat generate: tidak pernah
// disimpan sebagai baris Extraction; hanya jadi teks poin + anggota Insight.numbers.

export type PeriodMetric = {
  key: string;
  label: string;
  type: MetricType;
  value: number | null;
  valueText: string | null; // bentuk singkat (Prinsip #6) — yang boleh dikutip model
};

export type PeriodData = {
  month: string; // "YYYY-MM" — satu foto per bulan (ditegakkan server)
  metrics: PeriodMetric[];
};

export type PeriodChange = {
  key: string;
  label: string;
  fromMonth: string; // "YYYY-MM" bulan lebih lama
  toMonth: string; // "YYYY-MM" bulan lebih baru
  fromText: string; // valueText bulan lama
  toText: string; // valueText bulan baru
  changeText: string; // "+15,3%" / "-4,0%" / "0,0%" — atau "+0,12 pp" utk metrik persen
};

// Relatif, id-ID 1 desimal bertanda; dibulatkan DULU supaya -0,04% tidak jadi "-0,0%".
function formatRelativeChange(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  if (rounded === 0) return "0,0%";
  const sign = rounded > 0 ? "+" : "-";
  return `${sign}${Math.abs(rounded).toFixed(1).replace(".", ",")}%`;
}

// Metrik bertipe PERSEN: selisih POIN PERSENTASE (keputusan Jul 2026) — "+0,12 pp",
// 2 desimal. Rumus relatif untuk persen ambigu (4,28%→4,4% "naik 2,8%" terbaca pp).
function formatPointChange(diff: number): string {
  const rounded = Math.round(diff * 100) / 100;
  if (rounded === 0) return "0,00 pp";
  const sign = rounded > 0 ? "+" : "-";
  return `${sign}${Math.abs(rounded).toFixed(2).replace(".", ",")} pp`;
}

// Perubahan BERANTAI: tiap bulan vs bulan tepat sebelumnya dalam urutan kronologis —
// April,Mei,Juni → "Mei vs April" DAN "Juni vs Mei" (semua periode terpakai).
// ATURAN LEWATI (tanpa mengarang): metrik tak ada di salah satu sisi; value null di
// salah satu sisi; pembagi 0 (nilai lama = 0, hanya relevan rumus relatif).
export function computeChainedChanges(periods: PeriodData[]): PeriodChange[] {
  const sorted = [...periods].sort((a, b) => a.month.localeCompare(b.month));
  const changes: PeriodChange[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const older = sorted[i - 1];
    const newer = sorted[i];
    const olderByKey = new Map(older.metrics.map((m) => [m.key, m]));

    for (const cur of newer.metrics) {
      const prev = olderByKey.get(cur.key);
      if (!prev) continue; // metrik tak ada di periode pembanding
      // Metrik TEKS bukan besaran — tidak pernah dihitung naik/turun. (value-nya memang
      // selalu null sehingga guard di bawah sudah cukup; ini eksplisit supaya niatnya
      // terbaca dan tetap benar kalau bentuk data berubah.)
      if (cur.type === "text" || prev.type === "text") continue;
      if (cur.value === null || prev.value === null) continue;
      if (cur.valueText === null || prev.valueText === null) continue;

      let changeText: string;
      if (cur.type === "percent") {
        changeText = formatPointChange(cur.value - prev.value);
      } else {
        if (prev.value === 0) continue; // pembagi 0 — persen tak terdefinisi
        changeText = formatRelativeChange(((cur.value - prev.value) / prev.value) * 100);
      }

      changes.push({
        key: cur.key,
        label: cur.label,
        fromMonth: older.month,
        toMonth: newer.month,
        fromText: prev.valueText,
        toText: cur.valueText,
        changeText,
      });
    }
  }
  return changes;
}
