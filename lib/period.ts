// Tahap 6b — logika periode (perbandingan antar bulan), MURNI & deterministik.
// Bulan disimpan kanonik "YYYY-MM" (Upload.periodMonth): urut kronologis = urut string,
// perbandingan berantai tinggal sort. Label Indonesia ("Juni 2026") HANYA di render.

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
