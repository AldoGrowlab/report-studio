import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// GET — SEMUA flag lintas report, apa pun jenisnya (Tahap 9, hanya founder).
// Dashboard flag = alat perbaikan KB (DESIGN §Sistem Flag): respons datar + report asal;
// pengelompokan per (platform, section) dihitung client (lib/flags-view.ts).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const flags = await prisma.flag.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      platform: true,
      section: true,
      type: true,
      severity: true,
      note: true,
      createdAt: true,
      report: { select: { id: true, reportPeriod: true } },
    },
  });

  return NextResponse.json({ flags });
}
