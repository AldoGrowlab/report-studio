import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { imageSizePx } from "@/lib/image-size";
import { getSession } from "@/lib/session";
import { MAX_UPLOAD_BYTES } from "@/lib/reports";
import { getStorage, isAllowedImageType, extForMime } from "@/lib/storage";

// Tahap 10 — logo tema (hanya founder): tampil di cover PPT. Disimpan via lib/storage.ts
// (R2/disk); ganti logo menghapus file lama. Tanpa logo = sah (cover tetap jalan).

async function getOrCreateTheme() {
  const existing = await prisma.theme.findFirst({ orderBy: { updatedAt: "asc" } });
  if (existing) return existing;
  return prisma.theme.create({ data: {} });
}

function requireFounder(session: Awaited<ReturnType<typeof getSession>>) {
  return session !== null && session.role === "founder";
}

// POST — unggah/ganti logo. Body: multipart/form-data { file }.
export async function POST(request: Request) {
  const session = await getSession();
  if (!requireFounder(session)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File logo wajib diunggah." }, { status: 400 });
  }
  if (!isAllowedImageType(file.type)) {
    return NextResponse.json(
      { error: "Format harus PNG, JPG, WEBP, atau GIF." },
      { status: 400 }
    );
  }
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Ukuran logo maksimal 10 MB." }, { status: 400 });
  }

  const key = `theme/logo-${randomUUID()}.${extForMime(file.type)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Verifikasi ISI file, bukan cuma Content-Type kiriman client (yang dikendalikan
  // sepenuhnya oleh pengirim). Tanpa ini, file teks/PDF ber-"type=image/png" diterima 201
  // lalu tertanam ke deck sebagai .png rusak tanpa error di titik mana pun — terbukti di
  // uji E2E. imageSizePx membaca magic bytes dan mengembalikan null bila header tidak
  // cocok dengan tipe yang diklaim.
  if (imageSizePx(bytes, file.type) === null) {
    return NextResponse.json(
      { error: "File ini bukan gambar yang valid. Unggah logo (PNG/JPG/WEBP/GIF)." },
      { status: 400 }
    );
  }
  await getStorage().put(key, bytes, file.type);

  const theme = await getOrCreateTheme();
  const oldKey = theme.logoKey;
  const updated = await prisma.theme.update({
    where: { id: theme.id },
    data: { logoKey: key },
  });
  // Hapus file lama SETELAH DB menunjuk yang baru (gagal hapus tidak merusak tema).
  if (oldKey) await getStorage().delete(oldKey);

  return NextResponse.json({ theme: updated });
}

// DELETE — hapus logo (kembali tanpa logo).
export async function DELETE() {
  const session = await getSession();
  if (!requireFounder(session)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const theme = await getOrCreateTheme();
  if (theme.logoKey) {
    await getStorage().delete(theme.logoKey);
    await prisma.theme.update({ where: { id: theme.id }, data: { logoKey: null } });
  }
  return NextResponse.json({ ok: true });
}

// GET — sajikan logo untuk preview UI (di balik auth, pola route image upload).
export async function GET() {
  const session = await getSession();
  if (!requireFounder(session)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const theme = await prisma.theme.findFirst({ orderBy: { updatedAt: "asc" } });
  if (!theme?.logoKey) {
    return NextResponse.json({ error: "Belum ada logo." }, { status: 404 });
  }
  const served = await getStorage().serve(theme.logoKey);
  if (!served) {
    return NextResponse.json({ error: "Logo tidak ditemukan di storage." }, { status: 404 });
  }
  if (served.kind === "redirect") {
    return NextResponse.redirect(served.url, 307);
  }
  const b = served.bytes;
  const body = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": served.contentType, "Cache-Control": "private, max-age=60" },
  });
}
