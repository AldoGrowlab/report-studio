// Sub-grup section (Fase 1, Jul 2026).
//
// MASALAH yang dipecahkan: section seperti "Promotion Tools" terdiri dari beberapa tool
// (Flash Sale, Diskon, Voucher) yang FOTONYA TERPISAH dan metriknya BERNAMA SAMA
// ("Penjualan"). Dua akibatnya mengubah struktur, bukan sekadar tampilan:
//   (a) kelengkapan expected metrics tidak boleh dinilai per FOTO — satu foto hanya
//       memuat metrik satu tool — melainkan per SUB-GRUP atas gabungan foto section itu;
//   (b) metrik bernama sama WAJIB jadi entitas berbeda, sehingga tabrakan mustahil
//       secara struktur, bukan dicegah dengan konvensi penamaan.
//
// KUNCI BER-SCOPE: platform + section + subGroupKey + nama metrik. Ini juga fondasi
// referensi metrik turunan (Fase 2) — ref menunjuk kunci ber-scope yang sama.
//
// Section TANPA sub-grup berperilaku PERSIS seperti sebelumnya: satu sub-grup tunggal
// implisit dengan key null. Tidak ada data lama yang berubah makna.

// SENTINEL sub-grup tunggal implisit. Section tanpa sub-grup memakai kunci ini, BUKAN NULL.
//
// Alasannya struktural, bukan selera: `Upload` punya unique (report, section, subGroupKey,
// periodMonth) untuk menegakkan "satu bulan satu foto per sub-grup". Postgres memperlakukan
// NULL sebagai SALING BERBEDA di unique constraint — kalau kolomnya nullable, section lama
// (yang subGroupKey-nya NULL) DIAM-DIAM KEHILANGAN proteksi duplikat yang selama ini ada.
// Sentinel membuat aturannya satu dan sama untuk section lama maupun baru.
//
// Konsekuensinya dijinakkan di dua tempat: konstanta ini (satu-satunya sumber string ajaib)
// dan validasi KB yang MENOLAK sub-grup buatan founder dengan kunci ini.
export const DEFAULT_SUB_GROUP_KEY = "_default";

export function isDefaultSubGroup(key: string | null | undefined): boolean {
  return !key || key === DEFAULT_SUB_GROUP_KEY;
}

export type SubGroupDef = {
  key: string;
  label: string;
  aliases: string[];
};

// Normalisasi untuk PENCOCOKAN teks tab: huruf kecil, spasi rapat, tanda baca tepi
// dibuang. "Voucher Toko " dan "voucher toko" dianggap sama; "Vouchers" TIDAK —
// pencocokan longgar (awalan/substring) gampang salah tebak antar tool yang mirip,
// jadi variasi bentuk ditulis eksplisit sebagai alias di KB.
export function normalizeLabelForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Teks tab hasil deteksi -> key sub-grup. null = tidak cocok / tidak yakin.
// Dicocokkan ke LABEL dan seluruh ALIAS, case-insensitive. Pencocokan murni di KODE —
// model hanya menyalin teks tab yang terlihat (pola sama dengan deteksi periode).
export function matchSubGroup(
  tabLabel: string | null | undefined,
  subGroups: SubGroupDef[]
): string | null {
  if (typeof tabLabel !== "string") return null;
  const needle = normalizeLabelForMatch(tabLabel);
  if (needle === "") return null;
  for (const g of subGroups) {
    const candidates = [g.label, ...g.aliases].map(normalizeLabelForMatch);
    if (candidates.includes(needle)) return g.key;
  }
  return null;
}

// Nama lengkap metrik untuk Analyst, Validator, dan PPT: "<Label Sub-grup> — <Nama Metrik>".
// Tanpa sub-grup -> nama metrik apa adanya (persis seperti sebelumnya).
export function displayMetricName(
  subGroupLabel: string | null | undefined,
  metricLabel: string
): string {
  return subGroupLabel ? `${subGroupLabel} — ${metricLabel}` : metricLabel;
}

// Kunci ber-scope dalam SATU section: sub-grup + nama metrik. Dipakai untuk mendeteksi
// tabrakan saat menyimpan KB, dan sebagai bagian ref metrik turunan (Fase 2).
// Sub-grup tunggal implisit dinormalkan ke sentinel supaya null dan "_default" tidak
// pernah menghasilkan dua kunci berbeda untuk metrik yang sama.
export function scopedMetricKey(subGroupKey: string | null | undefined, metricKey: string): string {
  return `${isDefaultSubGroup(subGroupKey) ? DEFAULT_SUB_GROUP_KEY : subGroupKey}/${metricKey}`;
}
