import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOperand, resolveDerived, type OperandPhoto } from "./derived-resolve";
import type { MetricRef } from "./derived";

const REF: MetricRef = { platform: "shopee", section: "Kriteria Utama", subGroupKey: "_default", metricKey: "GMV" };
const NUM: MetricRef = { platform: "shopee", section: "Promotion Tools", subGroupKey: "flash_sale", metricKey: "Penjualan" };
const photo = (value: number | null, isPrimaryPeriod = false, hasMetric = true): OperandPhoto =>
  ({ value, isPrimaryPeriod, hasMetric });

// Catatan operan tanpa perbandingan status — `assert.equal` di node:assert/strict
// MEMPERSEMPIT tipe, sehingga `status !== "ok"` sesudahnya jadi perbandingan redundan
// yang ditolak tsc.
const noteOf = (r: { status: string; note?: string }) => r.note ?? "";

test("operan: satu foto, angka ada -> ok", () => {
  assert.deepEqual(resolveOperand(REF, [photo(92_450_000)], false), { status: "ok", value: 92_450_000 });
});

test("operan belum ada -> menunggu, catatan MENYEBUT ref", () => {
  const kosong = resolveOperand(REF, [], false);
  assert.equal(kosong.status, "menunggu");
  assert.match(noteOf(kosong), /\[shopee \/ Kriteria Utama \/ GMV\]/);

  const belumEkstrak = resolveOperand(REF, [photo(null, false, false)], false);
  assert.equal(belumEkstrak.status, "menunggu");
  assert.match(noteOf(belumEkstrak), /belum diekstrak/);

  const nilaiNull = resolveOperand(REF, [photo(null)], false);
  assert.equal(nilaiNull.status, "menunggu");
  assert.match(noteOf(nilaiNull), /angkanya belum ada/);
});

test("perbandingan periode: pakai foto PERIODE UTAMA", () => {
  const r = resolveOperand(REF, [photo(100, false), photo(250, true), photo(300, false)], true);
  assert.deepEqual(r, { status: "ok", value: 250 });
});

test("perbandingan periode tanpa tepat satu utama -> ambigu", () => {
  assert.equal(resolveOperand(REF, [photo(1), photo(2)], true).status, "ambigu");
  assert.equal(resolveOperand(REF, [photo(1, true), photo(2, true)], true).status, "ambigu");
});

test("banyak foto TANPA perbandingan periode -> ambigu, TIDAK dijumlah", () => {
  const r = resolveOperand(REF, [photo(10), photo(20)], false);
  assert.equal(r.status, "ambigu");
  // Menjumlah sumber terpisah dilarang DESIGN — pastikan 30 tak pernah muncul.
  assert.match(noteOf(r), /dilarang/);
});

test("hasil akhir: hitungan benar (verifikasi tangan)", () => {
  const out = resolveDerived({ status: "ok", value: 12_480_000 }, { status: "ok", value: 92_450_000 }, REF);
  assert.equal(out.status, "ok");
  assert.equal(out.value?.toFixed(4), "13.4992");
  assert.equal(out.numeratorValue, 12_480_000);
  assert.equal(out.denominatorValue, 92_450_000);
  assert.equal(out.note, null);
});

test("penyebut nol -> penyebut_nol, value null (bukan nol, bukan Infinity)", () => {
  const out = resolveDerived({ status: "ok", value: 100 }, { status: "ok", value: 0 }, REF);
  assert.equal(out.status, "penyebut_nol");
  assert.equal(out.value, null);
  assert.match(out.note ?? "", /bernilai nol/);
});

test("operan belum siap -> value null + catatan menunggu, provenance tetap tercatat", () => {
  const out = resolveDerived(
    { status: "ok", value: 12_480_000 },
    { status: "menunggu", note: "menunggu [shopee / Kriteria Utama / GMV] — belum ada fotonya." },
    REF
  );
  assert.equal(out.status, "menunggu");
  assert.equal(out.value, null);
  assert.equal(out.numeratorValue, 12_480_000); // pembilang yang sudah ada tetap terekam
  assert.match(out.note ?? "", /menunggu \[shopee \/ Kriteria Utama \/ GMV\]/);
});

test("NaN & Infinity tak pernah bisa jadi value", () => {
  for (const [n, d] of [[NaN, 100], [100, NaN], [Infinity, 100], [100, Infinity]] as [number, number][]) {
    const out = resolveDerived({ status: "ok", value: n }, { status: "ok", value: d }, REF);
    assert.equal(out.value, null, `${n}/${d}`);
    assert.notEqual(out.status, "ok");
  }
});

test("kontribusi >100% TETAP dihitung (urusan flag Validator, bukan diblokir)", () => {
  const out = resolveDerived({ status: "ok", value: 120 }, { status: "ok", value: 100 }, NUM);
  assert.equal(out.status, "ok");
  assert.equal(out.value, 120);
});
