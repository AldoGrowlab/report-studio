import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport, MAX_UPLOAD_BYTES } from "@/lib/reports";
import { getStorage, isAllowedImageType, buildImageKey } from "@/lib/storage";
import { isValidPeriodMonth, formatMonthID } from "@/lib/period";

// POST — upload satu screenshot + label section (satu foto satu label).
// Body: multipart/form-data { file, sectionId, periodMonth?, isPrimaryPeriod? }
// periodMonth ("YYYY-MM") WAJIB untuk section ber-perbandingan-periode (Tahap 6b);
// untuk section biasa diabaikan (null/false). isPrimaryPeriod: maks SATU per
// (report, section) — menandai utama baru meng-unset yang lama (transaksi).
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

  // Tahap 6b — penanda periode, HANYA berlaku untuk section ber-perbandingan.
  let periodMonth: string | null = null;
  let isPrimaryPeriod = false;
  if (section.usesPeriodComparison) {
    const rawMonth = form.get("periodMonth");
    if (typeof rawMonth !== "string" || !isValidPeriodMonth(rawMonth)) {
      return NextResponse.json(
        { error: "Section ini pakai perbandingan periode — pilih bulan untuk foto ini." },
        { status: 400 }
      );
    }
    periodMonth = rawMonth;
    isPrimaryPeriod = form.get("isPrimaryPeriod") === "true";

    // Satu bulan = SATU foto per (report, section) — perbandingan berantai butuh tepat
    // satu nilai per metrik per bulan (Tahap 6b-B; tanpa ini persen jadi ambigu).
    const duplicate = await prisma.upload.findFirst({
      where: { reportId, sectionId: section.id, periodMonth },
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
  await getStorage().put(key, bytes, file.type);

  const upload = await prisma.$transaction(async (tx) => {
    if (isPrimaryPeriod) {
      // Satu utama per (report, section): utama baru meng-unset yang lama.
      await tx.upload.updateMany({
        where: { reportId, sectionId: section.id, isPrimaryPeriod: true },
        data: { isPrimaryPeriod: false },
      });
    }
    return tx.upload.create({
      data: {
        reportId,
        reportPeriod: report.reportPeriod,
        platform: section.platform,
        sectionId: section.id,
        imageUrl: key,
        labelConfirmed: true,
        periodMonth,
        isPrimaryPeriod,
      },
      include: { section: { select: { id: true, name: true } } },
    });
  });

  return NextResponse.json({ upload }, { status: 201 });
}
