import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { getStorage } from "@/lib/storage";
import { groupBySection } from "@/lib/uploads-view";
import { formatMonthID } from "@/lib/period";
import { isDarkColor } from "@/lib/theme";
import sharp from "sharp";
import {
  buildReportPptx,
  DEFAULT_PPT_THEME,
  type PptBlock,
  type PptPhoto,
  type PptTheme,
} from "@/lib/ppt";

// GET — unduh report sebagai .pptx (Tahap 8, Template Engine DETERMINISTIK — tanpa AI).
// GET supaya browser mengunduh langsung (cookie session ikut). Founder & operator.
export async function GET(_request: Request, ctx: RouteContext<"/api/reports/[id]/pptx">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id: reportId } = await ctx.params;

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      uploads: {
        orderBy: { createdAt: "asc" }, // urutan input = nomor "Sumber #n" (konsisten UI/Analyst)
        include: { section: { select: { id: true, name: true, platform: true, narrativeOrder: true } } },
      },
      insights: { select: { sectionId: true, points: true, numbers: true } },
      conclusions: { select: { platform: true, points: true, numbers: true } },
      recommendations: { select: { platform: true, points: true } },
    },
  });
  if (!report) {
    return NextResponse.json({ error: "Report tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  if (report.uploads.length === 0) {
    return NextResponse.json(
      { error: "Report belum punya foto — tidak ada yang bisa dirangkai jadi PPT." },
      { status: 400 }
    );
  }

  const insightBySection = new Map(
    report.insights.map((i) => [i.sectionId, { points: i.points, numbers: i.numbers }])
  );
  const storage = getStorage();

  // Blok per platform, urutan TETAP Shopee lalu TikTok (DESIGN §Platform).
  const blocks: PptBlock[] = [];
  for (const platform of ["shopee", "tiktok"] as const) {
    const uploads = report.uploads.filter((u) => u.platform === platform);

    // Kesimpulan Validator platform ini (Tahap 7a) — belum ada = slot placeholder.
    const conclusionRow = report.conclusions.find((c) => c.platform === platform);
    const conclusion = conclusionRow
      ? { points: conclusionRow.points, numbers: conclusionRow.numbers }
      : null;

    // Rekomendasi manual user (Fase A) — poin demi poin; tanpa poin = slide dilewati (null).
    const recoRow = report.recommendations.find((r) => r.platform === platform);
    const recommendation = recoRow && recoRow.points.length > 0 ? recoRow.points : null;

    // Blok dilewati HANYA kalau benar-benar kosong. Dulu cukup "tanpa foto" — akibatnya
    // kesimpulan & rekomendasi platform yang belum ada fotonya hilang dari deck tanpa
    // peringatan apa pun, padahal API menyimpannya dengan 200 (temuan audit Batch B).
    if (uploads.length === 0 && !conclusion && !recommendation) continue;

    // Section masuk PPT = yang punya upload; urut narrativeOrder (section non-aktif yang
    // masih punya upload tetap ikut, di belakang — perilaku groupBySection yang sama dgn UI).
    const sectionOrder = [...new Map(uploads.map((u) => [u.sectionId, u.section])).values()]
      .sort((a, b) => a.narrativeOrder - b.narrativeOrder)
      .map((s) => s.id);
    const groups = groupBySection(uploads, sectionOrder);

    const sections = [];
    for (const g of groups) {
      const photos: PptPhoto[] = [];
      let missingPhotos = 0;
      // Section perbandingan periode: foto PERIODE UTAMA selalu di ATAS, foto pembanding
      // (bukan utama) di bawah — konsisten di semua slide. Sort STABIL: isPrimaryPeriod
      // dulu, sisanya tetap urut input (createdAt). Section non-perbandingan TIDAK diubah
      // (semua isPrimaryPeriod=false + tanpa periodMonth → urutan input apa adanya).
      const isComparison = g.items.some((u) => u.periodMonth !== null);
      const items = isComparison
        ? [...g.items].sort((a, b) => Number(b.isPrimaryPeriod) - Number(a.isPrimaryPeriod))
        : g.items;
      for (let i = 0; i < items.length; i++) {
        const u = items[i];
        // Foto disematkan (embedded) supaya file mandiri — Prinsip #5: foto asli wajib tampil.
        // storage.read() melempar untuk gangguan NYATA (kredensial/jaringan/bucket) dan
        // hanya mengembalikan null kalau objeknya memang tidak ada. Gangguan tidak boleh
        // diperlakukan sebagai "foto belum diunggah": lebih baik gagal terang-terangan
        // daripada mengirim deck tanpa foto — dan status report TIDAK maju ke downloaded.
        let image;
        try {
          image = await storage.read(u.imageUrl);
        } catch {
          return NextResponse.json(
            {
              error:
                "Gagal membaca foto dari storage. Ini gangguan penyimpanan, bukan foto yang hilang — coba lagi sebentar lagi.",
            },
            { status: 502 }
          );
        }
        if (!image) {
          // Foto hilang di storage: catat & lanjut — report selalu selesai (Prinsip #3).
          missingPhotos++;
          continue;
        }
        photos.push({
          data: `${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`,
          bytes: image.bytes,
          contentType: image.contentType,
          sourceIndex: i + 1,
          // Bulan yang dipilih user (section perbandingan periode) jadi caption foto.
          periodLabel: u.periodMonth ? formatMonthID(u.periodMonth) : null,
        });
      }
      sections.push({
        name: g.items[0].section.name,
        insight: insightBySection.get(g.sectionId) ?? null,
        photos,
        multiSource: g.multiSource,
        missingPhotos,
      });
    }
    blocks.push({ platform, sections, conclusion, recommendation });
  }

  // Tema global aktif (Tahap 10): baris Theme pertama; belum ada -> default netral.
  // Logo dibaca dari storage — file hilang cukup dilewati, PPT tetap jadi (tanpa error).
  const themeRow = await prisma.theme.findFirst({ orderBy: { updatedAt: "asc" } });
  let theme: PptTheme = DEFAULT_PPT_THEME;
  if (themeRow) {
    let logo: PptTheme["logo"] = null;
    if (themeRow.logoKey) {
      const image = await storage.read(themeRow.logoKey);
      if (image) {
        logo = {
          data: `${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`,
          bytes: image.bytes,
          contentType: image.contentType,
        };
      }
    }
    theme = {
      primary: themeRow.primaryColor,
      secondary: themeRow.secondaryColor,
      accent: themeRow.accentColor,
      accentOverride: themeRow.accentOverride,
      accentShopee: themeRow.accentShopee,
      accentTiktok: themeRow.accentTiktok,
      headingFont: themeRow.headingFont,
      bodyFont: themeRow.bodyFont,
      logo,
      contacts: {
        email: themeRow.contactEmail,
        website: themeRow.contactWebsite,
        instagram: themeRow.contactInstagram,
      },
    };
  }

  // Slide Thank You berlatar primer. Logo tema dirancang untuk cover yang SELALU putih,
  // jadi tintanya gelap — di latar primer gelap logo itu praktis hilang. Siapkan varian
  // PUTIH (siluet: kanvas putih dimasking alpha logo) khusus slide itu.
  // Hanya untuk logo BER-ALPHA: logo tanpa transparansi (mis. JPEG) sudah punya latar
  // sendiri sehingga tetap terlihat — dimasking malah jadi kotak putih polos.
  // Gagal apa pun -> diam-diam pakai logo asli (Prinsip #3: report selalu selesai).
  if (theme.logo && isDarkColor(theme.primary)) {
    try {
      const src = Buffer.from(theme.logo.bytes);
      const meta = await sharp(src).metadata();
      if (meta.hasAlpha && meta.width && meta.height) {
        const whitePng = await sharp({
          create: {
            width: meta.width,
            height: meta.height,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          },
        })
          .composite([{ input: src, blend: "dest-in" }]) // putih dipotong alpha logo
          .png()
          .toBuffer();
        theme = {
          ...theme,
          logo: { ...theme.logo, dataOnDark: `image/png;base64,${whitePng.toString("base64")}` },
        };
      }
    } catch {
      // biarkan — slide penutup memakai logo asli
    }
  }

  // Periode report boleh belum ditentukan (Jul 2026, terisi dari deteksi bulan). Deck
  // tetap bisa dibuat — Prinsip #3: report selalu jalan sampai selesai, kekurangannya
  // ditandai, bukan menghentikan proses.
  const reportPeriodLabel = report.reportPeriod?.trim() || "Periode belum ditentukan";

  const buffer = await buildReportPptx(
    { reportPeriod: reportPeriodLabel, brandName: report.brandName, blocks },
    theme
  );

  // Audit P5: transisi status saat PPT PERTAMA kali diunduh (draft -> downloaded).
  // Hanya maju dari draft; tidak menimpa status lain. Efek samping pada GET disengaja
  // (unduh = tindakan eksplisit user).
  if (report.status === "draft") {
    await prisma.report.update({ where: { id: reportId }, data: { status: "downloaded" } });
  }

  // Nama file: fallback ASCII + filename* UTF-8 (periode bisa mengandung karakter non-ASCII).
  const baseName = report.brandName
    ? `Laporan Performa ${report.brandName} ${reportPeriodLabel}.pptx`
    : `Laporan Performa ${reportPeriodLabel}.pptx`;
  const asciiName = baseName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(baseName)}`,
      "Content-Length": String(buffer.length),
    },
  });
}
