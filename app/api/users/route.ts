import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import bcrypt from "bcryptjs";

// GET — daftar semua user (hanya founder)
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ users });
}

// POST — buat user baru (hanya founder)
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "founder") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: { email?: string; password?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const role = body.role;

  if (!email || !password) {
    return NextResponse.json({ error: "Email dan password wajib diisi." }, { status: 400 });
  }
  // Divalidasi di SERVER: input type="email" di halaman Users berada di luar <form> dan
  // dikirim lewat onClick, jadi validasi bawaan browser tak pernah dijalankan. Akibatnya
  // akun ber-email salah ketik bisa terbuat dan tak bisa dipakai login.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 6) {
    return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });
  }
  if (role !== "founder" && role !== "user") {
    return NextResponse.json({ error: "Peran tidak valid." }, { status: 400 });
  }

  // Cek email belum dipakai
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email sudah terdaftar." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, passwordHash, role: role as "founder" | "user" },
    select: { id: true, email: true, role: true, createdAt: true },
  });

  return NextResponse.json({ user }, { status: 201 });
}