import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseSectionBody, computeSectionStatus } from "@/lib/sections";
import { buildMetricCatalog } from "@/lib/derived-catalog";
import { validateDerivedMetrics } from "@/lib/derived";
import { toDerivedRow } from "@/lib/derived-row";

// PUT — edit section + ganti seluruh metrics (hanya founder)
export async function PUT(request: Request, ctx: RouteContext<"/api/sections/[id]">) {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const parsed = parseSectionBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { platform, name, narrativeOrder, kbAnalysis, usesPeriodComparison, metrics, subGroups, derivedMetrics } =
    parsed.data;

  // FAIL FAST (Fase 2): ref yang menunjuk section/sub-grup/metrik yang tidak ada DITOLAK
  // di sini, dengan pesan menyebut ref-nya. Menyimpannya dulu lalu "menunggu operan"
  // selamanya adalah kegagalan senyap — persis yang dilarang Prinsip #1.
  //
  // Katalog dibangun dari KB TERKINI ditambah metrik section yang sedang disimpan ini,
  // supaya definisi yang menunjuk metriknya sendiri tetap sah pada simpan pertama.
  if (derivedMetrics.length > 0) {
    const catalog = [
      ...(await buildMetricCatalog()).filter(
        (e) => !(e.platform === platform && e.section === name)
      ),
      ...metrics.map((m) => ({
        platform,
        section: name,
        subGroupKey: m.subGroupKey,
        metricKey: m.key,
        isText: m.type === "text",
      })),
    ];
    const errors = validateDerivedMetrics(derivedMetrics, catalog, platform);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
    }
  }

  const status = computeSectionStatus({
    name,
    kbAnalysis,
    metricsCount: metrics.length,
  });

  const existing = await prisma.section.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Section tidak ditemukan." }, { status: 404 });
  }

  try {
    // Transaksi: perbarui section, lalu ganti total metrics-nya.
    const section = await prisma.$transaction(async (tx) => {
      await tx.section.update({
        where: { id },
        data: { platform, name, narrativeOrder, kbAnalysis, usesPeriodComparison, status },
      });
      // Metrik & sub-grup diganti TOTAL (pola lama). Upload menyimpan subGroupKey sebagai
      // string, bukan FK, jadi foto lama tidak ikut terhapus saat founder menata ulang KB —
      // sama persis seperti perlakuan Extraction terhadap metrik yang dihapus.
      await tx.sectionMetric.deleteMany({ where: { sectionId: id } });
      await tx.sectionSubGroup.deleteMany({ where: { sectionId: id } });
      await tx.derivedMetric.deleteMany({ where: { sectionId: id } });
      if (subGroups.length > 0) {
        await tx.sectionSubGroup.createMany({
          data: subGroups.map((g) => ({ ...g, sectionId: id })),
        });
      }
      if (metrics.length > 0) {
        await tx.sectionMetric.createMany({
          data: metrics.map((m) => ({ ...m, sectionId: id })),
        });
      }
      if (derivedMetrics.length > 0) {
        await tx.derivedMetric.createMany({
          data: derivedMetrics.map((d) => ({ ...toDerivedRow(d), sectionId: id })),
        });
      }
      return tx.section.findUnique({
        where: { id },
        include: {
          metrics: true,
          subGroups: { orderBy: { order: "asc" } },
          derived: { orderBy: { order: "asc" } },
        },
      });
    });
    return NextResponse.json({ section });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "Nama section sudah dipakai di platform ini." },
        { status: 409 }
      );
    }
    throw e;
  }
}

// DELETE — hapus section (metrics ikut terhapus via onDelete: Cascade)
export async function DELETE(_request: Request, ctx: RouteContext<"/api/sections/[id]">) {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  // Audit P4: pre-check foto yang masih menunjuk section ini. Relasi Upload->Section
  // ON DELETE RESTRICT (Postgres 23001) di-surface Prisma sebagai UnknownRequestError,
  // BUKAN P2003 — jadi mengandalkan kode error rapuh. Pre-check count = 409 deterministik,
  // pesan jelas supaya founder hapus fotonya dulu (dulu lolos jadi 500 gundul).
  const uploadCount = await prisma.upload.count({ where: { sectionId: id } });
  if (uploadCount > 0) {
    return NextResponse.json(
      {
        error: `Section ini masih dipakai ${uploadCount} foto di report. Hapus/pindahkan foto itu dulu sebelum menghapus section.`,
      },
      { status: 409 }
    );
  }

  try {
    await prisma.section.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "Section tidak ditemukan." }, { status: 404 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}
