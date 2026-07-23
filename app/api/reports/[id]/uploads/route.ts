import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { imageSizePx } from "@/lib/image-size";
import { getSession } from "@/lib/session";
import { canAccessReport, MAX_UPLOAD_BYTES } from "@/lib/reports";
import { getStorage, isAllowedImageType, buildImageKey } from "@/lib/storage";
import { isValidPeriodMonth, formatMonthID } from "@/lib/period";
import { periodMonthOptions } from "@/lib/report-period";
import { DEFAULT_SUB_GROUP_KEY } from "@/lib/subgroups";

// POST — upload satu screenshot + label section (satu foto satu label).
// Body: multipart/form-data { file, sectionId, subGroupKey?, periodMonth? }
// subGroupKey WAJIB untuk section ber-sub-grup (Fase 1); untuk section biasa diabaikan
// (jatuh ke sentinel "_default").
// periodMonth ("YYYY-MM") WAJIB untuk section ber-perbandingan-periode, dan HARUS salah
// satu pasangan bulan report (Poin 2). Status "periode utama" tak lagi dikirim/disimpan
// per foto — ia turunan dari pasangan report.
export async function POST(request: Request, ctx: RouteContext<"/api/reports/[id]/uploads">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id: reportId } = await ctx.params;

  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) {
    return NextResponse.json({ error: "Report tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const file = form.get("file");
  const sectionId = form.get("sectionId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File gambar wajib diunggah." }, { status: 400 });
  }
  if (typeof sectionId !== "string" || !sectionId) {
    return NextResponse.json({ error: "Label section wajib dipilih." }, { status: 400 });
  }
  if (!isAllowedImageType(file.type)) {
    return NextResponse.json(
      { error: "Format harus PNG, JPG, WEBP, atau GIF." },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File kosong." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Ukuran file maksimal 10 MB." }, { status: 400 });
  }

  // Label hanya boleh ke section AKTIF dan se-platform dengan report.
  const section = await prisma.section.findUnique({ where: { id: sectionId } });
  if (!section) {
    return NextResponse.json({ error: "Section tidak ditemukan." }, { status: 400 });
  }
  if (section.status !== "active") {
    return NextResponse.json({ error: "Section belum aktif." }, { status: 400 });
  }
  if (!report.platforms.includes(section.platform)) {
    return NextResponse.json(
      { error: "Section tidak sesuai platform report." },
      { status: 400 }
    );
  }

  // Fase 1 — sub-grup foto. Section ber-sub-grup WAJIB dilabeli: tanpa itu ekstraksi tak
  // tahu daftar metrik mana yang berlaku, dan angkanya bisa masuk tool yang salah.
  const subGroups = await prisma.sectionSubGroup.findMany({
    where: { sectionId: section.id },
    select: { key: true, label: true },
  });
  let subGroupKey = DEFAULT_SUB_GROUP_KEY;
  if (subGroups.length > 0) {
    const raw = form.get("subGroupKey");
    if (typeof raw !== "string" || !subGroups.some((g) => g.key === raw)) {
      return NextResponse.json(
        {
          error: `Section ini punya sub-grup (${subGroups.map((g) => g.label).join(", ")}) — pilih sub-grup untuk foto ini.`,
        },
        { status: 400 }
      );
    }
    subGroupKey = raw;
  }

  // Poin 2 — penanda periode, HANYA untuk section ber-perbandingan. Bulan foto WAJIB salah
  // satu dari pasangan report (periode utama / pembanding); status "periode utama" tak lagi
  // dipilih per foto, ia turunan dari bulan yang cocok periode utama report.
  const pair = { periodeUtama: report.periodeUtama, periodePembanding: report.periodePembanding };
  let periodMonth: string | null = null;
  if (section.usesPeriodComparison) {
    const options = periodMonthOptions(pair);
    if (options.length === 0) {
      return NextResponse.json(
        {
          error:
            "Report ini belum menetapkan pasangan bulan (periode utama & pembanding). Atur periode report dulu sebelum mengunggah foto perbandingan.",
        },
        { status: 400 }
      );
    }
    const rawMonth = form.get("periodMonth");
    if (typeof rawMonth !== "string" || !isValidPeriodMonth(rawMonth) || !options.includes(rawMonth)) {
      return NextResponse.json(
        {
          error: `Bulan foto harus salah satu periode report: ${options
            .map((m) => formatMonthID(m))
            .join(" atau ")}.`,
        },
        { status: 400 }
      );
    }
    periodMonth = rawMonth;

    // Satu bulan = SATU foto per (report, section, SUB-GRUP) — perbandingan berantai butuh
    // tepat satu nilai per metrik per bulan (Tahap 6b-B; tanpa ini persen jadi ambigu).
    // Flash Sale Juni dan Voucher Juni adalah dua foto SAH, jadi scope-nya ikut sub-grup.
    const duplicate = await prisma.upload.findFirst({
      where: { reportId, sectionId: section.id, subGroupKey, periodMonth },
    });
    if (duplicate) {
      return NextResponse.json(
        {
          error: `Bulan ${formatMonthID(periodMonth)} sudah ada fotonya di section ini — satu bulan satu foto.`,
        },
        { status: 400 }
      );
    }
  }

  // Simpan file ke storage (R2 atau disk lokal), lalu catat ke tabel Upload.
  const key = buildImageKey(reportId, file.type);
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Verifikasi ISI file, bukan cuma Content-Type kiriman client (yang dikendalikan
  // sepenuhnya oleh pengirim). Tanpa ini, file teks/PDF ber-"type=image/png" diterima 201
  // lalu tertanam ke deck sebagai .png rusak tanpa error di titik mana pun — terbukti di
  // uji E2E. imageSizePx membaca magic bytes dan mengembalikan null bila header tidak
  // cocok dengan tipe yang diklaim.
  if (imageSizePx(bytes, file.type) === null) {
    return NextResponse.json(
      { error: "File ini bukan gambar yang valid. Unggah screenshot asli (PNG/JPG/WEBP/GIF)." },
      { status: 400 }
    );
  }
  await getStorage().put(key, bytes, file.type);

  let upload;
  try {
    // Tak ada lagi unset "periode utama" per foto — status utama turunan dari pasangan
    // report, jadi menandai satu foto tidak memengaruhi foto lain.
    upload = await prisma.upload.create({
      data: {
        reportId,
        platform: section.platform,
        sectionId: section.id,
        imageUrl: key,
        labelConfirmed: true,
        periodMonth,
        subGroupKey,
      },
      include: { section: { select: { id: true, name: true } } },
    });
  } catch (e) {
    // Audit M7: unique (report, section, periodMonth) menangkap race dua upload bulan
    // sama yang lolos pre-check. Bersihkan file yang sudah terunggah, beri pesan sama.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await getStorage().delete(key);
      return NextResponse.json(
        {
          error: `Bulan ${periodMonth ? formatMonthID(periodMonth) : ""} sudah ada fotonya di section ini — satu bulan satu foto.`,
        },
        { status: 400 }
      );
    }
    throw e;
  }

  return NextResponse.json({ upload }, { status: 201 });
}
