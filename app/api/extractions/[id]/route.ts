import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import {
  parseExtractionEdit,
  computeEditedFields,
  parseTextExtractionEdit,
  computeEditedTextFields,
} from "@/lib/extractions";
import { recomputeDerivedMetrics } from "@/lib/derived-compute";

// PATCH — konfirmasi/koreksi manual satu hasil ekstraksi (Tahap 5).
// Body: { value: number | null } untuk metrik ANGKA — rawText & confidence asli tidak
// disentuh (provenance OCR). Body: { rawText: string | null } untuk metrik TEKS, di mana
// nilainya memang tinggal di rawText sehingga kolom itu yang ditimpa (value dipaksa null).
// Bentuk body ditentukan TIPE metriknya di server, bukan oleh client — client tidak bisa
// menyelundupkan teks ke metrik angka atau sebaliknya.
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

  // Tipe metrik menentukan kontrak body. Metrik yang sudah dihapus dari section tapi
  // angkanya masih tersimpan jatuh ke jalur angka — apa adanya, seperti sebelumnya.
  const metric = await prisma.sectionMetric.findFirst({
    where: { sectionId: extraction.upload.sectionId, key: extraction.key },
    select: { type: true },
  });

  let data;
  if (metric?.type === "text") {
    const parsed = parseTextExtractionEdit(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    data = computeEditedTextFields(parsed.data.text);
  } else {
    const parsed = parseExtractionEdit(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    data = computeEditedFields(parsed.data.value);
  }

  const updated = await prisma.extraction.update({ where: { id }, data });

  // Koreksi manual mengubah operan -> metrik turunan ikut dihitung ulang (Fase 2b),
  // supaya kontribusi tak pernah tertinggal di angka lama.
  try {
    await recomputeDerivedMetrics(extraction.upload.reportId);
  } catch {
    /* diamkan — koreksi manual sudah aman tersimpan */
  }

  return NextResponse.json({ extraction: updated });
}
