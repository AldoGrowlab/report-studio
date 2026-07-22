// Tahap 8 + 10 — Template Engine: data report tersimpan -> file .pptx, DETERMINISTIK
// (bukan LLM). Murni data-polos -> Buffer: tanpa Prisma, tanpa storage, tanpa AI — semua
// keputusan tata letak dihitung di kode supaya konsisten antar run (DESIGN §Arsitektur).
// Foto DISEMATKAN (embedded) agar file mandiri; teks insight dipakai APA ADANYA.
// Tema (Tahap 10) masuk sebagai PARAMETER data polos (route pptx yang membaca DB) —
// polesan estetik Tingkat 2: pola tetap, bersih, foto asli tak pernah ditimpa elemen.

import { imageSizePx } from "@/lib/image-size";
import { parsePointLine, splitByNumbers } from "@/lib/insight-format";
import {
  DEFAULT_THEME_COLORS,
  isDarkColor,
  isSafeFont,
  normalizeHexColor,
  resolveAccent,
  tint,
  type ThemeColors,
} from "@/lib/theme";

// Logo tema (opsional) — bytes untuk hitung proporsi, data URL untuk pptxgenjs.
// dataOnDark = varian PUTIH (siluet) dari logo yang sama, disiapkan route saat latar
// primer GELAP: logo bertinta gelap (dirancang untuk cover putih) jadi tak terlihat di
// slide Thank You berlatar primer. Kosong = pakai logo asli apa adanya.
export type PptLogo = {
  data: string;
  bytes: Uint8Array;
  contentType: string;
  dataOnDark?: string;
};

// Kontak slide Thank You (Fase A gaya agency) — string kosong = bagian itu tak ditampilkan.
export type PptContacts = { email: string; website: string; instagram: string };

export type PptTheme = ThemeColors & { logo: PptLogo | null; contacts: PptContacts };

export const DEFAULT_PPT_THEME: PptTheme = {
  ...DEFAULT_THEME_COLORS,
  logo: null,
  // Sinkron dengan default kolom Theme di schema.prisma.
  contacts: {
    email: "officialgrowlab.id@gmail.com",
    website: "www.growlab.id",
    instagram: "@growlab.id",
  },
};

// Konstanta netral non-tema.
const TEXT_BODY = "1F2937"; // teks body tetap gelap netral — keterbacaan di atas putih
const BG = "FFFFFF";
const SIZES = {
  coverPlatform: 26, // nama platform di cover — sengaja besar & tebal (hierarki kuat)
  coverTitle: 40,
  coverBrand: 26, // brand + periode di band cover — besar & tebal supaya terbaca jelas
  coverSub: 18,
  title: 20,
  titleXL: 24, // judul section uppercase (Fase B — hierarki kuat gaya agency)
  body: 13,
  caption: 10,
  footer: 8,
};

// Kanvas 16:9 (inci) + geometri. Foto KIRI, insight KANAN (keputusan Tahap 8).
const PAGE = { w: 13.33, h: 7.5 };
const MARGIN = 0.5;
const HEADER_Y = 0.35;
const HEADER_H = 0.55;
const CONTENT_Y = 1.25;
const FOOTER_Y = PAGE.h - 0.42;
const CONTENT_H = FOOTER_Y - CONTENT_Y - 0.12;
const LEFT = { x: MARGIN, w: 6.0 }; // kolom foto
const RIGHT = { x: 6.8, w: PAGE.w - 6.8 - MARGIN }; // kolom panel insight
const PHOTO_GAP = 0.2;
const CAPTION_H = 0.28;
const PANEL_PAD = 0.22; // padding dalam panel insight/kesimpulan

export type PptPhoto = {
  // Data URL base64 utuh, mis. "image/png;base64,...." (format yang diminta pptxgenjs).
  data: string;
  // Bytes asli untuk membaca dimensi (hitung "contain" sendiri, deterministik).
  bytes: Uint8Array;
  contentType: string;
  sourceIndex: number; // nomor "Sumber #n", konsisten dengan UI & Analyst
  // Label bulan yang DITENTUKAN USER (section perbandingan periode), mis. "Juni 2026".
  // Dipakai sebagai caption menggantikan "Sumber #n" — bulan jauh lebih informatif bagi
  // pembaca deck daripada nomor urut. null = section biasa (tanpa periode).
  periodLabel: string | null;
};

// Insight = poin-poin + kosakata angka singkat (snapshot dari Insight.numbers) — angka
// metrik di-bold via pencocokan substring deterministik (lib/insight-format.ts).
export type PptInsight = { points: string[]; numbers: string[] };

export type PptSection = {
  name: string;
  insight: PptInsight | null; // null = belum ada insight -> panel kanan kosong
  photos: PptPhoto[];
  multiSource: boolean; // >1 foto = sumber terpisah, caption "Sumber #n" wajib tampil
  missingPhotos: number; // foto yang tak terbaca dari storage (dicatat, bukan gagal total)
};

