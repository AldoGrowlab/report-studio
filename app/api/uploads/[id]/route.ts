import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { getStorage } from "@/lib/storage";
import { isValidPeriodMonth } from "@/lib/period";

// PATCH — ubah penanda periode foto tersimpan (Tahap 6b, hanya section ber-perbandingan).
// Body: JSON { periodMonth? } dan/atau { isPrimaryPeriod: true }. Menandai utama baru
// meng-unset utama lama (report, section) itu — maks SATU utama, ditegakkan server.
export async function PATCH(request: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  const upload = await prisma.upload.findUnique({
    where: { id },
    include: {
      report: { select: { createdById: true } },
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

  const data: { periodMonth?: string; isPrimaryPeriod?: boolean } = {};
  if (b?.periodMonth !== undefined) {
    if (typeof b.periodMonth !== "string" || !isValidPeriodMonth(b.periodMonth)) {
      return NextResponse.json({ error: "Bulan tidak valid." }, { status: 400 });
    }
    data.periodMonth = b.periodMonth;
  }
  if (b?.isPrimaryPeriod === true) {
    data.isPrimaryPeriod = true;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Tidak ada yang diubah." }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (data.isPrimaryPeriod) {
      await tx.upload.updateMany({
        where: {
          reportId: upload.reportId,
          sectionId: upload.sectionId,
          isPrimaryPeriod: true,
          NOT: { id },
        },
        data: { isPrimaryPeriod: false },
      });
    }
    return tx.upload.update({ where: { id }, data });
  });

  return NextResponse.json({
    upload: {
      id: updated.id,
      periodMonth: updated.periodMonth,
      isPrimaryPeriod: updated.isPrimaryPeriod,
    },
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
