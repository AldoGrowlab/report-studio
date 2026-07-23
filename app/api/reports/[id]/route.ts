import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport } from "@/lib/reports";
import { isValidPeriodMonth, formatMonthID } from "@/lib/period";
import { recomputeDerivedMetrics } from "@/lib/derived-compute";
import { getStorage } from "@/lib/storage";

// DELETE — hapus report beserta seluruh isinya (Jul 2026). Founder & operator (Model B).
// WAJIB (DESIGN §Backlog): hapus file storage semua upload DULU — cascade DB tidak
// menyentuh R2/disk. Baru setelah itu hapus baris report (cascade menghapus uploads,
// extractions, insights, conclusions, recommendations, flags, insightRevisions).
export async function DELETE(_request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  const report = await prisma.report.findUnique({
    where: { id },
    include: { uploads: { select: { imageUrl: true } } },
  });
  if (!report) {
    return NextResponse.json({ error: "Report tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  // Hapus file storage tiap upload dulu (gagal hapus satu file tak menghentikan proses —
  // report tetap terhapus; file yatim jauh lebih ringan daripada baris DB yatim).
  const storage = getStorage();
  for (const u of report.uploads) {
    await storage.delete(u.imageUrl).catch(() => {});
  }

  await prisma.report.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

// PATCH — ubah PASANGAN BULAN report (Poin 2c). Menggantikan editor reportPeriod teks-bebas
// lama (dihapus: ia menulis ke field yang dipakai FILTER, jadi tak boleh tetap hidup).
// Body: { periodeUtama: "YYYY-MM"|null, periodePembanding: "YYYY-MM"|null }.
//
// Efek: (1) reportPeriod di-DENORMALISASI ulang dari periodeUtama baru — KECUALI reportPeriod
// lama adalah label kustom (bukan cermin periodeUtama lama), yang dipertahankan agar filter
// tidak menua; (2) foto berlabel di luar pasangan baru TIDAK dipetakan ulang (jadi anomali
// yang diperingatkan di UI); (3) metrik turunan dihitung ulang (pemilihan foto periode utama
// berubah).
export async function PATCH(request: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { id } = await ctx.params;

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) {
    return NextResponse.json({ error: "Report tidak ditemukan." }, { status: 404 });
  }
  if (!canAccessReport(session, report)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const readMonth = (v: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } => {
    if (v === undefined || v === null || v === "") return { ok: true, value: null };
    if (typeof v !== "string" || !isValidPeriodMonth(v)) return { ok: false, error: `${label} tidak valid.` };
    return { ok: true, value: v };
  };
  const utamaR = readMonth(b.periodeUtama, "Periode utama");
  if (!utamaR.ok) return NextResponse.json({ error: utamaR.error }, { status: 400 });
  const pembandingR = readMonth(b.periodePembanding, "Periode pembanding");
  if (!pembandingR.ok) return NextResponse.json({ error: pembandingR.error }, { status: 400 });
  const periodeUtama = utamaR.value;
  let periodePembanding = pembandingR.value;
  if (!periodeUtama) periodePembanding = null;
  if (periodePembanding && periodePembanding === periodeUtama) periodePembanding = null;

  // Re-denormalisasi reportPeriod HANYA bila nilainya masih cermin periodeUtama lama.
  // Deteksi label kustom: reportPeriod lama !== formatMonthID(periodeUtama lama). Termasuk
  // kasus periodeUtama lama null + reportPeriod terisi -> pasti kustom (jangan sentuh).
  const oldMirror = report.periodeUtama ? formatMonthID(report.periodeUtama) : null;
  const isCustomLabel =
    (report.reportPeriod ?? "").trim() !== "" && report.reportPeriod !== oldMirror;
  const reportPeriod = isCustomLabel
    ? report.reportPeriod
    : periodeUtama
      ? formatMonthID(periodeUtama)
      : null;

  await prisma.report.update({
    where: { id },
    data: {
      periodeUtama,
      periodePembanding,
      reportPeriod,
      // Disunting manusia -> bukan lagi hasil deteksi; ekstraksi tak menimpanya lagi.
      periodDetected: false,
    },
  });

  // Pemilihan foto "periode utama" berubah -> kontribusi turunan dihitung ulang.
  // Gagal di sini tak menggagalkan penyimpanan pasangan (Prinsip #3).
  try {
    await recomputeDerivedMetrics(id);
  } catch {
    /* diamkan — pasangan sudah tersimpan; hitung-ulang berikutnya memperbaikinya */
  }

  return NextResponse.json({
    report: { periodeUtama, periodePembanding, reportPeriod, periodDetected: false },
    changed: true,
  });
}
