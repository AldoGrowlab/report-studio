import { NextResponse } from "next/server";
import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// POST — buat report draft (semua user login). Tahap 1: satu platform per report.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: { platform?: string; reportPeriod?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const platform = body.platform;
  if (platform !== "shopee" && platform !== "tiktok") {
    return NextResponse.json({ error: "Platform harus shopee atau tiktok." }, { status: 400 });
  }

  const reportPeriod = body.reportPeriod?.trim();
  if (!reportPeriod) {
    return NextResponse.json({ error: "Periode report wajib diisi." }, { status: 400 });
  }

  const report = await prisma.report.create({
    data: {
      reportPeriod,
      platforms: [platform as Platform],
      createdById: session.userId,
    },
    select: { id: true },
  });

  return NextResponse.json({ report }, { status: 201 });
}
