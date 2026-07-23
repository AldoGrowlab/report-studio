import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePeriodText, toPeriodMonth, samePeriod } from "./period-parser";

const JUN26 = { month: 6, year: 2026 };

test("rentang tanggal dalam SATU bulan -> bulan itu", () => {
  const cases = [
    "01/06/2026 - 30/06/2026",
    "1/6/2026 - 30/6/2026",
    "01-06-2026 - 30-06-2026",
    "01.06.2026 - 30.06.2026",
    "01/06/2026 – 30/06/2026", // en dash
    "01/06/2026 — 30/06/2026", // em dash
    "01/06/2026 s/d 30/06/2026",
    "01/06/2026 sd 30/06/2026",
    "01/06/2026 sampai 30/06/2026",
    "01/06/2026 to 30/06/2026",
    "Periode: 01/06/2026 - 30/06/2026",
  ];
  for (const c of cases) assert.deepEqual(parsePeriodText(c), JUN26, c);
});

test("rentang LINTAS bulan -> null", () => {
  const cases = [
    "01/06/2026 - 15/07/2026",
    "28/05/2026 - 27/06/2026",
    "28/05 - 30/06/2026", // tanggal awal tanpa tahun, bulan tetap terhitung
    "28 Mei - 30 Juni 2026",
    "Juni 2026 - Juli 2026",
    "31/12/2025 - 01/01/2026",
  ];
  for (const c of cases) assert.equal(parsePeriodText(c), null, c);
});

test("bulan sama tapi TAHUN beda -> null", () => {
  assert.equal(parsePeriodText("Juni 2026 - Juni 2027"), null);
  assert.equal(parsePeriodText("01/06/2025 - 30/06/2026"), null);
});

test("nama bulan Indonesia & Inggris + singkatan", () => {
  const cases = [
    "Juni 2026",
    "juni 2026",
    "JUNI 2026",
    "Jun 2026",
    "June 2026",
    "1 Juni 2026",
    "1 - 30 Juni 2026",
    "Data bulan Juni 2026",
    "Juni, 2026",
  ];
  for (const c of cases) assert.deepEqual(parsePeriodText(c), JUN26, c);
});

test("semua nama bulan terpetakan benar", () => {
  const id = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  id.forEach((name, i) => assert.deepEqual(parsePeriodText(`${name} 2026`), { month: i + 1, year: 2026 }, name));
  const en = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  en.forEach((name, i) => assert.deepEqual(parsePeriodText(`${name} 2026`), { month: i + 1, year: 2026 }, name));
  // Singkatan panjang TIDAK boleh tercocokkan sebagai singkatan pendek ("maret" != "mar"+"et").
  assert.deepEqual(parsePeriodText("Maret 2026"), { month: 3, year: 2026 });
  assert.deepEqual(parsePeriodText("September 2026"), { month: 9, year: 2026 });
  assert.deepEqual(parsePeriodText("Agustus 2026"), { month: 8, year: 2026 });
});

test("MM/YYYY dan YYYY-MM", () => {
  assert.deepEqual(parsePeriodText("06/2026"), JUN26);
  assert.deepEqual(parsePeriodText("6/2026"), JUN26);
  assert.deepEqual(parsePeriodText("06-2026"), JUN26);
  assert.deepEqual(parsePeriodText("2026-06"), JUN26);
  assert.deepEqual(parsePeriodText("2026/06"), JUN26);
  assert.deepEqual(parsePeriodText("2026-06-15"), JUN26);
});

test("tanggal tunggal -> bulannya", () => {
  assert.deepEqual(parsePeriodText("15/06/2026"), JUN26);
  assert.deepEqual(parsePeriodText("15 Juni 2026"), JUN26);
});

test("teks RELATIF -> null", () => {
  const cases = [
    "30 hari terakhir",
    "7 hari terakhir",
    "Hari ini",
    "Kemarin",
    "Minggu ini",
    "Minggu lalu",
    "Bulan ini",
    "Bulan lalu",
    "Tahun ini",
    "Last 30 days",
    "This week",
    "Last month",
    "Today",
    "Yesterday",
    "Real-time",
  ];
  for (const c of cases) assert.equal(parsePeriodText(c), null, c);
});

test("tanggal eksplisit MENANG atas label relatif yang menyertainya", () => {
  assert.deepEqual(parsePeriodText("30 hari terakhir (01/06/2026 - 30/06/2026)"), JUN26);
});

test("tahun TIDAK terlihat -> null (jangan mengarang tahun)", () => {
  const cases = ["Juni", "1 - 30 Juni", "01/06 - 30/06", "Periode Juni", "Jun"];
  for (const c of cases) assert.equal(parsePeriodText(c), null, c);
});