export type PptBlock = {
  platform: "shopee" | "tiktok";
  sections: PptSection[];
  // Kesimpulan Validator platform ini (Tahap 7a) — null = slot tetap placeholder.
  conclusion: PptInsight | null;
  // "Rekomendasi & Action Plan" ketikan user (Fase A) — poin demi poin, dirender jadi
  // bullet list. TANPA bold otomatis (murni manual). null/kosong = slide TIDAK dibuat.
  recommendation: string[] | null;
};

export type PptReportData = {
  reportPeriod: string;
  // Nama brand/toko yang dilaporkan — tampil di cover. null = report lama tanpa brand.
  brandName?: string | null;
  blocks: PptBlock[]; // urutan blok sudah ditentukan pemanggil (Shopee dulu, lalu TikTok)
};

const PLATFORM_LABEL: Record<PptBlock["platform"], string> = {
  shopee: "Shopee",
  tiktok: "TikTok",
};

// Teks slide pembatas platform (Fase A) — persis gaya report agency.
const DIVIDER_LABEL: Record<PptBlock["platform"], string> = {
  shopee: "SHOPEE REPORT",
  tiktok: "TIKTOK SHOP REPORT",
};

// Hitung penempatan "contain": skala proporsional ke dalam kotak, terpusat horizontal,
// menempel atas. Rasio dari header bytes; tak terbaca -> fallback 4:3.
function containRect(
  img: { bytes: Uint8Array; contentType: string },
  box: { x: number; y: number; w: number; h: number },
  align: "top" | "middle" = "top"
): { x: number; y: number; w: number; h: number } {
  const px = imageSizePx(img.bytes, img.contentType);
  const ratio = px ? px.w / px.h : 4 / 3;
  // Jaring pengaman: kotak tak masuk akal (tinggi/lebar ≤ 0) TIDAK boleh menghasilkan
  // geometri negatif — pptxgenjs menuliskannya apa adanya ke <a:ext>, dan cx/cy negatif
  // melanggar ST_PositiveCoordinate sehingga PowerPoint menolak seluruh file ("repair").
  if (box.w <= 0 || box.h <= 0) return { x: box.x, y: box.y, w: 0, h: 0 };

  let w = box.w;
  let h = w / ratio;
  if (h > box.h) {
    h = box.h;
    w = h * ratio;
  }
  const y = align === "middle" ? box.y + (box.h - h) / 2 : box.y;
  return { x: box.x + (box.w - w) / 2, y, w, h };
}

// ---- Muat-tidaknya teks: DIHITUNG DI KODE, bukan diserahkan ke `fit: "shrink"` ----
// pptxgenjs menulis <a:normAutofit/> telanjang TANPA fontScale (baris fontScale-nya sengaja
// dikomentari di sumbernya), dan PowerPoint baru menghitung skala saat teks diedit MANUAL.
// Akibatnya di file yang dikirim ke klien teks dirender ukuran penuh dan tumpah keluar slide
// — terukur 13,61" teks di kotak 5,40" untuk rekomendasi 50 baris. Karena itu ukuran font
// dipilih sendiri: perkirakan tinggi, turunkan tingkat sampai muat.

// Lebar rata-rata karakter ≈ 0,5 × ukuran font untuk huruf sans. Sengaja sedikit boros
// (0,52) supaya perkiraan cenderung MELEBIHKAN — lebih baik font mengecil sedikit lebih
// cepat daripada teks tumpah.
const CHAR_WIDTH_RATIO = 0.52;
const LINE_HEIGHT_RATIO = 1.22; // tinggi baris relatif ukuran font
const PT_PER_INCH = 72;

// Perkiraan tinggi (inci) satu blok teks pada ukuran font tertentu.
function estimateTextHeight(
  lines: string[],
  fontSize: number,
  boxW: number,
  paraSpaceAfterPt = 0
): number {
  const charsPerLine = Math.max(
    1,
    Math.floor((boxW * PT_PER_INCH) / (fontSize * CHAR_WIDTH_RATIO))
  );
  let wrapped = 0;
  for (const line of lines) {
    // Baris kosong tetap memakan satu baris (dipertahankan sebagai jarak antar blok).
    wrapped += Math.max(1, Math.ceil(line.length / charsPerLine));
  }
  const lineH = (fontSize * LINE_HEIGHT_RATIO) / PT_PER_INCH;
  const spacing = (paraSpaceAfterPt / PT_PER_INCH) * lines.length;
  return wrapped * lineH + spacing;
}

// Margin aman: perkiraan lebar karakter tak pernah persis (font berbeda, kerning, angka
// vs huruf). Isi kotak hanya sampai 92% supaya selisih kecil tidak langsung jadi luapan.
const FILL_SAFETY = 0.92;

