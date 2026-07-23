import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { getStorage } from "@/lib/storage";
import { extractMetrics, type ExpectedMetric } from "@/lib/extractor";
import { parsePeriodText, toPeriodMonth } from "@/lib/period-parser";
import { formatMonthID } from "@/lib/period";

// POST — ekstrak angka dari satu upload, dipandu expected_metrics section-nya.
// Mengganti seluruh Extraction lama upload itu (idempoten / bisa re-run).
export async function POST(_request: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  const upload = await prisma.upload.findUnique({
    where: { id },
    include: {
      report: { select: { id: true, createdById: true, reportPeriod: true, periodDetected: true } },
      section: { select: { name: true, platform: true, metrics: true } },
    },
  });
  if (!upload) {
    return NextResponse.json({ error: "Upload tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, upload.report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const metrics: ExpectedMetric[] = upload.section.metrics.map((m) => ({
    key: m.key,
    label: m.label,
    type: m.type,
  }));
  if (metrics.length === 0) {
    return NextResponse.json(
      { error: "Section tidak punya expected metrics." },
      { status: 400 }
    );
  }

  const image = await getStorage().read(upload.imageUrl);
  if (!image) {
    return NextResponse.json({ error: "Gambar tidak ditemukan di storage." }, { status: 404 });
  }

  let outcome;
  try {
    outcome = await extractMetrics(metrics, image, {
      sectionName: upload.section.name,
      platform: upload.section.platform,
    });
  } catch {
    return NextResponse.json(
      { error: "Ekstraksi gagal. Coba lagi." },
      { status: 502 }
    );
  }

  // Ganti Extraction lama, tulis hasil baru dalam satu transaksi.
  const extractions = await prisma.$transaction(async (tx) => {
    await tx.extraction.deleteMany({ where: { uploadId: id } });
    await tx.extraction.createMany({
      data: outcome.results.map((r) => ({
        uploadId: id,
        key: r.key,
        value: r.value,
        rawText: r.rawText,
        confidence: r.confidence,
        status: r.status,
      })),
    });
    return tx.extraction.findMany({ where: { uploadId: id }, orderBy: { key: "asc" } });
  });

  // ---- Deteksi Bulan Otomatis (Jul 2026) — JALUR PEMBANDING ----
  // Ini jalur KEDUA. Pengisi label bulan adalah /api/period-detect yang jalan lebih awal
  // (saat foto dipilih); yang di sini menumpang panggilan ekstraksi yang memang sudah ada,
  // jadi GRATIS, dan tugas utamanya menjadi PEMERIKSAAN salah-bulan. Mengisi bulan report
  // hanya sebagai jaring pengaman kalau jalur pertama gagal dan nilainya masih kosong.
  // Teks periode disalin model; pemetaan ke bulan DETERMINISTIK di kode. Parser null =
  // tidak ada yang bisa dipastikan -> tidak mengisi apa pun, tidak memperingatkan apa pun.
  const rawPeriod = outcome.detectedPeriodRaw;
  const parsed = parsePeriodText(rawPeriod);
  const detectedMonth = parsed ? toPeriodMonth(parsed) : null;

  await prisma.upload.update({
    where: { id },
    data: { detectedPeriodRaw: rawPeriod, detectedPeriodMonth: detectedMonth },
  });

  // Flag periode = keadaan ekstraksi TERAKHIR foto ini: yang lama dibuang lebih dulu supaya
  // peringatan tidak menumpuk tiap kali operator menekan "Ekstrak ulang".
  await prisma.flag.deleteMany({
    where: {
      reportId: upload.report.id,
      platform: upload.section.platform,
      section: upload.section.name,
      type: "periode",
    },
  });

  let reportPeriod = upload.report.reportPeriod;
  let periodDetected = upload.report.periodDetected;
  let periodMismatch: string | null = null;

  if (parsed) {
    const detectedLabel = formatMonthID(detectedMonth as string);
    const currentPeriod = upload.report.reportPeriod?.trim() ?? "";
    if (currentPeriod === "") {
      // (a) Bulan report masih kosong -> isi, tandai sumbernya "detected" (badge di UI).
      const updated = await prisma.report.update({
        where: { id: upload.report.id },
        data: { reportPeriod: detectedLabel, periodDetected: true },
        select: { reportPeriod: true, periodDetected: true },
      });
      reportPeriod = updated.reportPeriod;
      periodDetected = updated.periodDetected;
    } else {
      // (b) Bulan report sudah ada -> jadi PEMERIKSAAN. Pembandingnya harus sama-sama bisa
      // dipetakan: label kustom yang tak terbaca parser ("Q2 2026") TIDAK diprotes.
      const current = parsePeriodText(currentPeriod);
      if (current && (current.month !== parsed.month || current.year !== parsed.year)) {
        periodMismatch =
          `Periode pada foto terbaca ${rawPeriod} (=${detectedLabel}), berbeda dengan ` +
          `bulan report (${formatMonthID(toPeriodMonth(current))}). ` +
          `Periksa apakah screenshot salah bulan.`;
        await prisma.flag.create({
          data: {
            reportId: upload.report.id,
            platform: upload.section.platform,
            section: upload.section.name,
            type: "periode",
            // Menyentuh PRESISI, bukan sekadar rasa narasi: screenshot bulan yang salah
            // membuat seluruh angka report salah (DESIGN §Sistem Flag).
            severity: "tinggi",
            note: periodMismatch,
          },
        });
      }
    }
  }

  // TIPE tiap metrik ikut dikirim: tabel koreksi memakainya untuk memilih cara tampil &
  // cara edit (durasi manusiawi, teks sebagai teks). Tanpa ini state client kehilangan
  // `type` begitu hasil ekstraksi diganti dari respons ini.
  const typeByKey = new Map(upload.section.metrics.map((m) => [m.key, m.type]));

  return NextResponse.json({
    extractor: outcome.extractor,
    extractions: extractions.map((e) => ({ ...e, type: typeByKey.get(e.key) ?? "number" })),
    detectedPeriod: { rawText: rawPeriod, month: detectedMonth },
    reportPeriod,
    periodDetected,
    periodMismatch,
  });
}
