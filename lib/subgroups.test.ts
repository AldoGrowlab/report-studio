import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchSubGroup,
  normalizeLabelForMatch,
  displayMetricName,
  scopedMetricKey,
  isDefaultSubGroup,
  DEFAULT_SUB_GROUP_KEY,
  type SubGroupDef,
} from "./subgroups";

const GROUPS: SubGroupDef[] = [
  { key: "flash_sale", label: "Flash Sale", aliases: ["Flash Sale Toko", "FlashSale"] },
  { key: "diskon", label: "Diskon", aliases: ["Diskon Toko", "Promo Diskon"] },
  { key: "voucher", label: "Voucher", aliases: ["Voucher Toko", "Vouchers"] },
];

test("normalizeLabelForMatch", () => {
  assert.equal(normalizeLabelForMatch("Voucher Toko "), "voucher toko");
  assert.equal(normalizeLabelForMatch("  FLASH   SALE  "), "flash sale");
  assert.equal(normalizeLabelForMatch("Flash-Sale!"), "flash sale");
  assert.equal(normalizeLabelForMatch("---"), "");
});

test("cocok ke LABEL, case & spasi diabaikan", () => {
  assert.equal(matchSubGroup("Flash Sale", GROUPS), "flash_sale");
  assert.equal(matchSubGroup("flash sale", GROUPS), "flash_sale");
  assert.equal(matchSubGroup("  FLASH SALE  ", GROUPS), "flash_sale");
  assert.equal(matchSubGroup("Diskon", GROUPS), "diskon");
});

test("cocok ke ALIAS", () => {
  assert.equal(matchSubGroup("Voucher Toko", GROUPS), "voucher");
  assert.equal(matchSubGroup("Vouchers", GROUPS), "voucher");
  assert.equal(matchSubGroup("FlashSale", GROUPS), "flash_sale");
  assert.equal(matchSubGroup("Promo Diskon", GROUPS), "diskon");
});

test("TIDAK menebak: yang tak terdaftar -> null", () => {
  // Pencocokan longgar (awalan/substring) sengaja TIDAK dipakai — "Voucher Gratis Ongkir"
  // adalah tool lain, dan menebaknya sebagai "Voucher" menyimpan angka ke sub-grup salah.
  assert.equal(matchSubGroup("Voucher Gratis Ongkir", GROUPS), null);
  assert.equal(matchSubGroup("Iklan", GROUPS), null);
  assert.equal(matchSubGroup("", GROUPS), null);
  assert.equal(matchSubGroup("   ", GROUPS), null);
  assert.equal(matchSubGroup(null, GROUPS), null);
  assert.equal(matchSubGroup(undefined, GROUPS), null);
  assert.equal(matchSubGroup("Flash Sale", []), null);
});

test("displayMetricName ber-prefix, tanpa sub-grup apa adanya", () => {
  assert.equal(displayMetricName("Flash Sale", "Penjualan"), "Flash Sale — Penjualan");
  assert.equal(displayMetricName(null, "GMV"), "GMV");
  assert.equal(displayMetricName(undefined, "GMV"), "GMV");
});

test("scopedMetricKey memisahkan metrik bernama sama antar sub-grup", () => {
  const a = scopedMetricKey("flash_sale", "penjualan");
  const b = scopedMetricKey("voucher", "penjualan");
  const c = scopedMetricKey(null, "penjualan");
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(b, c);
  assert.equal(a, "flash_sale/penjualan");
  // null dan sentinel WAJIB menghasilkan kunci yang sama — kalau tidak, satu metrik
  // yang sama bisa punya dua identitas dan ref Fase 2 jadi ambigu.
  assert.equal(c, `${DEFAULT_SUB_GROUP_KEY}/penjualan`);
  assert.equal(scopedMetricKey(DEFAULT_SUB_GROUP_KEY, "penjualan"), c);
});

test("isDefaultSubGroup", () => {
  assert.equal(isDefaultSubGroup(null), true);
  assert.equal(isDefaultSubGroup(undefined), true);
  assert.equal(isDefaultSubGroup(""), true);
  assert.equal(isDefaultSubGroup(DEFAULT_SUB_GROUP_KEY), true);
  assert.equal(isDefaultSubGroup("flash_sale"), false);
});
