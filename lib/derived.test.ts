import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatRef,
  validateDerivedMetric,
  validateDerivedMetrics,
  computeRatioPercent,
  type CatalogEntry,
  type DerivedMetricDef,
  type MetricRef,
} from "./derived";
import { DEFAULT_SUB_GROUP_KEY } from "./subgroups";

// Katalog uji mencerminkan KB nyata yang diberikan: Promotion Tools ber-sub-grup +
// Kriteria Utama tanpa sub-grup, di kedua platform.
const entry = (
  platform: "shopee" | "tiktok",
  section: string,
  subGroupKey: string,
  metricKey: string,
  isText = false
): CatalogEntry => ({ platform, section, subGroupKey, metricKey, isText });

const CATALOG: CatalogEntry[] = [
  entry("shopee", "Promotion Tools", "flash_sale", "Penjualan"),
  entry("shopee", "Promotion Tools", "diskon", "Penjualan"),
  entry("shopee", "Promotion Tools", "voucher", "Penjualan"),
  entry("shopee", "Promotion Tools", "flash_sale", "Nama Produk", true),
  entry("shopee", "Kriteria Utama", DEFAULT_SUB_GROUP_KEY, "GMV"),
  entry("tiktok", "Kriteria Utama", DEFAULT_SUB_GROUP_KEY, "GMV"),
];

const ref = (
  platform: "shopee" | "tiktok",
  section: string,
  subGroupKey: string,
  metricKey: string
): MetricRef => ({ platform, section, subGroupKey, metricKey });

const GMV_SHOPEE = ref("shopee", "Kriteria Utama", DEFAULT_SUB_GROUP_KEY, "GMV");

const def = (over: Partial<DerivedMetricDef> = {}): DerivedMetricDef => ({
  key: "kontribusi_flash_sale",
  label: "Kontribusi Flash Sale terhadap GMV",
  subGroupKey: "flash_sale",
  numeratorRef: ref("shopee", "Promotion Tools", "flash_sale", "Penjualan"),
  denominatorRef: GMV_SHOPEE,
  unit: "percent",
  ...over,
});

test("formatRef menyebut ref utuh (dengan & tanpa sub-grup)", () => {
  assert.equal(
    formatRef(ref("shopee", "Promotion Tools", "flash_sale", "Penjualan")),
    "[shopee / Promotion Tools / flash_sale / Penjualan]"
  );
  assert.equal(formatRef(GMV_SHOPEE), "[shopee / Kriteria Utama / GMV]");
});

test("ketiga definisi Shopee yang nyata: VALID", () => {
  const defs = [
    def(),
    def({ key: "kontribusi_diskon", subGroupKey: "diskon", numeratorRef: ref("shopee", "Promotion Tools", "diskon", "Penjualan") }),
    def({ key: "kontribusi_voucher", subGroupKey: "voucher", numeratorRef: ref("shopee", "Promotion Tools", "voucher", "Penjualan") }),
  ];
  assert.deepEqual(validateDerivedMetrics(defs, CATALOG, "shopee"), []);
});

test("ref salah eja DITOLAK dengan pesan MENYEBUT ref-nya", () => {
  const salahSection = validateDerivedMetric(
    def({ numeratorRef: ref("shopee", "Promotion Tool", "flash_sale", "Penjualan") }),
    CATALOG,
    "shopee"
  );
  assert.equal(salahSection.ok, false);
  assert.match(salahSection.ok === false ? salahSection.error : "", /\[shopee \/ Promotion Tool \/ flash_sale \/ Penjualan\]/);
  assert.match(salahSection.ok === false ? salahSection.error : "", /tidak ada di KB/);

  const salahMetrik = validateDerivedMetric(def({ denominatorRef: ref("shopee", "Kriteria Utama", DEFAULT_SUB_GROUP_KEY, "gmv") }), CATALOG, "shopee");
  assert.equal(salahMetrik.ok, false);
  assert.match(salahMetrik.ok === false ? salahMetrik.error : "", /\[shopee \/ Kriteria Utama \/ gmv\]/);

  const salahSub = validateDerivedMetric(def({ numeratorRef: ref("shopee", "Promotion Tools", "flashsale", "Penjualan") }), CATALOG, "shopee");
  assert.equal(salahSub.ok, false);
  assert.match(salahSub.ok === false ? salahSub.error : "", /flashsale/);
});

test("SCOPE PLATFORM KETAT: lintas platform ditolak", () => {
  const r = validateDerivedMetric(
    def({ denominatorRef: ref("tiktok", "Kriteria Utama", DEFAULT_SUB_GROUP_KEY, "GMV") }),
    CATALOG,
    "shopee"
  );
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /platform lain/);
});

test("operan bertipe Teks ditolak", () => {
  const r = validateDerivedMetric(
    def({ numeratorRef: ref("shopee", "Promotion Tools", "flash_sale", "Nama Produk") }),
    CATALOG,
    "shopee"
  );
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /bertipe Teks/);
});

test("pembilang = penyebut ditolak", () => {
  const r = validateDerivedMetric(def({ numeratorRef: GMV_SHOPEE }), CATALOG, "shopee");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /menunjuk metrik yang sama/);
});

test("unit selain percent ditolak", () => {
  const r = validateDerivedMetric(def({ unit: "ratio" as "percent" }), CATALOG, "shopee");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error : "", /unit harus/);
});

test("definisi dobel ditolak; SEMUA kesalahan dilaporkan sekaligus", () => {
  const errs = validateDerivedMetrics(
    [
      def({ numeratorRef: ref("shopee", "X", "flash_sale", "Penjualan") }),
      def({ key: "kontribusi_diskon", denominatorRef: ref("shopee", "Y", DEFAULT_SUB_GROUP_KEY, "GMV") }),
      def(), // dobel dengan yang pertama
    ],
    CATALOG,
    "shopee"
  );
  assert.equal(errs.length, 3);
  assert.match(errs[2], /tidak boleh dobel/);
});

test("computeRatioPercent: hitungan & guard", () => {
  // Verifikasi tangan: 12.480.000 / 92.450.000 x 100 = 13,4991...%
  assert.equal(computeRatioPercent(12_480_000, 92_450_000)?.toFixed(4), "13.4992");
  assert.equal(computeRatioPercent(50, 200), 25);
  // Penyebut 0 / null / operan belum ada -> null (bukan nol, bukan error).
  assert.equal(computeRatioPercent(100, 0), null);
  assert.equal(computeRatioPercent(100, null), null);
  assert.equal(computeRatioPercent(null, 100), null);
  assert.equal(computeRatioPercent(undefined, 100), null);
  // NaN/Infinity DILARANG tersimpan dalam bentuk apa pun.
  assert.equal(computeRatioPercent(NaN, 100), null);
  assert.equal(computeRatioPercent(100, NaN), null);
  assert.equal(computeRatioPercent(Infinity, 100), null);
  assert.equal(computeRatioPercent(100, Infinity), null);
  // Kontribusi >100% TIDAK diblokir di sini — itu urusan flag Validator (2c),
  // karena angkanya bisa saja benar dan yang salah justru ekstraksinya.
  assert.equal(computeRatioPercent(120, 100), 120);
});
