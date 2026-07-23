import { NextResponse } from "next/server";
import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { MAX_BRAND_NAME } from "@/lib/reports";
import { isValidPeriodMonth, formatMonthID } from "@/lib/period";

// POST — buat report draft (semua user login). Satu report boleh mencakup SATU atau DUA
// platform (Jul 2026): Report.platforms memang array sejak awal, dan seluruh alur hilir
// (section, kesimpulan, rekomendasi, PPT) sudah per-platform.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: {
    platforms?: unknown;
    brandName?: string;
    periodeUtama?: unknown;
    periodePembanding?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }

  // Urutan disimpan kanonik Shopee -> TikTok (DESIGN §Platform) supaya badge, tab, dan
  // urutan blok PPT konsisten apa pun urutan centang user.
  const requested = Array.isArray(body.platforms) ? body.platforms : [];
  const platforms = (["shopee", "tiktok"] as const).filter((p) => requested.includes(p));
  if (platforms.length === 0) {
    return NextResponse.json(
      { error: "Pilih minimal satu platform (Shopee dan/atau TikTok)." },
      { status: 400 }
    );
  }

  // Tipe DIPERIKSA saat runtime, bukan sekadar dianotasi. `body` datang dari
  // request.json() yang bisa berisi apa saja: `brandName: 123` dulu membuat
  // `.trim is not a function` -> 500 dengan body KOSONG, jadi klien tak dapat pesan
  // apa pun. Pola ini sudah benar di lib/sections.ts dan recommendation route.
  if (typeof body.brandName !== "string") {
    return NextResponse.json({ error: "Nama brand wajib diisi." }, { status: 400 });
  }
  const brandName = body.brandName.trim();
  if (!brandName) {
    return NextResponse.json({ error: "Nama brand wajib diisi." }, { status: 400 });
  }
  // Batas panjang: nama brand ikut ke judul cover DAN ke nama berkas unduhan lewat
  // header Content-Disposition — 600 karakter membuat header membengkak dan unduhan
  // gagal dengan error yang tidak menjelaskan apa-apa.
  if (brandName.length > MAX_BRAND_NAME) {
    return NextResponse.json(
      { error: `Nama brand maksimal ${MAX_BRAND_NAME} karakter.` },
      { status: 400 }
    );
  }

  // Poin 2 — pasangan bulan level report (kanonik "YYYY-MM"), keduanya OPSIONAL. Kosong =
  // menunggu Deteksi Bulan Otomatis mengisi periodeUtama dari screenshot (fallback lama).
  const readMonth = (v: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } => {
    if (v === undefined || v === null || v === "") return { ok: true, value: null };
    if (typeof v !== "string" || !isValidPeriodMonth(v)) {
      return { ok: false, error: `${label} tidak valid.` };
    }
    return { ok: true, value: v };
  };
  const utamaR = readMonth(body.periodeUtama, "Periode utama");
  if (!utamaR.ok) return NextResponse.json({ error: utamaR.error }, { status: 400 });
  const pembandingR = readMonth(body.periodePembanding, "Periode pembanding");
  if (!pembandingR.ok) return NextResponse.json({ error: pembandingR.error }, { status: 400 });
  const periodeUtama = utamaR.value;
  let periodePembanding = pembandingR.value;
  // Pembanding tanpa utama tak bermakna; pembanding == utama itu redundan -> abaikan.
  if (!periodeUtama) periodePembanding = null;
  if (periodePembanding && periodePembanding === periodeUtama) periodePembanding = null;

  // reportPeriod = label tampilan/filter DENORMALISASI dari periodeUtama (bukan sumber
  // logika — semua keputusan periode membaca periodeUtama). Menjaga filter daftar report
  // tetap berfungsi persis seperti sebelumnya.
  const reportPeriod = periodeUtama ? formatMonthID(periodeUtama) : null;

  const report = await prisma.report.create({
    data: {
      brandName,
      reportPeriod,
      periodeUtama,
      periodePembanding,
      platforms: platforms as Platform[],
      createdById: session.userId,
    },
    select: { id: true },
  });

  return NextResponse.json({ report }, { status: 201 });
}
