import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { getStorage } from "@/lib/storage";
import { isValidPeriodMonth, formatMonthID } from "@/lib/period";
import { periodMonthOptions } from "@/lib/report-period";

// PATCH — ubah BULAN foto tersimpan (Poin 2, hanya section ber-perbandingan).
// Body: JSON { periodMonth }. Bulan WAJIB salah satu pasangan report (periode utama /
// pembanding). Status "periode utama" TIDAK lagi diubah per foto — ia turunan dari pasangan
// report (bulanFoto == periodeUtama), jadi tombol "Jadikan utama" dihapus.
export async function PATCH(request: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  const upload = await prisma.upload.findUnique({
    where: { id },
    include: {
      report: { select: { createdById: true, periodeUtama: true, periodePembanding: true } },
      section: { select: { usesPeriodComparison: true } },
    },
  });
  if (!upload) {
    return NextResponse.json({ error: "Upload tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, upload.report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  if (!upload.section.usesPeriodComparison) {
    return NextResponse.json(
      { error: "Section foto ini tidak pakai perbandingan periode." },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  const b = body as Record<string, unknown> | null;

  if (b?.periodMonth === undefined) {
    return NextResponse.json({ error: "Tidak ada yang diubah." }, { status: 400 });
  }
  const options = periodMonthOptions({
    periodeUtama: upload.report.periodeUtama,
    periodePembanding: upload.report.periodePembanding,
  });
  if (typeof b.periodMonth !== "string" || !isValidPeriodMonth(b.periodMonth) || !options.includes(b.periodMonth)) {
    return NextResponse.json(
      {
        error: `Bulan foto harus salah satu periode report: ${options
          .map((m) => formatMonthID(m))
          .join(" atau ")}.`,
      },
      { status: 400 }
    );
  }

  // Satu bulan = SATU foto per (report, section, SUB-GRUP) — tolak pindah ke bulan yang
  // sudah dipakai foto lain di scope yang sama (syarat perbandingan berantai).
  const duplicate = await prisma.upload.findFirst({
    where: {
      reportId: upload.reportId,
      sectionId: upload.sectionId,
      subGroupKey: upload.subGroupKey,
      periodMonth: b.periodMonth,
      NOT: { id },
    },
  });
  if (duplicate) {
    return NextResponse.json(
      {
        error: `Bulan ${formatMonthID(b.periodMonth)} sudah dipakai foto lain di section ini — satu bulan satu foto.`,
      },
      { status: 400 }
    );
  }

  const updated = await prisma.upload.update({
    where: { id },
    data: { periodMonth: b.periodMonth },
  });

  return NextResponse.json({
    upload: { id: updated.id, periodMonth: updated.periodMonth },
  });
}

// DELETE — hapus satu upload (untuk benerin salah label / salah foto).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  const upload = await prisma.upload.findUnique({
    where: { id },
    include: { report: { select: { createdById: true } } },
  });
  if (!upload) {
    return NextResponse.json({ error: "Upload tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, upload.report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  // Hapus file di storage dulu (kalau gagal, jangan hapus baris DB).
  await getStorage().delete(upload.imageUrl);
  await prisma.upload.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
