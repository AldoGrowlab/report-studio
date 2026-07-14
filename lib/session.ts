import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "rs_session";

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

// Tanda tangan: mencegah cookie dipalsukan
function sign(value: string): string {
  const hmac = crypto.createHmac("sha256", secret());
  hmac.update(value);
  return hmac.digest("hex");
}

// Membungkus data jadi string bertanda tangan
function serialize(data: SessionData): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

// Membongkar string cookie, menolak jika tanda tangan tidak cocok
function deserialize(raw: string): SessionData | null {
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;
  if (sign(payload) !== signature) return null; // cookie palsu / rusak
  try {
    return JSON.parse(Buffer.from(payload, "base64").toString()) as SessionData;
  } catch {
    return null;
  }
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

// Membaca sesi (dipakai untuk tahu siapa yang sedang login)
export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return deserialize(raw);
}

// Menghapus sesi (dipakai saat logout)
export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}