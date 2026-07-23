import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { MAX_MERGE_FILES, MIN_MERGE_FILES } from "@/lib/merge-images";
import { suggestMergeTrims } from "@/lib/merge-suggest-vision";

// POST — Auto-potong (AI) untuk Gabung Foto. Menganalisis potongan screenshot dan
// mengembalikan SARAN arah + fraksi trim per foto. Route ini TIPIS (pola orchestrator):
// jaga sesi, validasi bentuk permintaan, panggil lib/merge-suggest.ts.
//
// Tidak menyentuh DB sama sekali dan tidak menyimpan apa pun: keluarannya cuma diisikan ke
// kontrol trim di modal, dan operator yang memutuskan lewat preview. Karena itu tak ada
// pemeriksaan kepemilikan report — tak ada report yang terlibat (Model B: semua akun
// terautentikasi boleh; lihat docs/DESIGN.md §Akses & Permission).

// Atap ukuran payload. 6 foto @1200px JPEG jauh di bawah ini; batas ada supaya permintaan
// yang salah bentuk tidak menghabiskan memori server sebelum sempat ditolak.
const MAX_PAYLOAD_CHARS = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const photos = b.photos;
  if (!Array.isArray(photos) || photos.length < MIN_MERGE_FILES || photos.length > MAX_MERGE_FILES) {
    return NextResponse.json(
      { error: `Kirim ${MIN_MERGE_FILES}–${MAX_MERGE_FILES} foto.` },
      { status: 400 }
    );
  }
  if (!photos.every((p): p is string => typeof p === "string" && p.length > 0)) {
    return NextResponse.json({ error: "Format foto tidak valid." }, { status: 400 });
  }
  if (photos.reduce((a, p) => a + p.length, 0) > MAX_PAYLOAD_CHARS) {
    return NextResponse.json({ error: "Ukuran permintaan terlalu besar." }, { status: 400 });
  }

  const hint = b.hint === "vertical" || b.hint === "horizontal" ? b.hint : undefined;

  let buffers: Buffer[];
  try {
    buffers = photos.map((p) => Buffer.from(p, "base64"));
  } catch {
    return NextResponse.json({ error: "Format foto tidak valid." }, { status: 400 });
  }
  if (buffers.some((buf) => buf.length === 0)) {
    return NextResponse.json({ error: "Format foto tidak valid." }, { status: 400 });
  }

  try {
    const suggestion = await suggestMergeTrims(buffers, hint);
    return NextResponse.json(suggestion);
  } catch (e) {
    // Catat penyebab SEBENARNYA ke log server. Tanpa ini, kegagalan hanya tampak sebagai
    // 502 generik dan log Railway kosong — persis yang menyulitkan diagnosis Jul 2026.
    // Perilaku ke client TIDAK berubah: tetap 502 + fallback trim-0/manual (Prinsip #3).
    console.error("[merge-suggest] gagal:", e);
    return NextResponse.json(
      { error: "Analisis otomatis gagal. Geser garis potong manual atau coba lagi." },
      { status: 502 }
    );
  }
}
