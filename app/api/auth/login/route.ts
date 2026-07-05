import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    return NextResponse.json({ error: "Email dan password wajib diisi." }, { status: 400 });
  }

  // Cari user berdasarkan email
  const user = await prisma.user.findUnique({ where: { email } });

  // Pesan error sengaja sama untuk email salah maupun password salah,
  // supaya tidak membocorkan email mana yang terdaftar.
  if (!user) {
    return NextResponse.json({ error: "Email atau password salah." }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Email atau password salah." }, { status: 401 });
  }

  // Login berhasil — pasang sesi
  await createSession({
    userId: user.id,
    email: user.email,
    role: user.role as "founder" | "user",
  });

  return NextResponse.json({ role: user.role });
}