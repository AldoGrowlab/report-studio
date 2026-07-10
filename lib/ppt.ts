// Tahap 8 + 10 — Template Engine: data report tersimpan -> file .pptx, DETERMINISTIK
// (bukan LLM). Murni data-polos -> Buffer: tanpa Prisma, tanpa storage, tanpa AI — semua
// keputusan tata letak dihitung di kode supaya konsisten antar run (DESIGN §Arsitektur).
// Foto DISEMATKAN (embedded) agar file mandiri; teks insight dipakai APA ADANYA.
// Tema (Tahap 10) masuk sebagai PARAMETER data polos (route pptx yang membaca DB) —
// polesan estetik Tingkat 2: pola tetap, bersih, foto asli tak pernah ditimpa elemen.

import { imageSizePx } from "@/lib/image-size";
import { splitByNumbers } from "@/lib/insight-format";
import {
  DEFAULT_THEME_COLORS,
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

export type PptTheme = ThemeColors & { logo: PptLogo | null };

export const DEFAULT_PPT_THEME: PptTheme = { ...DEFAULT_THEME_COLORS, logo: null };

// Konstanta netral non-tema.
const TEXT_BODY = "1F2937"; // teks body tetap gelap netral — keterbacaan di atas putih
const BG = "FFFFFF";
const SIZES = {
  coverKicker: 12,
  coverTitle: 40,
  coverSub: 18,
  title: 20,
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
};

export type PptReportData = {
  reportPeriod: string;
  blocks: PptBlock[]; // urutan blok sudah ditentukan pemanggil (Shopee dulu, lalu TikTok)
};

const PLATFORM_LABEL: Record<PptBlock["platform"], string> = {
  shopee: "Shopee",
  tiktok: "TikTok",
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

// Header slide konten: bar aksen vertikal di kiri judul + judul (heading font, warna
// primer) + garis pemisah tipis lebar penuh di bawahnya.
function addSlideHeader(slide: Slide, text: string, theme: PptTheme, accent: string) {
  slide.addShape("rect", {
    x: MARGIN,
    y: HEADER_Y + 0.06,
    w: 0.09,
    h: HEADER_H - 0.12,
    fill: { color: accent },
    line: { type: "none" },
  });
  slide.addText(text, {
    x: MARGIN + 0.22,
    y: HEADER_Y,
    w: PAGE.w - 2 * MARGIN - 0.22,
    h: HEADER_H,
    fontFace: theme.headingFont,
    fontSize: SIZES.title,
    bold: true,
    color: theme.primary,
    valign: "middle",
  });
  slide.addShape("rect", {
    x: MARGIN,
    y: HEADER_Y + HEADER_H + 0.12,
    w: PAGE.w - 2 * MARGIN,
    h: 0.015,
    fill: { color: tint(theme.secondary, 0.75) },
    line: { type: "none" },
  });
}

// Footer slide konten: garis tipis + label report kiri + nomor halaman kanan.
// Nomor dihitung manual (deterministik) oleh pemanggil.
function addFooter(
  slide: Slide,
  label: string,
  pageNo: number,
  pageTotal: number,
  theme: PptTheme
) {
  slide.addShape("rect", {
    x: MARGIN,
    y: FOOTER_Y,
    w: PAGE.w - 2 * MARGIN,
    h: 0.012,
    fill: { color: tint(theme.secondary, 0.8) },
    line: { type: "none" },
  });
  slide.addText(label, {
    x: MARGIN,
    y: FOOTER_Y + 0.03,
    w: 6,
    h: 0.3,
    fontFace: theme.bodyFont,
    fontSize: SIZES.footer,
    color: theme.secondary,
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
    color: theme.secondary,
    valign: "middle",
  });
}

// Panel latar halus untuk poin (insight & kesimpulan): tint aksen mendekati putih,
// sudut membulat, garis aksen di sisi kiri — turunan tema, bukan warna lepas.
function addPointsPanel(
  slide: Slide,
  box: { x: number; y: number; w: number; h: number },
  accent: string
) {
  slide.addShape("roundRect", {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rectRadius: 0.06,
    fill: { color: tint(accent, 0.93) },
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
  accent: string
) {
  const { points, numbers } = insight;
  const runs = points.flatMap((point, pi) => {
    const segs = splitByNumbers(point, numbers);
    return segs.map((seg, si) => ({
      text: seg.text,
      options: {
        bold: seg.bold,
        // Properti paragraf menempel di run PERTAMA tiap poin.
        ...(si === 0 ? { bullet: { code: "2022", indent: 12, color: accent } } : {}),
        // Run terakhir poin menutup paragraf (kecuali poin terakhir, biar tanpa
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
    color: TEXT_BODY,
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

  // Total slide dihitung DI MUKA (deterministik) untuk nomor halaman "n / total".
  const pageTotal = data.blocks.reduce((n, b) => n + 1 + b.sections.length + 1, 0);
  let pageNo = 0;

  for (const block of data.blocks) {
    const platformLabel = PLATFORM_LABEL[block.platform];
    const accent = resolveAccent(theme, block.platform);
    const footerLabel = `Laporan ${platformLabel} · ${data.reportPeriod}`;

    // --- Cover blok platform: panel primer kiri + logo + hierarki judul di kanan ---
    pageNo++;
    const cover = pptx.addSlide();
    cover.background = { color: BG };
    const PANEL_W = 5.07; // ±38% lebar slide
    cover.addShape("rect", {
      x: 0,
      y: 0,
      w: PANEL_W,
      h: PAGE.h,
      fill: { color: theme.primary },
      line: { type: "none" },
    });
    cover.addShape("rect", {
      x: PANEL_W,
      y: 0,
      w: 0.06,
      h: PAGE.h,
      fill: { color: accent },
      line: { type: "none" },
    });
    if (theme.logo) {
      // Logo contain di panel kiri-atas — proporsi dari header bytes, tak pernah gepeng.
      const rect = containRect(theme.logo, { x: 0.5, y: 0.5, w: 1.8, h: 1.0 });
      cover.addImage({ data: theme.logo.data, x: 0.5, y: rect.y, w: rect.w, h: rect.h });
    }
    const coverRight = { x: PANEL_W + 0.66, w: PAGE.w - PANEL_W - 0.66 - MARGIN };
    cover.addText("LAPORAN PERFORMA", {
      x: coverRight.x,
      y: 2.55,
      w: coverRight.w,
      h: 0.4,
      fontFace: theme.bodyFont,
      fontSize: SIZES.coverKicker,
      charSpacing: 6,
      color: theme.secondary,
    });
    cover.addText(platformLabel, {
      x: coverRight.x,
      y: 2.95,
      w: coverRight.w,
      h: 1.0,
      fontFace: theme.headingFont,
      fontSize: SIZES.coverTitle,
      bold: true,
      color: theme.primary,
    });
    cover.addShape("rect", {
      x: coverRight.x + 0.02,
      y: 4.1,
      w: 1.6,
      h: 0.06,
      fill: { color: accent },
      line: { type: "none" },
    });
    cover.addText(data.reportPeriod, {
      x: coverRight.x,
      y: 4.3,
      w: coverRight.w,
      h: 0.6,
      fontFace: theme.bodyFont,
      fontSize: SIZES.coverSub,
      color: theme.secondary,
    });

    // --- Slide per section (urutan narrativeOrder sudah disusun pemanggil) ---
    for (const section of block.sections) {
      pageNo++;
      const slide = pptx.addSlide();
      slide.background = { color: BG };
      addSlideHeader(slide, section.name, theme, accent);
      addFooter(slide, footerLabel, pageNo, pageTotal, theme);

      // Foto kiri: semua foto section dalam SATU slide, ditumpuk vertikal berbagi tinggi
      // kolom. Tiap foto sumber terpisah — caption "Sumber #n" saat >1 (aturan DESIGN).
      // Foto asli tak pernah ditimpa elemen desain.
      const n = section.photos.length;
      if (n > 0) {
        const cellH = (CONTENT_H - PHOTO_GAP * (n - 1)) / n;
        section.photos.forEach((photo, i) => {
          const cellY = CONTENT_Y + i * (cellH + PHOTO_GAP);
          const capH = section.multiSource ? CAPTION_H : 0;
          const rect = containRect(photo, {
            x: LEFT.x,
            y: cellY,
            w: LEFT.w,
            h: cellH - capH,
          });
          slide.addImage({ data: photo.data, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
          if (section.multiSource) {
            slide.addText(`Sumber #${photo.sourceIndex}`, {
              x: LEFT.x,
              y: rect.y + rect.h,
              w: LEFT.w,
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
          color: theme.secondary,
          italic: true,
        });
      }

      // Insight kanan: panel halus ber-aksen + poin-poin bold; belum ada -> tanpa panel.
      if (section.insight && section.insight.points.length > 0) {
        const box = { x: RIGHT.x, y: CONTENT_Y, w: RIGHT.w, h: CONTENT_H };
        addPointsPanel(slide, box, accent);
        addPointsText(slide, section.insight, box, theme, accent);
      }
    }

    // --- Slide Kesimpulan: band primer penutup — terasa beda dari slide section ---
    pageNo++;
    const closing = pptx.addSlide();
    closing.background = { color: BG };
    const BAND_H = 1.1;
    closing.addShape("rect", {
      x: 0,
      y: 0,
      w: PAGE.w,
      h: BAND_H,
      fill: { color: theme.primary },
      line: { type: "none" },
    });
    closing.addShape("rect", {
      x: 0,
      y: BAND_H,
      w: PAGE.w,
      h: 0.05,
      fill: { color: accent },
      line: { type: "none" },
    });
    closing.addText("Kesimpulan", {
      x: MARGIN,
      y: 0.14,
      w: PAGE.w - 2 * MARGIN,
      h: 0.6,
      fontFace: theme.headingFont,
      fontSize: SIZES.title + 2,
      bold: true,
      color: "FFFFFF",
    });
    closing.addText(`${platformLabel} · ${data.reportPeriod}`, {
      x: MARGIN,
      y: 0.66,
      w: PAGE.w - 2 * MARGIN,
      h: 0.34,
      fontFace: theme.bodyFont,
      fontSize: SIZES.caption,
      color: tint(theme.primary, 0.65),
    });
    addFooter(closing, footerLabel, pageNo, pageTotal, theme);

    const closingBox = {
      x: MARGIN,
      y: BAND_H + 0.35,
      w: PAGE.w - 2 * MARGIN,
      h: FOOTER_Y - (BAND_H + 0.35) - 0.12,
    };
    if (block.conclusion && block.conclusion.points.length > 0) {
      addPointsPanel(closing, closingBox, accent);
      addPointsText(closing, block.conclusion, closingBox, theme, accent);
    } else {
      closing.addText("(belum ada kesimpulan — generate dari halaman report)", {
        x: closingBox.x,
        y: closingBox.y,
        w: closingBox.w,
        h: 0.4,
        fontFace: theme.bodyFont,
        fontSize: SIZES.caption,
        color: theme.secondary,
        italic: true,
      });
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