// Ukuran font terbesar dari `sizes` (urut besar→kecil) yang muat di kotak. Kalau tak ada
// yang muat, kembalikan yang terkecil — pemanggil memutuskan apakah memecah ke slide lain.
function fitFontSize(
  lines: string[],
  box: { w: number; h: number },
  sizes: number[],
  paraSpaceAfterPt = 0
): number {
  const limit = box.h * FILL_SAFETY;
  for (const size of sizes) {
    if (estimateTextHeight(lines, size, box.w, paraSpaceAfterPt) <= limit) return size;
  }
  return sizes[sizes.length - 1];
}

// Pecah baris jadi beberapa halaman yang masing-masing muat pada `fontSize`.
function paginateLines(
  lines: string[],
  box: { w: number; h: number },
  fontSize: number,
  paraSpaceAfterPt = 0
): string[][] {
  const pages: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    const next = [...current, line];
    if (
      current.length > 0 &&
      estimateTextHeight(next, fontSize, box.w, paraSpaceAfterPt) > box.h * FILL_SAFETY
    ) {
      pages.push(current);
      current = [line];
    } else {
      current = next;
    }
  }
  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [[]];
}

type Slide = import("pptxgenjs").default.Slide;

// Warna teks di atas latar primer — kontras SELALU dijaga: putih hanya kalau primer
// memang gelap; tema berprimer terang memakai teks gelap/sekunder (isDarkColor, luminans).
function onPrimaryText(theme: PptTheme): string {
  return isDarkColor(theme.primary) ? "FFFFFF" : TEXT_BODY;
}
function onPrimarySubtle(theme: PptTheme): string {
  return isDarkColor(theme.primary) ? tint(theme.primary, 0.65) : theme.secondary;
}
function onPrimaryLine(theme: PptTheme): string {
  return isDarkColor(theme.primary) ? tint(theme.primary, 0.32) : tint(theme.secondary, 0.75);
}

// Header slide konten (Fase B gaya agency): judul TEBAL BESAR UPPERCASE — hierarki kuat —
// dengan bar aksen vertikal di kiri; garis pemisah tipis lebar penuh di bawahnya.
// onDark: varian untuk slide berlatar primer (judul putih, garis dari tint primer).
function addSlideHeader(
  slide: Slide,
  text: string,
  theme: PptTheme,
  accent: string,
  onDark = false
) {
  slide.addShape("rect", {
    x: MARGIN,
    y: HEADER_Y + 0.04,
    w: 0.09,
    h: HEADER_H - 0.08,
    fill: { color: accent },
    line: { type: "none" },
  });
  slide.addText(text.toUpperCase(), {
    x: MARGIN + 0.24,
    y: HEADER_Y,
    w: PAGE.w - 2 * MARGIN - 0.24,
    h: HEADER_H,
    fontFace: theme.headingFont,
    // Dihitung di kode: nama section panjang harus tetap SATU baris di dalam header,
    // kalau tidak ia menembus garis pemisah di bawahnya. `fit: "shrink"` tidak bekerja.
    fontSize: fitFontSize(
      [text.toUpperCase()],
      { w: PAGE.w - 2 * MARGIN - 0.24, h: HEADER_H },
      [SIZES.titleXL, 22, 20, 18, 16, 14]
    ),
    bold: true,
    charSpacing: 1,
    color: onDark ? onPrimaryText(theme) : theme.primary,
    valign: "middle",
  });
  slide.addShape("rect", {
    x: MARGIN,
    y: HEADER_Y + HEADER_H + 0.12,
    w: PAGE.w - 2 * MARGIN,
    h: 0.015,
    fill: { color: onDark ? onPrimaryLine(theme) : tint(theme.secondary, 0.75) },
    line: { type: "none" },
  });
}

// Footer slide konten: garis tipis + label report kiri + nomor halaman kanan.
// Nomor dihitung manual (deterministik) oleh pemanggil. onDark: varian slide berlatar
// primer (Fase B) — teks/garis dari tint primer supaya tetap terbaca.
function addFooter(
  slide: Slide,
  label: string,
  pageNo: number,
  pageTotal: number,
  theme: PptTheme,
  onDark = false
) {
  const lineColor = onDark ? onPrimaryLine(theme) : tint(theme.secondary, 0.8);
  const textColor = onDark ? onPrimarySubtle(theme) : theme.secondary;
  slide.addShape("rect", {
    x: MARGIN,
    y: FOOTER_Y,
    w: PAGE.w - 2 * MARGIN,
    h: 0.012,
    fill: { color: lineColor },
    line: { type: "none" },
  });
  slide.addText(label, {
    x: MARGIN,
    y: FOOTER_Y + 0.03,
    w: 6,
    h: 0.3,
    fontFace: theme.bodyFont,
    fontSize: SIZES.footer,
    color: textColor,
    valign: "middle",
  });
  slide.addText(`${pageNo} / ${pageTotal}`, {
    x: PAGE.w - MARGIN - 1.2,
    y: FOOTER_Y + 0.03,
    w: 1.2,
    h: 0.3,
    align: "right",
    fontFace: theme.bodyFont,
    fontSize: SIZES.footer,
    color: textColor,
    valign: "middle",
  });
}

