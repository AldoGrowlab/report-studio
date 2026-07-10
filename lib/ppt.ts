// Tahap 8 — Template Engine: data report tersimpan -> file .pptx, DETERMINISTIK (bukan LLM).
// Murni data-polos -> Buffer: tanpa Prisma, tanpa storage, tanpa AI — semua keputusan tata
// letak dihitung di kode supaya konsisten antar run (DESIGN §Arsitektur). Foto DISEMATKAN
// (embedded) agar file mandiri; teks insight dipakai APA ADANYA (angka singkat sudah
// dihasilkan Analyst — tidak diolah ulang).

import { imageSizePx } from "@/lib/image-size";
import { splitByNumbers } from "@/lib/insight-format";

// Tema netral sementara. Tahap 10 (tema bulanan) mengganti konstanta ini via config —
// semua keputusan visual dikumpulkan di sini supaya penggantian nanti satu titik.
export const THEME = {
  fontFace: "Calibri",
  bg: "FFFFFF",
  text: "1F2937", // abu gelap
  subtle: "9CA3AF", // abu untuk placeholder/caption
  accent: "2563EB", // aksen biru
  coverTitleSize: 30,
  coverSubSize: 16,
  titleSize: 20,
  bodySize: 13,
  captionSize: 10,
};

// Kanvas 16:9 (inci) + geometri kolom. Foto KIRI, insight KANAN (keputusan Tahap 8).
const PAGE = { w: 13.33, h: 7.5 };
const MARGIN = 0.5;
const TITLE_H = 0.6;
const CONTENT_Y = 1.2;
const CONTENT_H = PAGE.h - CONTENT_Y - 0.45;
const LEFT = { x: MARGIN, w: 6.1 }; // kolom foto
const RIGHT = { x: 6.95, w: PAGE.w - 6.95 - MARGIN }; // kolom insight
const PHOTO_GAP = 0.2;
const CAPTION_H = 0.28;

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
  insight: PptInsight | null; // null = belum ada insight -> area kanan kosong
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
  photo: PptPhoto,
  box: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  const px = imageSizePx(photo.bytes, photo.contentType);
  const ratio = px ? px.w / px.h : 4 / 3;
  let w = box.w;
  let h = w / ratio;
  if (h > box.h) {
    h = box.h;
    w = h * ratio;
  }
  return { x: box.x + (box.w - w) / 2, y: box.y, w, h };
}

type Slide = import("pptxgenjs").default.Slide;

function addSlideTitle(slide: Slide, text: string) {
  slide.addText(text, {
    x: MARGIN,
    y: 0.35,
    w: PAGE.w - 2 * MARGIN,
    h: TITLE_H,
    fontFace: THEME.fontFace,
    fontSize: THEME.titleSize,
    bold: true,
    color: THEME.text,
    valign: "middle",
  });
}

// Poin-poin ber-bullet dengan angka metrik bold — dipakai slide section (insight) DAN
// slide Kesimpulan (Tahap 7a), supaya formatnya seragam. Tiap poin = satu paragraf;
// angka jadi run bold via splitByNumbers — bold dihitung kode, bukan penanda di teks.
function addPointsText(
  slide: Slide,
  insight: PptInsight,
  box: { x: number; y: number; w: number; h: number }
) {
  const { points, numbers } = insight;
  const runs = points.flatMap((point, pi) => {
    const segs = splitByNumbers(point, numbers);
    return segs.map((seg, si) => ({
      text: seg.text,
      options: {
        bold: seg.bold,
        // Properti paragraf menempel di run PERTAMA tiap poin.
        ...(si === 0 ? { bullet: { code: "2022", indent: 12 } } : {}),
        // Run terakhir poin menutup paragraf (kecuali poin terakhir, biar tanpa
        // paragraf kosong menggantung).
        ...(si === segs.length - 1 && pi < points.length - 1 ? { breakLine: true } : {}),
      },
    }));
  });
  slide.addText(runs, {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fontFace: THEME.fontFace,
    fontSize: THEME.bodySize,
    color: THEME.text,
    valign: "top",
    align: "left",
    paraSpaceAfter: 8, // jarak antar poin
    fit: "shrink", // teks panjang menyusut agar muat, bukan terpotong
  });
}

