import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseSectionBody, computeSectionStatus } from "@/lib/sections";
import { buildMetricCatalog } from "@/lib/derived-catalog";
import { validateDerivedMetrics } from "@/lib/derived";
import { toDerivedRow } from "@/lib/derived-row";

// GET — daftar semua section + metrics (hanya founder)
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const sections = await prisma.section.findMany({
    include: {
      metrics: true,
      subGroups: { orderBy: { order: "asc" } },
      derived: { orderBy: { order: "asc" } },
    },
    orderBy: [{ platform: "asc" }, { narrativeOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ sections });
}

// POST — buat section baru + metrics (hanya founder)
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

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

  try {
    const section = await prisma.section.create({
      data: {
        platform,
        name,
        narrativeOrder,
        kbAnalysis,
        usesPeriodComparison,
        status,
        metrics: { create: metrics },
        subGroups: { create: subGroups },
        derived: { create: derivedMetrics.map(toDerivedRow) },
      },
      include: {
        metrics: true,
        subGroups: { orderBy: { order: "asc" } },
        derived: { orderBy: { order: "asc" } },
      },
    });
    return NextResponse.json({ section }, { status: 201 });
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