// Panel latar untuk poin (insight & kesimpulan/rekomendasi): sudut membulat + garis aksen
// di sisi kiri. fill default = tint aksen mendekati putih (panel halus di slide terang);
// slide berlatar primer (Fase B) memakai KARTU putih — gaya kartu terang di latar gelap
// report acuan agency.
function addPointsPanel(
  slide: Slide,
  box: { x: number; y: number; w: number; h: number },
  accent: string,
  fill?: string
) {
  slide.addShape("roundRect", {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rectRadius: 0.06,
    fill: { color: fill ?? tint(accent, 0.93) },
    line: { type: "none" },
  });
  slide.addShape("rect", {
    x: box.x,
    y: box.y + 0.06,
    w: 0.05,
    h: box.h - 0.12,
    fill: { color: accent },
    line: { type: "none" },
  });
}

// Poin-poin ber-bullet dengan angka metrik bold — dipakai slide section (insight) DAN
// slide Kesimpulan, supaya formatnya seragam. Tiap poin = satu paragraf; angka jadi run
// bold via splitByNumbers — bold dihitung kode, bukan penanda di teks.
function addPointsText(
  slide: Slide,
  insight: PptInsight,
  box: { x: number; y: number; w: number; h: number },
  theme: PptTheme,
  accent: string,
  textColor: string = TEXT_BODY
) {
  const { points, numbers } = insight;
  // Ukuran font dihitung di kode — `fit: "shrink"` tidak menghasilkan fontScale apa pun,
  // jadi 8 poin panjang dulu dirender ukuran penuh dan menembus footer di file klien.
  // Lebar efektif dikurangi indent bullet (~0,25") supaya perkiraan tidak terlalu optimis.
  const bodySize = fitFontSize(
    points.map((pt) => parsePointLine(pt).text),
    { w: box.w - 2 * PANEL_PAD - 0.25, h: box.h - 2 * (PANEL_PAD * 0.7) },
    [SIZES.body, 12, 11, 10, 9],
    8
  );
  // Fase C: baris ber-prefix tab = SUB-POIN (satu tingkat) — paragraf indentLevel 1
  // dengan bullet sekunder (en dash) dan huruf sedikit lebih kecil. splitByNumbers
  // dipanggil pada teks yang sudah dilepas prefix — bold per baris tetap jalan.
  const runs = points.flatMap((point, pi) => {
    const { depth, text } = parsePointLine(point);
    const segs = splitByNumbers(text, numbers);
    return segs.map((seg, si) => ({
      text: seg.text,
      options: {
        bold: seg.bold,
        fontSize: depth === 1 ? bodySize - 1 : bodySize,
        // Properti paragraf (bullet/indent/jarak) menempel di run PERTAMA tiap baris.
        ...(si === 0
          ? {
              bullet:
                depth === 1
                  ? { code: "2013", indent: 10, color: accent } // – sub-poin
                  : { code: "2022", indent: 12, color: accent }, // • poin utama
              indentLevel: depth,
              paraSpaceAfter: depth === 1 ? 4 : 8,
            }
          : {}),
        // Run terakhir baris menutup paragraf (kecuali baris terakhir, biar tanpa
        // paragraf kosong menggantung).
        ...(si === segs.length - 1 && pi < points.length - 1 ? { breakLine: true } : {}),
      },
    }));
  });
  slide.addText(runs, {
    x: box.x + PANEL_PAD,
    y: box.y + PANEL_PAD * 0.7,
    w: box.w - 2 * PANEL_PAD,
    h: box.h - 2 * (PANEL_PAD * 0.7),
    fontFace: theme.bodyFont,
    fontSize: bodySize,
    color: textColor,
    valign: "top",
    align: "left",
    paraSpaceAfter: 8, // jarak antar poin
  });
}

// Batas foto per slide. Diukur dari render nyata: 4 foto ≈ 1,4" per foto — masih terbaca;
// 5 foto ≈ 0,86" sudah tidak; ≥12 foto membuat tinggi sel jatuh di bawah tinggi caption
// sehingga geometrinya negatif dan file .pptx rusak. Section yang lebih banyak fotonya
// dipecah ke slide lanjutan, bukan dijejalkan.
const MAX_PHOTOS_PER_SLIDE = 4;

// Satu section -> satu atau beberapa slide. Insight HANYA di slide pertama supaya klien
// tidak membaca teks yang sama berulang; slide lanjutan berisi foto saja. missingPhotos
// juga hanya dilaporkan sekali (di slide pertama) agar tidak terhitung ganda.
export function splitSectionPhotos(section: PptSection): PptSection[] {
  if (section.photos.length <= MAX_PHOTOS_PER_SLIDE) return [section];
  const out: PptSection[] = [];
  for (let i = 0; i < section.photos.length; i += MAX_PHOTOS_PER_SLIDE) {
    const first = i === 0;
    out.push({
      name: first ? section.name : `${section.name} (lanjutan)`,
      insight: first ? section.insight : null,
      photos: section.photos.slice(i, i + MAX_PHOTOS_PER_SLIDE),
      multiSource: section.multiSource,
      missingPhotos: first ? section.missingPhotos : 0,
    });
  }
  return out;
}

