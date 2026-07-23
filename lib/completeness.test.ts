import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCompleteness, type CompletenessInput } from "./completeness";
import { DEFAULT_SUB_GROUP_KEY } from "./subgroups";

const GROUPS = [
  { key: "flash_sale", label: "Flash Sale" },
  { key: "diskon", label: "Diskon" },
  { key: "voucher", label: "Voucher" },
];
const metric = (subGroupKey: string, key: string, label: string, required = true) => ({
  subGroupKey, key, label, required,
});
const METRICS = GROUPS.flatMap((g) => [
  metric(g.key, "penjualan", "Penjualan"),
  metric(g.key, "pesanan", "Pesanan"),
]);
const ex = (key: string, status: "ok" | "missing" | "low_confidence" = "ok", manuallyConfirmed = false) =>
  ({ key, status, manuallyConfirmed } as const);
const run = (photos: CompletenessInput["photos"], metrics = METRICS, subGroups = GROUPS) =>
  checkCompleteness({ sectionName: "Promotion Tools", subGroups, metrics, photos });

test("sub-grup tanpa foto = catatan INFO, bukan error", () => {
  const f = run([
    { subGroupKey: "flash_sale", extractions: [ex("penjualan"), ex("pesanan")] },
    { subGroupKey: "diskon", extractions: [ex("penjualan"), ex("pesanan")] },
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].subGroupKey, "voucher");
  assert.equal(f[0].severity, "info");
  assert.match(f[0].note, /Tidak ada aktivitas Voucher bulan ini/);
});

test("kelengkapan dinilai atas GABUNGAN foto satu sub-grup", () => {
  // Dua foto Flash Sale, masing-masing separuh metrik -> LENGKAP.
  const f = run([
    { subGroupKey: "flash_sale", extractions: [ex("penjualan")] },
    { subGroupKey: "flash_sale", extractions: [ex("pesanan")] },
    { subGroupKey: "diskon", extractions: [ex("penjualan"), ex("pesanan")] },
    { subGroupKey: "voucher", extractions: [ex("penjualan"), ex("pesanan")] },
  ]);
  assert.deepEqual(f, []);
});

test("metrik WAJIB hilang di sub-grup yang ADA fotonya -> flag ber-prefix", () => {
  const f = run([
    { subGroupKey: "flash_sale", extractions: [ex("penjualan"), ex("pesanan", "missing")] },
    { subGroupKey: "diskon", extractions: [ex("penjualan"), ex("pesanan")] },
    { subGroupKey: "voucher", extractions: [ex("penjualan"), ex("pesanan")] },
  ]);
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "tinggi");
  assert.equal(f[0].subGroupKey, "flash_sale");
  // Nama ber-prefix: tanpa ini "Pesanan" tak bisa dibedakan dari Pesanan tool lain.
  assert.match(f[0].note, /Flash Sale — Pesanan/);
});

test("metrik tak muncul sama sekali di extraction juga terhitung hilang", () => {
  const f = run([
    { subGroupKey: "flash_sale", extractions: [ex("penjualan")] },
    { subGroupKey: "diskon", extractions: [ex("penjualan"), ex("pesanan")] },
    { subGroupKey: "voucher", extractions: [ex("penjualan"), ex("pesanan")] },
  ]);
  assert.equal(f.length, 1);
  assert.match(f[0].note, /Flash Sale — Pesanan/);
});

test("WAJIB yang masih ragu & belum dikonfirmasi = tinggi; sudah dikonfirmasi = lengkap", () => {
  const ragu = run([
    { subGroupKey: "flash_sale", extractions: [ex("penjualan"), ex("pesanan", "low_confidence")] },
    { subGroupKey: "diskon", extractions: [ex("penjualan"), ex("pesanan")] },
    { subGroupKey: "voucher", extractions: [ex("penjualan"), ex("pesanan")] },
  ]);
  assert.equal(ragu.length, 1);
  assert.equal(ragu[0].severity, "tinggi");
  assert.match(ragu[0].note, /masih ragu/);

  const dikonfirmasi = run([
    { subGroupKey: "flash_sale", extractions: [ex("penjualan"), ex("pesanan", "low_confidence", true)] },
    { subGroupKey: "diskon", extractions: [ex("penjualan"), ex("pesanan")] },
    { subGroupKey: "voucher", extractions: [ex("penjualan"), ex("pesanan")] },
  ]);
  assert.deepEqual(dikonfirmasi, []);
});

test("metrik OPSIONAL hilang -> info, bukan tinggi", () => {
  const metrics = [
    metric("flash_sale", "penjualan", "Penjualan"),
    metric("flash_sale", "wishlist", "Wishlist", false),
  ];
  const f = checkCompleteness({
    sectionName: "S",
    subGroups: [GROUPS[0]],
    metrics,
    photos: [{ subGroupKey: "flash_sale", extractions: [ex("penjualan")] }],
  });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "info");
  assert.match(f[0].note, /opsional/);
});

test("REGRESI: section tanpa sub-grup = satu sub-grup tunggal implisit, nama TANPA prefix", () => {
  const f = checkCompleteness({
    sectionName: "Kriteria Utama",
    subGroups: [],
    metrics: [metric(DEFAULT_SUB_GROUP_KEY, "gmv", "GMV"), metric(DEFAULT_SUB_GROUP_KEY, "pesanan", "Pesanan")],
    photos: [{ subGroupKey: DEFAULT_SUB_GROUP_KEY, extractions: [ex("gmv")] }],
  });
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "tinggi");
  assert.match(f[0].note, /Pesanan/);
  assert.doesNotMatch(f[0].note, /—/); // tanpa prefix sub-grup
});

test("section tanpa sub-grup & semua lengkap -> nol temuan", () => {
  const f = checkCompleteness({
    sectionName: "Kriteria Utama",
    subGroups: [],
    metrics: [metric(DEFAULT_SUB_GROUP_KEY, "gmv", "GMV")],
    photos: [{ subGroupKey: DEFAULT_SUB_GROUP_KEY, extractions: [ex("gmv")] }],
  });
  assert.deepEqual(f, []);
});
