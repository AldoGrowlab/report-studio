import { NextResponse } from "next/server";
import { Prisma, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

const MIN_PASSWORD = 6;

// PATCH — ubah password dan/atau peran. Sebelum ini TIDAK ADA cara mengubah keduanya:
// operator yang lupa password tidak bisa direset DAN tidak bisa dihapus kalau sudah pernah
// membuat report (409), jadi akunnya terkunci permanen — hanya bisa dibereskan lewat DB.
//
// Dua jalur izin:
//   - founder: boleh mengubah password/peran SIAPA PUN (reset, tanpa password lama);
//   - siapa pun: boleh mengubah password DIRINYA SENDIRI, wajib menyertakan password lama.
// Guard lockout mengikuti pola DELETE: peran dari allowlist, founder terakhir tak boleh
// diturunkan, dan tidak boleh menurunkan peran diri sendiri.
export async function PATCH(request: Request, ctx: RouteContext<"/api/users/[id]">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;
  const isSelf = id === session.userId;
  const isFounder = session.role === "founder";
  if (!isFounder && !isSelf) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: { password?: unknown; currentPassword?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const wantsPassword = body.password !== undefined;
  const wantsRole = body.role !== undefined;
  if (!wantsPassword && !wantsRole) {
    return NextResponse.json(
      { error: "Tidak ada yang diubah — sertakan password dan/atau role." },
      { status: 400 }
    );
  }
  if (wantsRole && !isFounder) {
    return NextResponse.json({ error: "Hanya founder yang bisa mengubah peran." }, { status: 403 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, passwordHash: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User tidak ditemukan." }, { status: 404 });
  }

  const data: { passwordHash?: string; role?: Role } = {};

  if (wantsPassword) {
    if (typeof body.password !== "string" || body.password.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `Password minimal ${MIN_PASSWORD} karakter.` },
        { status: 400 }
      );
    }
    // Ganti password sendiri WAJIB membuktikan password lama — supaya sesi yang terlanjur
    // bocor tidak bisa dipakai mengunci pemilik akun keluar dari akunnya sendiri.
    if (!isFounder) {
      if (typeof body.currentPassword !== "string" || !body.currentPassword) {
        return NextResponse.json({ error: "Password lama wajib diisi." }, { status: 400 });
      }
      const ok = await bcrypt.compare(body.currentPassword, target.passwordHash);
      if (!ok) {
        return NextResponse.json({ error: "Password lama salah." }, { status: 400 });
      }
    }
    data.passwordHash = await bcrypt.hash(body.password, 10);
  }

  if (wantsRole) {
    if (body.role !== "founder" && body.role !== "user") {
      return NextResponse.json({ error: "Peran harus founder atau user." }, { status: 400 });
    }
    if (isSelf && body.role !== session.role) {
      return NextResponse.json(
        { error: "Tidak bisa mengubah peranmu sendiri." },
        { status: 400 }
      );
    }
    // Menurunkan founder terakhir = sistem tak terkelola selamanya.
    if (target.role === "founder" && body.role === "user") {
      const founderCount = await prisma.user.count({ where: { role: "founder" } });
      if (founderCount <= 1) {
        return NextResponse.json(
          { error: "Tidak bisa menurunkan founder terakhir." },
          { status: 400 }
        );
      }
    }
    data.role = body.role;
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, role: true },
  });
  return NextResponse.json({ user: updated });
}

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
