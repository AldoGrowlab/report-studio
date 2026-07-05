import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { parseExtractionEdit, computeEditedFields } from "@/lib/extractions";

// PATCH — konfirmasi/koreksi manual satu angka ekstraksi (Tahap 5).
// Body: { value: number | null }. Hasil edit PERSIST ke Extraction (sumber kebenaran);
// rawText & confidence asli tidak disentuh.
export async function PATCH(request: Request, ctx: RouteContext<"/api/extractions/[id]">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  const extraction = await prisma.extraction.findUnique({
    where: { id },
    include: { upload: { include: { report: { select: { createdById: true } } } } },
  });
  if (!extraction) {
    return NextResponse.json({ error: "Extraction tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, extraction.upload.report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const parsed = parseExtractionEdit(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const updated = await prisma.extraction.update({
    where: { id },
    data: computeEditedFields(parsed.data.value),
  });

  return NextResponse.json({ extraction: updated });
}
