import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { getStorage } from "@/lib/storage";

// DELETE — hapus report beserta seluruh isinya (Jul 2026). Founder & operator (Model B).
// WAJIB (DESIGN §Backlog): hapus file storage semua upload DULU — cascade DB tidak
// menyentuh R2/disk. Baru setelah itu hapus baris report (cascade menghapus uploads,
// extractions, insights, conclusions, recommendations, flags, insightRevisions).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  const report = await prisma.report.findUnique({
    where: { id },
    include: { uploads: { select: { imageUrl: true } } },
  });
  if (!report) {
    return NextResponse.json({ error: "Report tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  // Hapus file storage tiap upload dulu (gagal hapus satu file tak menghentikan proses —
  // report tetap terhapus; file yatim jauh lebih ringan daripada baris DB yatim).
  const storage = getStorage();
  for (const u of report.uploads) {
    await storage.delete(u.imageUrl).catch(() => {});
  }

  await prisma.report.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
