import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSectionBody, computeSectionStatus } from "./sections";
import { DEFAULT_SUB_GROUP_KEY } from "./subgroups";

const base = {
  platform: "shopee",
  name: "Promotion Tools",
  narrativeOrder: 3,
  kbAnalysis: "kerangka analisa",
};
const M = (key: string, label = key, type = "number") => ({ key, label, type, required: false });
const ok = (body: unknown) => {
  const r = parseSectionBody(body);
  if (!r.ok) throw new Error(`harusnya valid, tapi: ${r.error}`);
  return r.data;
};
const err = (body: unknown) => {
  const r = parseSectionBody(body);
  if (r.ok) throw new Error("harusnya ditolak, tapi lolos");
  return r.error;
};

test("REGRESI: section tanpa sub-grup persis seperti sebelumnya", () => {
  const d = ok({ ...base, metrics: [M("gmv", "GMV", "currency"), M("pesanan", "Pesanan")] });
  assert.equal(d.subGroups.length, 0);
  assert.equal(d.metrics.length, 2);
  // Semua metrik lama otomatis masuk sub-grup tunggal implisit.
  assert.deepEqual([...new Set(d.metrics.map((m) => m.subGroupKey))], [DEFAULT_SUB_GROUP_KEY]);
  assert.equal(d.metrics[0].key, "gmv");
  assert.equal(d.metrics[0].type, "currency");
});

test("sub-grup: metrik BERNAMA SAMA tersimpan terpisah per sub-grup", () => {
  const d = ok({
    ...base,
    subGroups: [
      { key: "flash_sale", label: "Flash Sale", aliases: ["FlashSale"], expectedMetrics: [M("penjualan", "Penjualan", "currency")] },
      { key: "diskon", label: "Diskon", aliases: [], expectedMetrics: [M("penjualan", "Penjualan", "currency")] },
      { key: "voucher", label: "Voucher", aliases: ["Voucher Toko"], expectedMetrics: [M("penjualan", "Penjualan", "currency")] },
    ],
  });
  assert.equal(d.subGroups.length, 3);
  assert.equal(d.metrics.length, 3);
  // Inti Fase 1: tiga "penjualan" hidup berdampingan, dibedakan sub-grupnya.
  assert.deepEqual(
    d.metrics.map((m) => `${m.subGroupKey}/${m.key}`),
    ["flash_sale/penjualan", "diskon/penjualan", "voucher/penjualan"]
  );
  assert.deepEqual(d.subGroups.map((g) => g.order), [0, 1, 2]);
});

test("alias dinormalisasi & dide-duplikasi", () => {
  const d = ok({
    ...base,
    subGroups: [
      { key: "voucher", label: "Voucher", aliases: ["Voucher Toko", " voucher toko ", "", "Vouchers"], expectedMetrics: [M("penjualan")] },
    ],
  });
  assert.deepEqual(d.subGroups[0].aliases, ["Voucher Toko", "Vouchers"]);
});

test("alias/label bentrok antar sub-grup ditolak (pencocokan tab jadi ambigu)", () => {
  const e = err({
    ...base,
    subGroups: [
      { key: "flash_sale", label: "Flash Sale", aliases: ["Promo"], expectedMetrics: [M("penjualan")] },
      { key: "diskon", label: "Diskon", aliases: ["promo"], expectedMetrics: [M("penjualan")] },
    ],
  });
  assert.match(e, /ambigu/);
  const e2 = err({
    ...base,
    subGroups: [
      { key: "a", label: "Voucher", aliases: [], expectedMetrics: [M("x")] },
      { key: "b", label: "voucher", aliases: [], expectedMetrics: [M("x")] },
    ],
  });
  assert.match(e2, /ambigu/);
});

test("key sub-grup: bentuk, duplikat, dan sentinel", () => {
  assert.match(err({ ...base, subGroups: [{ key: "Flash Sale", label: "Flash Sale", expectedMetrics: [M("x")] }] }), /huruf kecil/);
  assert.match(err({ ...base, subGroups: [{ key: "flash-sale", label: "F", expectedMetrics: [M("x")] }] }), /huruf kecil/);
  assert.match(
    err({ ...base, subGroups: [{ key: DEFAULT_SUB_GROUP_KEY, label: "X", expectedMetrics: [M("x")] }] }),
    /dipakai sistem/
  );
  assert.match(
    err({
      ...base,
      subGroups: [
        { key: "voucher", label: "Voucher", expectedMetrics: [M("x")] },
        { key: "voucher", label: "Voucher Lain", expectedMetrics: [M("y")] },
      ],
    }),
    /dobel/
  );
  assert.match(err({ ...base, subGroups: [{ key: "voucher", label: "", expectedMetrics: [M("x")] }] }), /wajib punya label/);
});

