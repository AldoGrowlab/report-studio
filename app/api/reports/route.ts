import { NextResponse } from "next/server";
import type { Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { MAX_BRAND_NAME, MAX_REPORT_PERIOD } from "@/lib/reports";

// POST — buat report draft (semua user login). Satu report boleh mencakup SATU atau DUA
// platform (Jul 2026): Report.platforms memang array sejak awal, dan seluruh alur hilir
// (section, kesimpulan, rekomendasi, PPT) sudah per-platform.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: { platforms?: unknown; reportPeriod?: string; brandName?: string };
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

  if (typeof body.reportPeriod !== "string") {
    return NextResponse.json({ error: "Periode report wajib diisi." }, { status: 400 });
  }
  const reportPeriod = body.reportPeriod.trim();
  if (!reportPeriod) {
    return NextResponse.json({ error: "Periode report wajib diisi." }, { status: 400 });
  }
  // Periode ikut masuk mentah ke prompt Validator, jadi baris baru ditolak juga.
  // JUJUR TENTANG BATASNYA: ini MEMPERSEMPIT ruang injeksi, bukan menutupnya — kalimat
  // satu baris di bawah 60 karakter masih bisa lewat. Dinilai memadai karena alat ini
  // internal, operator tepercaya, periode normalnya dari dropdown, dan hasil Validator
  // terlihat di layar sebelum PPT diunduh. Kalau suatu saat dipakai pihak tak tepercaya,
  // ini harus diganti allowlist format ("Juni 2026"), bukan sekadar batas panjang.
  if (reportPeriod.length > MAX_REPORT_PERIOD || /[\r\n]/.test(reportPeriod)) {
    return NextResponse.json(
      { error: `Periode report maksimal ${MAX_REPORT_PERIOD} karakter, tanpa baris baru.` },
      { status: 400 }
    );
  }

  const report = await prisma.report.create({
    data: {
      brandName,
      reportPeriod,
      platforms: platforms as Platform[],
      createdById: session.userId,
    },
    select: { id: true },
  });

  return NextResponse.json({ report }, { status: 201 });
}
