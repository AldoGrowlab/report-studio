import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// Dua KB Validator per platform (Tahap 7a — DESIGN §Validator & Kesimpulan):
// kbGeneral = KB general/merangkai, kbConclusion = KB kesimpulan. Hanya founder.
// Boleh kosong — 7a membangun mesinnya, founder mengisi kapan saja.

// GET — KB kedua platform (baris yang belum pernah disimpan tampil kosong).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const rows = await prisma.validatorKb.findMany();
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));
  const kbs = (["shopee", "tiktok"] as const).map((platform) => {
    const row = byPlatform.get(platform);
    return {
      platform,
      kbGeneral: row?.kbGeneral ?? "",
      kbConclusion: row?.kbConclusion ?? "",
      updatedAt: row?.updatedAt ?? null,
    };
  });
  return NextResponse.json({ kbs });
}

// PUT — simpan KB satu platform (upsert). Body: { platform, kbGeneral, kbConclusion }.
export async function PUT(request: Request) {
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
  const b = body as Record<string, unknown> | null;
  const platform = b?.platform;
  if (platform !== "shopee" && platform !== "tiktok") {
    return NextResponse.json({ error: "platform wajib shopee/tiktok." }, { status: 400 });
  }
  const kbGeneral = typeof b?.kbGeneral === "string" ? b.kbGeneral : "";
  const kbConclusion = typeof b?.kbConclusion === "string" ? b.kbConclusion : "";

  const kb = await prisma.validatorKb.upsert({
    where: { platform },
    update: { kbGeneral, kbConclusion },
    create: { platform, kbGeneral, kbConclusion },
  });
  return NextResponse.json({ kb });
}
