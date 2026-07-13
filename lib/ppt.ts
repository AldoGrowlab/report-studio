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
  resolveAccent,
  tint,
  type ThemeColors,
} from "@/lib/theme";

// Logo tema (opsional) — bytes untuk hitung proporsi, data URL untuk pptxgenjs.
export type PptLogo = {
  data: string;
  bytes: Uint8Array;
  contentType: string;
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
  coverKicker: 12,
  coverTitle: 40,
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
  // "Rekomendasi & Action Plan" ketikan user (Fase A) — apa adanya, baris baru
  // dipertahankan, TANPA bold otomatis. null/kosong = slide TIDAK dibuat.
  recommendation: string | null;
};

export type PptReportData = {
  reportPeriod: string;
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
  let w = box.w;
  let h = w / ratio;
  if (h > box.h) {
    h = box.h;
    w = h * ratio;
  }
  const y = align === "middle" ? box.y + (box.h - h) / 2 : box.y;
  return { x: box.x + (box.w - w) / 2, y, w, h };
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
    fontSize: SIZES.titleXL,
    bold: true,
    charSpacing: 1,
    color: onDark ? onPrimaryText(theme) : theme.primary,
    valign: "middle",
    fit: "shrink", // nama section panjang menyusut, tidak terpotong
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
        fontSize: depth === 1 ? SIZES.body - 1 : SIZES.body,
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
    fontSize: SIZES.body,
    color: textColor,
    valign: "top",
    align: "left",
    paraSpaceAfter: 8, // jarak antar poin
    fit: "shrink", // teks panjang menyusut agar muat, bukan terpotong
  });
}

export async function buildReportPptx(
  data: PptReportData,
  theme: PptTheme = DEFAULT_PPT_THEME
): Promise<Buffer> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inci (16:9)

  // Total slide dihitung DI MUKA (deterministik) untuk nomor halaman "n / total":
  // cover report (1) + per blok [pembatas + section + kesimpulan + rekomendasi?] + thank you (1).
  const pageTotal =
    1 +
    data.blocks.reduce(
      (n, b) => n + 1 + b.sections.length + 1 + (b.recommendation ? 1 : 0),
      0
    ) +
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
    const rect = containRect(
      theme.logo,
      { x: PAGE.w / 2 - 1.4, y: 0.8, w: 2.8, h: 1.2 },
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
  cover.addText(data.reportPeriod, {
    x: MARGIN,
    y: COVER_BAND_Y + 1.25,
    w: PAGE.w - 2 * MARGIN,
    h: 0.55,
    align: "center",
    fontFace: theme.bodyFont,
    fontSize: SIZES.coverSub,
    color: onPrimarySubtle(theme),
  });
  cover.addText(
    data.blocks.map((b) => PLATFORM_LABEL[b.platform].toUpperCase()).join("  ·  "),
    {
      x: MARGIN,
      y: COVER_BAND_Y + COVER_BAND_H + 0.4,
      w: PAGE.w - 2 * MARGIN,
      h: 0.4,
      align: "center",
      fontFace: theme.bodyFont,
      fontSize: SIZES.coverKicker,
      charSpacing: 5,
      color: theme.secondary,
    }
  );

  for (const block of data.blocks) {
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
        const cellH = (inner.h - PHOTO_GAP * (n - 1)) / n;
        section.photos.forEach((photo, i) => {
          const cellY = inner.y + i * (cellH + PHOTO_GAP);
          const capH = section.multiSource ? CAPTION_H : 0;
          const rect = containRect(photo, {
            x: inner.x,
            y: cellY,
            w: inner.w,
            h: cellH - capH,
          });
          slide.addImage({ data: photo.data, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
          if (section.multiSource) {
            // Caption di DALAM kartu putih -> selalu abu sekunder (terbaca, netral tema).
            slide.addText(`Sumber #${photo.sourceIndex}`, {
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
        slide.addText(`${section.missingPhotos} foto tidak terbaca dari storage`, {
          x: LEFT.x,
          y: FOOTER_Y - 0.32,
          w: LEFT.w,
          h: 0.3,
          fontFace: theme.bodyFont,
          fontSize: SIZES.caption,
          color: onPrimarySubtle(theme),
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

    // --- Slide REKOMENDASI & ACTION PLAN (Fase A): ketikan user APA ADANYA — per baris
    // jadi paragraf (baris kosong dipertahankan), TANPA bullet paksa, TANPA bold otomatis.
    // Kosong = slide tidak dibuat (sudah disaring pemanggil; guard defensif di sini).
    if (block.recommendation && block.recommendation.trim().length > 0) {
      pageNo++;
      const reco = pptx.addSlide();
      // Fase B: senada dengan Kesimpulan — latar primer + kartu putih; teks user tetap
      // APA ADANYA (per baris jadi paragraf, tanpa bullet paksa, tanpa bold otomatis).
      reco.background = { color: theme.primary };
      addSlideHeader(reco, "Rekomendasi & Action Plan", theme, accent, true);
      addFooter(reco, footerLabel, pageNo, pageTotal, theme, true);
      const recoBox = { x: MARGIN, y: CONTENT_Y, w: PAGE.w - 2 * MARGIN, h: CONTENT_H };
      addPointsPanel(reco, recoBox, accent, "FFFFFF");
      const lines = block.recommendation.replace(/\r\n/g, "\n").split("\n");
      const runs = lines.map((line, i) => ({
        // Baris kosong tetap jadi paragraf (spasi) supaya jarak antar blok terjaga.
        text: line === "" ? " " : line,
        options: { ...(i < lines.length - 1 ? { breakLine: true } : {}) },
      }));
      reco.addText(runs, {
        x: recoBox.x + PANEL_PAD,
        y: recoBox.y + PANEL_PAD * 0.7,
        w: recoBox.w - 2 * PANEL_PAD,
        h: recoBox.h - 2 * (PANEL_PAD * 0.7),
        fontFace: theme.bodyFont,
        fontSize: SIZES.body,
        color: TEXT_BODY,
        valign: "top",
        align: "left",
        paraSpaceAfter: 4,
        fit: "shrink",
      });
    }
  }

  // --- Slide THANK YOU (sekali di akhir report; Fase B: latar primer, senada pembatas &
  // kesimpulan): teks + logo tema + kontak. Bagian yang kosong dilewati tanpa error.
  pageNo++;
  const thanks = pptx.addSlide();
  thanks.background = { color: theme.primary };
  if (theme.logo) {
    const rect = containRect(theme.logo, { x: PAGE.w / 2 - 1.1, y: 1.35, w: 2.2, h: 1.1 });
    thanks.addImage({ data: theme.logo.data, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
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