export async function buildReportPptx(data: PptReportData): Promise<Buffer> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 inci (16:9)

  for (const block of data.blocks) {
    const platformLabel = PLATFORM_LABEL[block.platform];

    // --- Cover blok platform ---
    const cover = pptx.addSlide();
    cover.background = { color: THEME.bg };
    cover.addText(`Laporan Performa ${platformLabel}`, {
      x: MARGIN,
      y: 2.7,
      w: PAGE.w - 2 * MARGIN,
      h: 1.0,
      align: "center",
      fontFace: THEME.fontFace,
      fontSize: THEME.coverTitleSize,
      bold: true,
      color: THEME.text,
    });
    cover.addShape("rect", {
      x: PAGE.w / 2 - 1,
      y: 3.85,
      w: 2,
      h: 0.05,
      fill: { color: THEME.accent },
      line: { type: "none" },
    });
    cover.addText(data.reportPeriod, {
      x: MARGIN,
      y: 4.05,
      w: PAGE.w - 2 * MARGIN,
      h: 0.6,
      align: "center",
      fontFace: THEME.fontFace,
      fontSize: THEME.coverSubSize,
      color: THEME.subtle,
    });

    // --- Slide per section (urutan narrativeOrder sudah disusun pemanggil) ---
    for (const section of block.sections) {
      const slide = pptx.addSlide();
      slide.background = { color: THEME.bg };
      addSlideTitle(slide, section.name);

      // Foto kiri: semua foto section dalam SATU slide, ditumpuk vertikal berbagi tinggi
      // kolom. Tiap foto sumber terpisah — caption "Sumber #n" saat >1 (aturan DESIGN).
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
              fontFace: THEME.fontFace,
              fontSize: THEME.captionSize,
              color: THEME.subtle,
            });
          }
        });
      }
      if (section.missingPhotos > 0) {
        slide.addText(
          `${section.missingPhotos} foto tidak terbaca dari storage`,
          {
            x: LEFT.x,
            y: PAGE.h - 0.4,
            w: LEFT.w,
            h: 0.3,
            fontFace: THEME.fontFace,
            fontSize: THEME.captionSize,
            color: THEME.subtle,
            italic: true,
          }
        );
      }

      // Insight kanan: poin-poin ber-bullet dengan angka bold; belum ada -> area kosong.
      if (section.insight && section.insight.points.length > 0) {
        addPointsText(slide, section.insight, {
          x: RIGHT.x,
          y: CONTENT_Y,
          w: RIGHT.w,
          h: CONTENT_H,
        });
      }
    }

    // --- Slide kesimpulan platform (slot Tahap 8, diisi Validator Tahap 7a) ---
    // Ada kesimpulan -> poin-poin format seragam dengan insight; belum -> placeholder.
    const closing = pptx.addSlide();
    closing.background = { color: THEME.bg };
    addSlideTitle(closing, "Kesimpulan");
    if (block.conclusion && block.conclusion.points.length > 0) {
      addPointsText(closing, block.conclusion, {
        x: MARGIN,
        y: CONTENT_Y,
        w: PAGE.w - 2 * MARGIN,
        h: CONTENT_H,
      });
    } else {
      closing.addText("(belum ada kesimpulan — generate dari halaman report)", {
        x: MARGIN,
        y: CONTENT_Y,
        w: PAGE.w - 2 * MARGIN,
        h: 0.4,
        fontFace: THEME.fontFace,
        fontSize: THEME.captionSize,
        color: THEME.subtle,
        italic: true,
      });
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}
