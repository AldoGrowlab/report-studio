import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { parseSectionBody, computeSectionStatus } from "@/lib/sections";

// GET — daftar semua section + metrics (hanya founder)
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const sections = await prisma.section.findMany({
    include: { metrics: true },
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
  const { platform, name, narrativeOrder, kbAnalysis, metrics } = parsed.data;

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
        status,
        metrics: { create: metrics },
      },
      include: { metrics: true },
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