test("metrik dobel DI DALAM satu sub-grup ditolak", () => {
  const e = err({
    ...base,
    subGroups: [
      { key: "voucher", label: "Voucher", expectedMetrics: [M("penjualan"), M("penjualan", "Penjualan 2")] },
    ],
  });
  assert.match(e, /dobel/);
});

test("sub-grup tanpa metrik ditolak", () => {
  assert.match(err({ ...base, subGroups: [{ key: "voucher", label: "Voucher", expectedMetrics: [] }] }), /belum punya metrik/);
});

test("campuran metrik section + sub-grup ditolak (daftar ekstraksi jadi ambigu)", () => {
  const e = err({
    ...base,
    metrics: [M("gmv")],
    subGroups: [{ key: "voucher", label: "Voucher", expectedMetrics: [M("penjualan")] }],
  });
  assert.match(e, /harus berada di dalam sub-grup/);
});

// Definisi turunan yang BENTUKNYA lengkap — validasi ref-nya (apakah menunjuk sesuatu
// yang benar-benar ada) dikerjakan di route, bukan di sini.
const D = (key: string, subGroupKey = "flash_sale") => ({
  key,
  label: `Kontribusi ${key}`,
  subGroupKey,
  numeratorRef: { platform: "shopee", section: "Promotion Tools", subGroupKey, metricKey: "Penjualan" },
  denominatorRef: { platform: "shopee", section: "Kriteria Utama", metricKey: "GMV" },
});

test("guard Fase 2: nama metrik tak boleh sekaligus ekstraksi & turunan", () => {
  const e = err({
    ...base,
    subGroups: [{ key: "flash_sale", label: "Flash Sale", expectedMetrics: [M("kontribusi")] }],
    derivedMetrics: [D("kontribusi")],
  });
  assert.match(e, /sekaligus sebagai metrik ekstraksi dan metrik turunan/);

  // Sub-grup BERBEDA = identitas berbeda -> boleh.
  const d = ok({
    ...base,
    subGroups: [{ key: "flash_sale", label: "Flash Sale", expectedMetrics: [M("penjualan")] }],
    derivedMetrics: [D("kontribusi")],
  });
  assert.equal(d.metrics.length, 1);
  assert.equal(d.derivedMetrics.length, 1);
  // Ref tanpa subGroupKey dinormalkan ke sentinel.
  assert.equal(d.derivedMetrics[0].denominatorRef.subGroupKey, DEFAULT_SUB_GROUP_KEY);
  assert.equal(d.derivedMetrics[0].unit, "percent");

  // Metrik turunan dobel ditolak.
  assert.match(
    err({ ...base, metrics: [M("gmv")], derivedMetrics: [D("kontribusi", "_default"), D("kontribusi", "_default")] }),
    /tidak boleh dobel/
  );

  // Bentuk ref wajib lengkap.
  assert.match(err({ ...base, metrics: [M("gmv")], derivedMetrics: [{ key: "k", label: "K" }] }), /Pembilang/);
  assert.match(
    err({ ...base, metrics: [M("gmv")], derivedMetrics: [{ ...D("k"), numeratorRef: { platform: "shopee", section: "", metricKey: "x" } }] }),
    /nama section wajib/
  );

  // Tanpa derivedMetrics: nol perubahan perilaku.
  const plain = ok({ ...base, metrics: [M("gmv")] });
  assert.equal(plain.metrics.length, 1);
  assert.deepEqual(plain.derivedMetrics, []);
});

test("validasi lama tetap berlaku", () => {
  assert.match(err({ ...base, platform: "lazada", metrics: [] }), /shopee atau tiktok/);
  assert.match(err({ ...base, name: "  ", metrics: [] }), /Nama section wajib/);
  assert.match(err({ ...base, narrativeOrder: 1.5, metrics: [] }), /angka bulat/);
  assert.match(err({ ...base, narrativeOrder: 10000, metrics: [] }), /0 dan 9999/);
  assert.match(err({ ...base, metrics: [{ key: "x", label: "X", type: "uang" }] }), /Tipe metrik/);
  assert.match(err({ ...base, metrics: [{ key: "", label: "X", type: "number" }] }), /wajib punya key/);
  // Baris kosong tetap dilewati diam-diam.
  assert.equal(ok({ ...base, metrics: [M("gmv"), { key: "", label: "", type: "number" }] }).metrics.length, 1);
});

test("computeSectionStatus tak berubah", () => {
  assert.equal(computeSectionStatus({ name: "A", kbAnalysis: "kb", metricsCount: 1 }), "active");
  assert.equal(computeSectionStatus({ name: "A", kbAnalysis: "", metricsCount: 1 }), "draft");
  assert.equal(computeSectionStatus({ name: "A", kbAnalysis: "kb", metricsCount: 0 }), "draft");
});
