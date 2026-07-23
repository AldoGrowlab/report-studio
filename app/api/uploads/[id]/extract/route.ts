import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { getStorage } from "@/lib/storage";
import { extractMetrics, type ExpectedMetric } from "@/lib/extractor";
import { isDefaultSubGroup } from "@/lib/subgroups";
import { recomputeDerivedMetrics } from "@/lib/derived-compute";
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
      section: {
        select: {
          name: true,
          platform: true,
          metrics: true,
          subGroups: { select: { key: true, label: true } },
        },
      },
    },
  });
  if (!upload) {
    return NextResponse.json({ error: "Upload tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, upload.report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  // Fase 1 — ekstraksi ber-scope: satu foto hanya membawa metrik MILIK SUB-GRUPNYA.
  // Mengirim daftar campuran ke model berarti ia diminta mencari metrik yang memang tak
  // ada di gambar itu — hasilnya missing palsu, atau lebih buruk, angka tool lain
  // ditempelkan ke sini.
  const subGroups = upload.section.subGroups;
  if (subGroups.length > 0 && isDefaultSubGroup(upload.subGroupKey)) {
    return NextResponse.json(
      {
        error: `Foto ini belum punya sub-grup. Pilih sub-grup dulu (${subGroups
          .map((g) => g.label)
          .join(", ")}) sebelum mengekstrak.`,
      },
      { status: 400 }
    );
  }
  const metrics: ExpectedMetric[] = upload.section.metrics
    .filter((m) => m.subGroupKey === upload.subGroupKey)
    .map((m) => ({ key: m.key, label: m.label, type: m.type }));
  if (metrics.length === 0) {
    return NextResponse.json(
      {
        error:
          subGroups.length > 0
            ? "Sub-grup foto ini tidak punya expected metrics di KB."
            : "Section tidak punya expected metrics.",
      },
      { status: 400 }
    );
  }

  const image = await getStorage().read(upload.imageUrl);
  if (!image) {
    return NextResponse.json({ error: "Gambar tidak ditemukan di storage." }, { status: 404 });
  }

  let outcome;
  try {
    // Nama section yang dikirim ke model ikut menyebut sub-grupnya, supaya ia tahu tab
    // mana yang sedang dibaca (mis. "Promotion Tools — Voucher").
    const subLabel = subGroups.find((g) => g.key === upload.subGroupKey)?.label;
    outcome = await extractMetrics(metrics, image, {
      sectionName: subLabel ? `${upload.section.name} — ${subLabel}` : upload.section.name,
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

  // Angka operan berubah -> metrik turunan dihitung ulang (Fase 2b). Ditulis-ulang total,
  // jadi tak ada duplikat. Gagal di sini TIDAK boleh menggagalkan ekstraksi yang sudah
  // tersimpan (Prinsip #3) — hitung-ulang berikutnya akan memperbaikinya.
  try {
    await recomputeDerivedMetrics(upload.report.id);
  } catch {
    /* diamkan — angka ekstraksi sudah aman tersimpan */
  }

  // TIPE tiap metrik ikut dikirim: tabel koreksi memakainya untuk memilih cara tampil &
  // cara edit (durasi manusiawi, teks sebagai teks). Tanpa ini state client kehilangan
  // `type` begitu hasil ekstraksi diganti dari respons ini.
  // DI-SCOPE ke sub-grup foto: "penjualan" bisa ada di tiga sub-grup dengan tipe berbeda,
  // dan peta tak ber-scope diam-diam menyimpan yang terakhir menang.
  const typeByKey = new Map(
    upload.section.metrics
      .filter((m) => m.subGroupKey === upload.subGroupKey)
      .map((m) => [m.key, m.type])
  );

  return NextResponse.json({
    extractor: outcome.extractor,
    extractions: extractions.map((e) => ({ ...e, type: typeByKey.get(e.key) ?? "number" })),
    detectedPeriod: { rawText: rawPeriod, month: detectedMonth },
    reportPeriod,
    periodDetected,
    periodMismatch,
  });
}
