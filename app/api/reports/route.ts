import { NextResponse } from "next/server";
import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// POST — buat report draft (semua user login). Satu report boleh mencakup SATU atau DUA
// platform (Jul 2026): Report.platforms memang array sejak awal, dan seluruh alur hilir
// (section, kesimpulan, rekomendasi, PPT) sudah per-platform.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: { platforms?: unknown; reportPeriod?: string; brandName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  // Urutan disimpan kanonik Shopee -> TikTok (DESIGN §Platform) supaya badge, tab, dan
  // urutan blok PPT konsisten apa pun urutan centang user.
  const requested = Array.isArray(body.platforms) ? body.platforms : [];
  const platforms = (["shopee", "tiktok"] as const).filter((p) => requested.includes(p));
  if (platforms.length === 0) {
    return NextResponse.json(
      { error: "Pilih minimal satu platform (Shopee dan/atau TikTok)." },
      { status: 400 }
    );
  }

  const brandName = body.brandName?.trim();
  if (!brandName) {
    return NextResponse.json({ error: "Nama brand wajib diisi." }, { status: 400 });
  }

  const reportPeriod = body.reportPeriod?.trim();
  if (!reportPeriod) {
    return NextResponse.json({ error: "Periode report wajib diisi." }, { status: 400 });
  }

  const report = await prisma.report.create({
    data: {
      brandName,
      reportPeriod,
      platforms: platforms as Platform[],
      createdById: session.userId,
    },
    select: { id: true },
  });

  return NextResponse.json({ report }, { status: 201 });
}
