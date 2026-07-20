import { cookies } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "rs_session";

// Masa berlaku sesi. Ditegakkan DUA kali: maxAge cookie (browser) DAN klaim `exp` di
// dalam payload bertanda tangan (server). Yang kedua yang penting — tanpa itu, nilai
// cookie yang sempat tersalin keluar berlaku SELAMANYA lewat curl, dan satu-satunya cara
// mencabutnya adalah mengganti AUTH_SECRET (menendang semua orang sekaligus).
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Rahasia HMAC WAJIB ada. Dulu fallback "" — kalau AUTH_SECRET lupa diset, cookie sesi
// bisa dipalsukan dengan kunci kosong (siapa pun bisa menghitung tanda tangan founder).
// Kini gagal keras. Dibaca lazy (bukan konstanta modul) supaya import & `next build`
// tetap aman; yang gagal adalah operasi tanda tangan pertama (login / baca sesi).
function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) {
    throw new Error(
      "AUTH_SECRET tidak diset — sesi tidak bisa ditandatangani dengan aman. " +
        "Set env AUTH_SECRET (string acak panjang) sebelum menjalankan aplikasi."
    );
  }
  return s;
}

// Struktur isi sesi yang kita simpan di cookie
export type SessionData = {
  userId: string;
  email: string;
  role: "founder" | "user";
};

// Isi cookie = data sesi + waktu kedaluwarsa. `role` di sini hanya petunjuk; sumber
// kebenarannya tetap DB (lihat getSession).
type CookiePayload = SessionData & { exp: number };

// Perbandingan tanda tangan yang tidak bocor lewat waktu eksekusi.
function signatureMatches(expected: string, given: string): boolean {
  if (expected.length !== given.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
  } catch {
    return false;
  }
}

// Tanda tangan: mencegah cookie dipalsukan
function sign(value: string): string {
  const hmac = crypto.createHmac("sha256", secret());
  hmac.update(value);
  return hmac.digest("hex");
}

// Membungkus data jadi string bertanda tangan
function serialize(data: SessionData): string {
  const body: CookiePayload = { ...data, exp: Date.now() + SESSION_TTL_MS };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

// Membongkar string cookie, menolak jika tanda tangan tidak cocok
function deserialize(raw: string): CookiePayload | null {
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;
  if (!signatureMatches(sign(payload), signature)) return null; // cookie palsu / rusak

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64").toString());
  } catch {
    return null;
  }

  // Bentuk payload divalidasi, tidak sekadar di-cast. Tanpa ini, perubahan format cookie
  // di kemudian hari menghasilkan userId `undefined` yang mengalir diam-diam ke createdById.
  const p = parsed as Partial<CookiePayload> | null;
  if (!p || typeof p.userId !== "string" || !p.userId) return null;
  if (typeof p.email !== "string") return null;
  if (p.role !== "founder" && p.role !== "user") return null;
  if (typeof p.exp !== "number" || !Number.isFinite(p.exp)) return null;
  if (Date.now() > p.exp) return null; // kedaluwarsa ditegakkan SERVER, bukan browser
  return p as CookiePayload;
}

// Membuat sesi (dipakai saat login berhasil)
export async function createSession(data: SessionData) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, serialize(data), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 hari
  });
}

// Membaca sesi (dipakai untuk tahu siapa yang sedang login).
// Cookie hanya dipercaya untuk MENGIDENTIFIKASI user; `role` dan keberadaan akun selalu
// dibaca ulang dari DB. Tanpa ini offboarding tidak berfungsi: akun yang sudah dihapus
// founder tetap bisa memakai cookie lamanya sampai kedaluwarsa. Biayanya satu lookup
// primary key per request — murah, dan menjadikan hapus-user berlaku SEKETIKA.
export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const payload = deserialize(raw);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) return null; // akun dihapus -> sesi mati seketika
  return { userId: user.id, email: user.email, role: user.role };
}

// Menghapus sesi (dipakai saat logout)
export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}