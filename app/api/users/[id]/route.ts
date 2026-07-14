import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// DELETE — hapus akun user (offboarding). Hanya founder. Audit P1.
// Guard: tidak boleh hapus diri sendiri; tidak boleh hapus founder terakhir (lockout);
// user yang sudah membuat report tak bisa dihapus (relasi Report.createdBy restrict) —
// dijawab 409 berpesan, bukan 500.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/users/[id]">) {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  if (id === session.userId) {
    return NextResponse.json(
      { error: "Tidak bisa menghapus akunmu sendiri." },
      { status: 400 }
    );
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  }

  if (target.role === "founder") {
    const founderCount = await prisma.user.count({ where: { role: "founder" } });
    if (founderCount <= 1) {
      return NextResponse.json(
        { error: "Tidak bisa menghapus founder terakhir." },
        { status: 400 }
      );
    }
  }

  // Pre-check report yang dibuat user ini. Relasi Report->User ON DELETE RESTRICT
  // (Postgres 23001) di-surface Prisma sebagai UnknownRequestError, bukan P2003 — jadi
  // pre-check count lebih andal daripada menangkap kode error.
  const reportCount = await prisma.report.count({ where: { createdById: id } });
  if (reportCount > 0) {
    return NextResponse.json(
      {
        error: `User ini pembuat ${reportCount} report — akun tak bisa dihapus tanpa menghapus report tersebut. Alihkan/hapus report-nya dulu.`,
      },
      { status: 409 }
    );
  }

  try {
    await prisma.user.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
    }
    throw e;
  }

  return NextResponse.json({ ok: true });
}
