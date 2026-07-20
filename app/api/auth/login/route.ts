import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Hash bcrypt cost 10 atas nilai acak — TIDAK pernah cocok dengan password apa pun.
// Dipakai hanya untuk menyamakan waktu respons saat email tak terdaftar.
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
import { createSession } from "@/lib/session";
import {
  throttleDelayMs,
  recordFailure,
  clearFailures,
  sleep,
} from "@/lib/login-throttle";
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

  // Audit P7 — throttle per email+IP: percobaan beruntun setelah beberapa gagal ditunda,
  // memperlambat tebak-password. IP dari header proxy (Railway) dengan fallback.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const key = `${email}|${ip}`;
  const delay = throttleDelayMs(key, Date.now());
  if (delay > 0) await sleep(delay);

  // Cari user berdasarkan email
  const user = await prisma.user.findUnique({ where: { email } });

  // Pesan error sengaja sama untuk email salah maupun password salah,
  // supaya tidak membocorkan email mana yang terdaftar.
  if (!user) {
    // Tetap jalankan bcrypt terhadap hash boneka. Tanpa ini, email TAK TERDAFTAR dijawab
    // seketika sementara email terdaftar membayar ~50-100 ms bcrypt — selisih yang cukup
    // untuk memilah email mana yang benar-benar ada, lalu memfokuskan tebakan ke sana.
    // Pesan errornya memang sudah disamakan; ini menyamakan WAKTUNYA.
    await bcrypt.compare(password, DUMMY_HASH);
    recordFailure(key, Date.now());
    return NextResponse.json({ error: "Email atau password salah." }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    recordFailure(key, Date.now());
    return NextResponse.json({ error: "Email atau password salah." }, { status: 401 });
  }

  // Login berhasil — bersihkan throttle & pasang sesi
  clearFailures(key);
  await createSession({
    userId: user.id,
    email: user.email,
    role: user.role as "founder" | "user",
  });

  return NextResponse.json({ role: user.role });
}