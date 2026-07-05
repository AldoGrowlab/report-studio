import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { getStorage } from "@/lib/storage";

// GET — menyajikan gambar di balik auth.
// R2: redirect 307 ke presigned URL ber-TTL pendek.
// Disk lokal: streaming bytes langsung. Tanpa login = tidak ada akses.
export async function GET(_request: Request, ctx: RouteContext<"/api/uploads/[id]/image">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  const upload = await prisma.upload.findUnique({
    where: { id },
    include: { report: { select: { createdById: true } } },
  });
  if (!upload) {
    return NextResponse.json({ error: "Upload tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, upload.report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const served = await getStorage().serve(upload.imageUrl);
  if (!served) {
    return NextResponse.json({ error: "Gambar tidak ditemukan." }, { status: 404 });
  }

  if (served.kind === "redirect") {
    return NextResponse.redirect(served.url, 307);
  }

  // Salin ke ArrayBuffer konkret (hindari friksi tipe Uint8Array<ArrayBufferLike>).
  const b = served.bytes;
  const body = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": served.contentType,
      // Privat: jangan di-cache shared proxy; gambar di balik auth.
      "Cache-Control": "private, max-age=60",
    },
  });
}
