import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPrimaryMonth,
  periodMonthOptions,
  matchMonthToPair,
  displayReportPeriod,
  type PeriodPair,
} from "./report-period";

const pair = (periodeUtama: string | null, periodePembanding: string | null = null): PeriodPair => ({
  periodeUtama,
  periodePembanding,
});

test("isPrimaryMonth: turunan dari periode utama", () => {
  assert.equal(isPrimaryMonth(pair("2026-02", "2026-01"), "2026-02"), true);
  assert.equal(isPrimaryMonth(pair("2026-02", "2026-01"), "2026-01"), false);
  assert.equal(isPrimaryMonth(pair("2026-02"), "2026-02"), true);
  assert.equal(isPrimaryMonth(pair(null), "2026-02"), false); // utama belum ditetapkan
  assert.equal(isPrimaryMonth(pair("2026-02"), null), false);
  assert.equal(isPrimaryMonth(pair("2026-02"), undefined), false);
});

test("periodMonthOptions: 2 opsi, 1 bila pembanding kosong", () => {
  assert.deepEqual(periodMonthOptions(pair("2026-02", "2026-01")), ["2026-02", "2026-01"]);
  assert.deepEqual(periodMonthOptions(pair("2026-02")), ["2026-02"]);
  assert.deepEqual(periodMonthOptions(pair(null)), []);
  // Utama & pembanding sama -> jangan tampil dobel.
  assert.deepEqual(periodMonthOptions(pair("2026-02", "2026-02")), ["2026-02"]);
});

test("matchMonthToPair", () => {
  const p = pair("2026-02", "2026-01");
  assert.equal(matchMonthToPair(p, "2026-02"), "utama");
  assert.equal(matchMonthToPair(p, "2026-01"), "pembanding");
  assert.equal(matchMonthToPair(p, "2026-03"), "lain");
  assert.equal(matchMonthToPair(p, null), "lain");
  assert.equal(matchMonthToPair(pair(null), "2026-02"), "lain");
});

test("displayReportPeriod: kanonik > reportPeriod lama > fallback", () => {
  // Bulan kanonik -> dibahasakan.
  assert.equal(displayReportPeriod({ periodeUtama: "2026-02", reportPeriod: "apa pun" }), "Februari 2026");
  // REGRESI: label kustom lama tampil PERSIS (periodeUtama null karena tak terparse).
  assert.equal(displayReportPeriod({ periodeUtama: null, reportPeriod: "Q2 2026" }), "Q2 2026");
  assert.equal(displayReportPeriod({ periodeUtama: null, reportPeriod: "Kuartal Lebaran" }), "Kuartal Lebaran");
  // Keduanya kosong -> fallback.
  assert.equal(displayReportPeriod({ periodeUtama: null, reportPeriod: null }), "Periode belum ditentukan");
  assert.equal(displayReportPeriod({ periodeUtama: null, reportPeriod: "  " }), "Periode belum ditentukan");
  // periodeUtama tak valid (data korup) -> jatuh ke label lama, bukan crash.
  assert.equal(displayReportPeriod({ periodeUtama: "bukan-bulan", reportPeriod: "Juni 2026" }), "Juni 2026");
});