export async function buildReportPptx(
  data: PptReportData,
  rawTheme: PptTheme = DEFAULT_PPT_THEME
): Promise<Buffer> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inci (16:9)

  // Total slide dihitung DI MUKA (deterministik) untuk nomor halaman "n / total":
  // cover report (1) + per blok [pembatas + section + kesimpulan + rekomendasi?] + thank you (1).
  // Jaring pengaman tema. Route /api/theme sudah memvalidasi, tapi builder ini juga
  // dipanggil dari uji & skrip, dan warna tak valid akibatnya PARAH: `tint()` menghasilkan
  // "NaN..." (pptxgenjs diam-diam memakai hitam) sementara `isDarkColor` mengembalikan
  // false untuk NaN sehingga teks dipilih GELAP — teks gelap di atas latar hitam.
  const theme: PptTheme = {
    ...rawTheme,
    primary: normalizeHexColor(rawTheme.primary) ?? DEFAULT_THEME_COLORS.primary,
    secondary: normalizeHexColor(rawTheme.secondary) ?? DEFAULT_THEME_COLORS.secondary,
    accent: normalizeHexColor(rawTheme.accent) ?? DEFAULT_THEME_COLORS.accent,
    accentShopee: normalizeHexColor(rawTheme.accentShopee) ?? DEFAULT_THEME_COLORS.accentShopee,
    accentTiktok: normalizeHexColor(rawTheme.accentTiktok) ?? DEFAULT_THEME_COLORS.accentTiktok,
    // Nama font ditulis mentah ke atribut XML oleh pptxgenjs — "Font & Co" menghasilkan
    // `&` telanjang yang membuat file tidak well-formed dan ditolak PowerPoint.
    headingFont: isSafeFont(rawTheme.headingFont)
      ? rawTheme.headingFont
      : DEFAULT_THEME_COLORS.headingFont,
    bodyFont: isSafeFont(rawTheme.bodyFont)
      ? rawTheme.bodyFont
      : DEFAULT_THEME_COLORS.bodyFont,
  };

  // Pecah section berfoto banyak SEBELUM menghitung total halaman, supaya nomor "n / total"
  // ikut menghitung slide lanjutan (pageTotal memakai sections.length yang sama).
  // Rekomendasi = poin demi poin ketikan user, jumlahnya tak terbatas. Ukuran font dipilih
  // dulu (13→12→11→10), lalu kalau di 10pt pun tidak muat, poin dipecah ke slide
  // "(lanjutan)". Lebar efektif dikurangi indent bullet (~0,25") + paraSpaceAfter 8pt agar
  // paginasi konsisten dengan addPointsText yang merender bullet-nya.
  const RECO_SIZES = [SIZES.body, 12, 11, 10];
  const recoInner = {
    w: PAGE.w - 2 * MARGIN - 2 * PANEL_PAD - 0.25,
    h: CONTENT_H - 2 * (PANEL_PAD * 0.7),
  };

  const blocks = data.blocks.map((b) => {
    const pts = b.recommendation ?? [];
    // Font hanya dipakai untuk PAGINASI (addPointsText menghitung fit-nya sendiri saat
    // render). Poin dipecah ke slide "(lanjutan)" bila di 10pt pun tak muat satu slide.
    const recoFont = pts.length > 0 ? fitFontSize(pts, recoInner, RECO_SIZES, 8) : SIZES.body;
    const recoPages = pts.length > 0 ? paginateLines(pts, recoInner, recoFont, 8) : [];
    return {
      ...b,
      sections: b.sections.flatMap(splitSectionPhotos),
      recoPages,
    };
  });

  const pageTotal =
    1 +
    blocks.reduce((n, b) => n + 1 + b.sections.length + 1 + b.recoPages.length, 0) +
    1;
  let pageNo = 0;

  // --- Cover REPORT gaya agency (Fase B): logo di ATAS, band primer lebar penuh dengan
  // "MONTHLY REPORT" tebal besar + periode di dalamnya; daftar platform kecil di bawah band.
  // Bersih — hanya logo, band, dan teks.
  pageNo++;
  const cover = pptx.addSlide();
  cover.background = { color: BG };
  if (theme.logo) {
    // Logo contain di tengah-atas — proporsi dari header bytes, tak pernah gepeng.
    // Kotak DIPERBESAR (Jul 2026): tinggi 1,2"->1,95" dan lebar 2,8"->4,2". Tinggi yang
    // menentukan untuk logo persegi (contain memakai sisi paling sempit), jadi keduanya
    // dinaikkan. Berakhir di y=2,5" — masih menyisakan 0,3" sebelum band primer (2,8").
    const rect = containRect(
      theme.logo,
      { x: PAGE.w / 2 - 2.1, y: 0.55, w: 4.2, h: 1.95 },
      "middle"
    );
    cover.addImage({ data: theme.logo.data, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
  }
  const COVER_BAND_Y = 2.8;
  const COVER_BAND_H = 2.0;
  cover.addShape("rect", {
    x: 0,
    y: COVER_BAND_Y,
    w: PAGE.w,
    h: COVER_BAND_H,
    fill: { color: theme.primary },
    line: { type: "none" },
  });
  cover.addShape("rect", {
    x: 0,
    y: COVER_BAND_Y + COVER_BAND_H,
    w: PAGE.w,
    h: 0.06,
    fill: { color: theme.accent },
    line: { type: "none" },
  });
  cover.addText("MONTHLY REPORT", {
    x: MARGIN,
    y: COVER_BAND_Y + 0.3,
    w: PAGE.w - 2 * MARGIN,
    h: 0.95,
    align: "center",
    fontFace: theme.headingFont,
    fontSize: SIZES.coverTitle,
    bold: true,
    charSpacing: 3,
    color: onPrimaryText(theme),
  });
  // Brand (kalau ada) + periode di satu baris subjudul cover. DIPERBESAR & DIPERJELAS
  // (Jul 2026): 18pt biasa + warna subtle -> 26pt TEBAL + warna kontras penuh
  // (onPrimaryText, bukan onPrimarySubtle) supaya terbaca tegas di dalam band.
  // Kotak 0,55"->0,7". y TETAP 1,25 (persis di bawah kotak judul yang tutup di 4,05")
  // supaya tak bertindihan; berakhir 4,75" — masih di dalam band yang tutup di 4,8".
  const coverSubtitle = data.brandName
    ? `${data.brandName} · ${data.reportPeriod}`
    : data.reportPeriod;
  cover.addText(coverSubtitle, {
      x: MARGIN,
      y: COVER_BAND_Y + 1.25,
      w: PAGE.w - 2 * MARGIN,
      h: 0.7,
      align: "center",
      fontFace: theme.bodyFont,
      bold: true,
      // Dihitung di kode (`fit: "shrink"` no-op): nama brand panjang mengecil sampai
      // muat satu baris subjudul, tidak meluber melewati lebar cover.
      fontSize: fitFontSize(
        [coverSubtitle],
        { w: PAGE.w - 2 * MARGIN, h: 0.7 },
        [SIZES.coverBrand, 24, 22, 20, 18, 16]
      ),
      color: onPrimaryText(theme),
    }
  );
  cover.addText(
    blocks.map((b) => PLATFORM_LABEL[b.platform].toUpperCase()).join("  ·  "),
    {
      x: MARGIN,
      y: COVER_BAND_Y + COVER_BAND_H + 0.4,
      w: PAGE.w - 2 * MARGIN,
      h: 0.7,
      align: "center",
      // Diperbesar & dipertegas: font judul + tebal (dulu font body 12pt biasa).
      fontFace: theme.headingFont,
      fontSize: SIZES.coverPlatform,
      bold: true,
      charSpacing: 3,
      // Cover SELALU berlatar putih. Primer yang gelap dipakai langsung (paling tegas);
      // tema berprimer TERANG jatuh ke sekunder supaya tidak jadi terang-di-putih.
      color: isDarkColor(theme.primary) ? theme.primary : theme.secondary,
    }
  );

  for (const block of blocks) {
    const platformLabel = PLATFORM_LABEL[block.platform];
    const accent = resolveAccent(theme, block.platform);
    const footerLabel = `Laporan ${platformLabel} · ${data.reportPeriod}`;

    // --- Slide PEMBATAS platform (Fase A): latar primer penuh + teks besar, tanpa
    // elemen lain (keputusan user — styling saja).
    pageNo++;
    const divider = pptx.addSlide();
    divider.background = { color: theme.primary };
    divider.addText(DIVIDER_LABEL[block.platform], {
      x: MARGIN,
      y: 0,
      w: PAGE.w - 2 * MARGIN,
      h: PAGE.h,
      align: "center",
      valign: "middle",
      fontFace: theme.headingFont,
      fontSize: 44,
      bold: true,
      charSpacing: 4,
      color: onPrimaryText(theme),
    });

    // --- Slide per section (urutan narrativeOrder sudah disusun pemanggil) ---
    // Fase B (penyesuaian): section IKUT GELAP seperti report acuan — latar primer,
    // judul terang, foto dalam KARTU putih, insight terang di panel gelap halus.
    // Kontras dijaga isDarkColor: primer terang -> teks otomatis gelap, bukan putih.
    for (const section of block.sections) {
      pageNo++;
      const slide = pptx.addSlide();
      slide.background = { color: theme.primary };
      addSlideHeader(slide, section.name, theme, accent, true);
      addFooter(slide, footerLabel, pageNo, pageTotal, theme, true);

      // Foto kiri dalam SATU kartu putih membulat (gaya kartu terang di latar gelap,
      // konsisten slide Kesimpulan). Semua foto section satu slide, ditumpuk vertikal;
      // tiap foto sumber terpisah — caption "Sumber #n" saat >1 (aturan DESIGN); foto
      // asli tak pernah ditimpa elemen desain (kartu ada DI BELAKANG foto).
      const n = section.photos.length;
      if (n > 0) {
        slide.addShape("roundRect", {
          x: LEFT.x,
          y: CONTENT_Y,
          w: LEFT.w,
          h: CONTENT_H,
          rectRadius: 0.06,
          fill: { color: "FFFFFF" },
          line: { type: "none" },
        });
        const PHOTO_PAD = 0.15; // padding dalam kartu foto
        const inner = {
          x: LEFT.x + PHOTO_PAD,
          y: CONTENT_Y + PHOTO_PAD,
          w: LEFT.w - 2 * PHOTO_PAD,
          h: CONTENT_H - 2 * PHOTO_PAD,
        };
        const sectionHasPeriods = section.photos.some((ph) => ph.periodLabel !== null);
        const cellH = (inner.h - PHOTO_GAP * (n - 1)) / n;
        section.photos.forEach((photo, i) => {
          const cellY = inner.y + i * (cellH + PHOTO_GAP);
          // Caption = label bulan dari user kalau ada; kalau tidak, nomor "Sumber #n" dan
          // hanya saat sumbernya memang lebih dari satu. null = tanpa caption.
          // Kosakata caption diputuskan PER SECTION, bukan per foto: kalau ada satu saja
          // foto berlabel bulan, foto lain yang tak berlabel TIDAK boleh jatuh ke
          // "Sumber #n" — pembaca deck akan melihat dua sistem penamaan berdampingan
          // ("Mei 2026" di sebelah "Sumber #2"). Bisa terjadi saat penanda perbandingan
          // periode dinyalakan setelah section sudah punya foto.
          const caption = sectionHasPeriods
            ? (photo.periodLabel ?? "Tanpa periode")
            : section.multiSource
              ? `Sumber #${photo.sourceIndex}`
              : null;
          const capH = caption ? CAPTION_H : 0;
          const rect = containRect(photo, {
            x: inner.x,
            y: cellY,
            w: inner.w,
            h: cellH - capH,
          });
          slide.addImage({ data: photo.data, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
          if (caption) {
            // Caption di DALAM kartu putih -> selalu abu sekunder (terbaca, netral tema).
            slide.addText(caption, {
              x: inner.x,
              y: rect.y + rect.h,
              w: inner.w,
              h: capH,
              align: "center",
              fontFace: theme.bodyFont,
              fontSize: SIZES.caption,
              color: theme.secondary,
            });
          }
        });
      }
      if (section.missingPhotos > 0) {
        // Kalau ada foto, notice jatuh DI ATAS kartu putih — warnanya harus warna teks
        // kartu, bukan `onPrimarySubtle` (abu terang untuk latar gelap) yang praktis tak
        // terbaca di putih. Posisinya juga ditarik ke dalam kartu supaya tidak menembus
        // garis footer. Tanpa foto, tidak ada kartu -> pakai warna latar primer.
        const onCard = n > 0;
        slide.addText(`${section.missingPhotos} foto tidak terbaca dari storage`, {
          x: LEFT.x + 0.15,
          y: onCard ? CONTENT_Y + CONTENT_H - 0.42 : FOOTER_Y - 0.32,
          w: LEFT.w - 0.3,
          h: 0.3,
          fontFace: theme.bodyFont,
          fontSize: SIZES.caption,
          color: onCard ? theme.secondary : onPrimarySubtle(theme),
          italic: true,
        });
      }

      // Insight kanan: panel gelap halus (primer sedikit diterangkan) + garis aksen;
      // teks terang mengikuti kontras primer, angka bold tetap bold (mekanisme sama).
      if (section.insight && section.insight.points.length > 0) {
        const box = { x: RIGHT.x, y: CONTENT_Y, w: RIGHT.w, h: CONTENT_H };
        addPointsPanel(slide, box, accent, tint(theme.primary, 0.08));
        addPointsText(slide, section.insight, box, theme, accent, onPrimaryText(theme));
      }
    }

    // --- Slide Kesimpulan (Fase B): latar primer penuh + KARTU putih berisi poin —
    // gaya kartu terang di latar gelap report acuan agency. Teks poin tetap gelap
    // (di dalam kartu), bold angka & mekanismenya tak berubah.
    pageNo++;
    const closing = pptx.addSlide();
    closing.background = { color: theme.primary };
    addSlideHeader(closing, "Kesimpulan", theme, accent, true);
    addFooter(closing, footerLabel, pageNo, pageTotal, theme, true);
    closing.addText(`${platformLabel} · ${data.reportPeriod}`, {
      x: PAGE.w - MARGIN - 3.5,
      y: HEADER_Y,
      w: 3.5,
      h: HEADER_H,
      align: "right",
      valign: "middle",
      fontFace: theme.bodyFont,
      fontSize: SIZES.caption,
      color: onPrimarySubtle(theme),
    });

    const closingBox = {
      x: MARGIN,
      y: CONTENT_Y,
      w: PAGE.w - 2 * MARGIN,
      h: CONTENT_H,
    };
    if (block.conclusion && block.conclusion.points.length > 0) {
      addPointsPanel(closing, closingBox, accent, "FFFFFF");
      addPointsText(closing, block.conclusion, closingBox, theme, accent);
    } else {
      closing.addText("(belum ada kesimpulan — generate dari halaman report)", {
        x: closingBox.x,
        y: closingBox.y,
        w: closingBox.w,
        h: 0.4,
        fontFace: theme.bodyFont,
        fontSize: SIZES.caption,
        color: onPrimarySubtle(theme),
        italic: true,
      });
    }

    // --- Slide REKOMENDASI & ACTION PLAN (Fase A): poin demi poin jadi BULLET LIST,
    // format seragam dgn Kesimpulan (addPointsText) TAPI numbers kosong = TANPA bold
    // otomatis (rekomendasi tetap murni ketikan manual). Kosong = slide tidak dibuat
    // (sudah disaring pemanggil; guard defensif di sini).
    for (let ri = 0; ri < block.recoPages.length; ri++) {
      const pagePoints = block.recoPages[ri];
      pageNo++;
      const reco = pptx.addSlide();
      // Fase B: senada dengan Kesimpulan — latar primer + kartu putih berisi poin.
      reco.background = { color: theme.primary };
      addSlideHeader(
        reco,
        ri === 0 ? "Rekomendasi & Action Plan" : "Rekomendasi & Action Plan (lanjutan)",
        theme,
        accent,
        true
      );
      addFooter(reco, footerLabel, pageNo, pageTotal, theme, true);
      const recoBox = { x: MARGIN, y: CONTENT_Y, w: PAGE.w - 2 * MARGIN, h: CONTENT_H };
      addPointsPanel(reco, recoBox, accent, "FFFFFF");
      addPointsText(reco, { points: pagePoints, numbers: [] }, recoBox, theme, accent);
    }
  }

  // --- Slide THANK YOU (sekali di akhir report; Fase B: latar primer, senada pembatas &
  // kesimpulan): teks + logo tema + kontak. Bagian yang kosong dilewati tanpa error.
  pageNo++;
  const thanks = pptx.addSlide();
  thanks.background = { color: theme.primary };
  if (theme.logo) {
    // Kotak logo DIPERBESAR (Jul 2026): 2,2"x1,1" -> 3,5"x1,75", digeser naik ke y=1,05"
    // supaya ujung bawahnya (2,8") tetap menyisakan jarak sebelum "Thank You" di y=3,0".
    const rect = containRect(theme.logo, { x: PAGE.w / 2 - 1.75, y: 1.05, w: 3.5, h: 1.75 });
    // Latar primer GELAP -> pakai varian PUTIH kalau route berhasil menyiapkannya, supaya
    // logo bertinta gelap tidak "hilang" di slide penutup. Geometri dari logo asli
    // (dimensinya sama persis). Latar terang tetap memakai logo asli.
    const logoData =
      isDarkColor(theme.primary) && theme.logo.dataOnDark
        ? theme.logo.dataOnDark
        : theme.logo.data;
    thanks.addImage({ data: logoData, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
  }
  thanks.addText("Thank You", {
    x: MARGIN,
    y: 3.0,
    w: PAGE.w - 2 * MARGIN,
    h: 1.1,
    align: "center",
    fontFace: theme.headingFont,
    fontSize: 40,
    bold: true,
    color: onPrimaryText(theme),
  });
  const contactLines = [
    theme.contacts.email,
    theme.contacts.website,
    theme.contacts.instagram,
  ].filter((c) => c.trim().length > 0);
  if (contactLines.length > 0) {
    thanks.addShape("rect", {
      x: PAGE.w / 2 - 0.8,
      y: 4.35,
      w: 1.6,
      h: 0.05,
      fill: { color: theme.accent },
      line: { type: "none" },
    });
    thanks.addText(
      contactLines.map((line, i) => ({
        text: line,
        options: { ...(i < contactLines.length - 1 ? { breakLine: true } : {}) },
      })),
      {
        x: MARGIN,
        y: 4.6,
        w: PAGE.w - 2 * MARGIN,
        h: 1.2,
        align: "center",
        fontFace: theme.bodyFont,
        fontSize: SIZES.coverSub - 4,
        color: onPrimarySubtle(theme),
        paraSpaceAfter: 6,
      }
    );
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
