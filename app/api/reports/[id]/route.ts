import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAccessReport, MAX_REPORT_PERIOD } from "@/lib/reports";
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

// PATCH — ubah periode report manual (Jul 2026, Deteksi Bulan Otomatis).
// Body: { reportPeriod: string }. Edit manual SELALU menang: periodDetected dikembalikan
// ke false secara PERMANEN, sehingga ekstraksi berikutnya tidak pernah menimpanya lagi.
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
  if (typeof b.reportPeriod !== "string") {
    return NextResponse.json({ error: "Periode report harus berupa teks." }, { status: 400 });
  }
  const reportPeriod = b.reportPeriod.trim();
  // Batas SAMA dengan saat pembuatan report (periode ikut mentah ke prompt Validator).
  if (reportPeriod.length > MAX_REPORT_PERIOD || /[\r\n]/.test(reportPeriod)) {
    return NextResponse.json(
      { error: `Periode report maksimal ${MAX_REPORT_PERIOD} karakter, tanpa baris baru.` },
      { status: 400 }
    );
  }

  // `detected: true` = pengisian dari Deteksi Bulan Otomatis, bukan ketikan operator.
  // Aturan "autofill HANYA saat kosong" ditegakkan DI SERVER, bukan dipercayakan ke client:
  // beberapa foto dideteksi paralel, dan yang kedua tak boleh menimpa yang pertama —
  // apalagi menimpa nilai yang sudah disunting manusia.
  const fromDetection = b.detected === true;
  if (fromDetection) {
    if (reportPeriod === "") {
      return NextResponse.json({ error: "Periode kosong." }, { status: 400 });
    }
    if ((report.reportPeriod ?? "").trim() !== "") {
      return NextResponse.json({
        report: { reportPeriod: report.reportPeriod, periodDetected: report.periodDetected },
        changed: false,
      });
    }
  }

  const updated = await prisma.report.update({
    where: { id },
    data: {
      reportPeriod: reportPeriod === "" ? null : reportPeriod,
      // Disunting manusia -> permanen; deteksi berikutnya tidak akan menimpanya lagi.
      periodDetected: fromDetection,
    },
    select: { reportPeriod: true, periodDetected: true },
  });

  return NextResponse.json({ report: updated, changed: true });
}