test("tanpa teks periode sama sekali -> null", () => {
  const cases = ["", "   ", "GMV", "Ringkasan Toko", "Rp12.480.000", "1.284 pesanan", "4,8 / 5"];
  for (const c of cases) assert.equal(parsePeriodText(c), null, JSON.stringify(c));
});

test("masukan bukan string -> null", () => {
  assert.equal(parsePeriodText(null), null);
  assert.equal(parsePeriodText(undefined), null);
  assert.equal(parsePeriodText(12 as unknown as string), null);
});

test("angka tak masuk akal ditolak", () => {
  assert.equal(parsePeriodText("15/13/2026"), null); // bulan 13
  assert.equal(parsePeriodText("32/06/2026"), null); // tanggal 32
  assert.equal(parsePeriodText("1999-06"), null); // di luar rentang tahun yang wajar
  assert.equal(parsePeriodText("2101-06"), null);
});

test("YYYY.MM (Shopee 'Per Bulan') + noise zona waktu", () => {
  assert.deepEqual(parsePeriodText("Periode Data Per Bulan 2026.06 (GMT+07)"), JUN26);
  assert.deepEqual(parsePeriodText("2026.06"), JUN26);
  assert.deepEqual(parsePeriodText("2026.06 (GMT+7)"), JUN26);
  assert.deepEqual(parsePeriodText("(GMT+07:00) 2026.06 WIB"), JUN26);
  assert.deepEqual(parsePeriodText("2026.06.15"), JUN26);
  // Titik sebagai pemisah tanggal Indonesia TIDAK ikut berubah artinya.
  assert.deepEqual(parsePeriodText("15.06.2026"), JUN26);
  assert.equal(parsePeriodText("Per Bulan 2026.06 - 2026.07"), null); // lintas bulan
});

test("gaya Inggris 'MMM DD, YYYY - MMM DD, YYYY'", () => {
  assert.deepEqual(parsePeriodText("Jun 01, 2026 - Jun 30, 2026"), JUN26);
  assert.deepEqual(parsePeriodText("Bulan: Jun 01, 2026 - Jun 30, 2026"), JUN26);
  assert.deepEqual(parsePeriodText("June 1, 2026 - June 30, 2026"), JUN26);
  assert.deepEqual(parsePeriodText("Jun. 01, 2026 – Jun. 30, 2026"), JUN26);
  assert.deepEqual(parsePeriodText("Jun 01 2026 - Jun 30 2026"), JUN26); // tanpa koma
  assert.equal(parsePeriodText("Jun 01, 2026 - Jul 15, 2026"), null); // lintas bulan
});

test("periode PEMBANDING & timestamp pembaruan diabaikan", () => {
  assert.deepEqual(
    parsePeriodText(
      "Metrik utama Jun 01, 2026 - Jun 30, 2026 | Bandingkan May 02, 2026 - May 31, 2026 / Diperbarui pada: 4 Jul 2026"
    ),
    JUN26
  );
  // Tanpa pemisah sama sekali: pemangkasan tetap terjadi di penanda.
  assert.deepEqual(
    parsePeriodText("Jun 01, 2026 - Jun 30, 2026 Bandingkan May 02, 2026 - May 31, 2026"),
    JUN26
  );
  assert.deepEqual(parsePeriodText("Juni 2026 vs Mei 2026"), JUN26);
  assert.deepEqual(parsePeriodText("01/06/2026 - 30/06/2026 · Diperbarui 4 Jul 2026"), JUN26);
  assert.deepEqual(parsePeriodText("Juni 2026 (dibandingkan Mei 2026)"), JUN26);
  assert.deepEqual(parsePeriodText("Jun 01, 2026 - Jun 30, 2026 compared to May 2026"), JUN26);
  // Periode utamanya sendiri lintas bulan -> tetap null walau pembanding dibuang.
  assert.equal(parsePeriodText("Mei 01, 2026 - Jun 30, 2026 | Bandingkan Apr 2026"), null);
});

test("toPeriodMonth", () => {
  assert.equal(toPeriodMonth(JUN26), "2026-06");
  assert.equal(toPeriodMonth({ month: 12, year: 2025 }), "2025-12");
  assert.equal(toPeriodMonth({ month: 1, year: 2026 }), "2026-01");
});

test("samePeriod: null kalau salah satu tak bisa dipastikan", () => {
  assert.equal(samePeriod("Juni 2026", "01/06/2026 - 30/06/2026"), true);
  assert.equal(samePeriod("Juni 2026", "Mei 2026"), false);
  assert.equal(samePeriod("Juni 2026", "30 hari terakhir"), null);
  assert.equal(samePeriod("Q2 2026", "Juni 2026"), null); // label kustom -> jangan protes
  assert.equal(samePeriod(null, "Juni 2026"), null);
});
