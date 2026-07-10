import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isSafeFont, normalizeHexColor } from "@/lib/theme";

// Tahap 10 — tema global (hanya founder): SATU baris Theme = tema aktif untuk semua
// report saat generate PPT. Belum ada baris → GET mengembalikan default dari skema.

async function getOrCreateTheme() {
  const existing = await prisma.theme.findFirst({ orderBy: { updatedAt: "asc" } });
  if (existing) return existing;
  return prisma.theme.create({ data: {} }); // semua kolom punya default
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const theme = await getOrCreateTheme();
  return NextResponse.json({ theme });
}

// PUT — simpan tema. Body JSON: warna (hex, "#" opsional), font (dari daftar aman),
// accentOverride + aksen per platform. logoKey TIDAK lewat sini (route /api/theme/logo).
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

  const colors: Record<string, string> = {};
  for (const field of [
    "primaryColor",
    "secondaryColor",
    "accentColor",
    "accentShopee",
    "accentTiktok",
  ] as const) {
    const raw = b?.[field];
    if (typeof raw !== "string") {
      return NextResponse.json({ error: `${field} wajib diisi.` }, { status: 400 });
    }
    const hex = normalizeHexColor(raw);
    if (!hex) {
      return NextResponse.json(
        { error: `${field} harus warna hex 6 digit (mis. #2563EB).` },
        { status: 400 }
      );
    }
    colors[field] = hex;
  }

  const headingFont = b?.headingFont;
  const bodyFont = b?.bodyFont;
  if (typeof headingFont !== "string" || !isSafeFont(headingFont)) {
    return NextResponse.json({ error: "Font judul tidak ada di daftar aman." }, { status: 400 });
  }
  if (typeof bodyFont !== "string" || !isSafeFont(bodyFont)) {
    return NextResponse.json({ error: "Font body tidak ada di daftar aman." }, { status: 400 });
  }

  const current = await getOrCreateTheme();
  const theme = await prisma.theme.update({
    where: { id: current.id },
    data: {
      ...colors,
      headingFont,
      bodyFont,
      accentOverride: Boolean(b?.accentOverride),
    },
  });
  return NextResponse.json({ theme });
}
