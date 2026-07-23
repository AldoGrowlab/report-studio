import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { detectPhotoContext } from "@/lib/period-detect";
import { parsePeriodText, toPeriodMonth } from "@/lib/period-parser";

// POST — pembaca KONTEKS FOTO. Dipanggil saat operator memilih foto.
// Route TIPIS (pola merge-suggest): jaga sesi, validasi bentuk, panggil lib.
//
// Membaca DUA hal sekaligus dalam satu panggilan: teks periode (-> bulan) dan teks tab
// aktif (-> sub-grup, Fase 1). Pemetaan keduanya DETERMINISTIK di kode — periode oleh
// lib/period-parser.ts, tab oleh lib/subgroups.ts di client (yang tahu section terpilih).
//
// Tidak menyentuh DB dan tidak menyimpan apa pun — keluarannya cuma mengisi dropdown yang
// tetap bisa diubah operator. Karena tak ada report yang terlibat, tak ada pemeriksaan
// kepemilikan (Model B, lihat docs/DESIGN.md §Akses & Permission).

// 1 foto @1200px JPEG jauh di bawah ini; batas ada supaya permintaan salah bentuk
// tidak menghabiskan memori server sebelum sempat ditolak.
const MAX_PAYLOAD_CHARS = 8 * 1024 * 1024;

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
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const photo = b.photo;
  if (typeof photo !== "string" || photo.length === 0) {
    return NextResponse.json({ error: "Format foto tidak valid." }, { status: 400 });
  }
  if (photo.length > MAX_PAYLOAD_CHARS) {
    return NextResponse.json({ error: "Ukuran permintaan terlalu besar." }, { status: 400 });
  }

  const buffer = Buffer.from(photo, "base64");
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Format foto tidak valid." }, { status: 400 });
  }

  try {
    const ctx = await detectPhotoContext(buffer);
    // Pemetaan teks -> bulan DETERMINISTIK di kode, tidak pernah oleh model.
    // tabLabel dikirim APA ADANYA: yang tahu daftar sub-grup adalah client (section-nya
    // baru dipilih setelah foto masuk antrean), dan pencocokannya pun murni kode.
    const parsed = parsePeriodText(ctx.periodText);
    return NextResponse.json({
      periodText: ctx.periodText,
      month: parsed ? toPeriodMonth(parsed) : null,
      tabLabel: ctx.tabLabel,
    });
  } catch {
    // Gagal = client diam saja (dropdown tetap kosong, operator memilih manual).
    // Fitur bantu tidak boleh menghentikan pekerjaan (Prinsip #3).
    return NextResponse.json({ error: "Baca konteks foto gagal." }, { status: 502 });
  }
}
