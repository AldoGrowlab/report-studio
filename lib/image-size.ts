// Tahap 8 — baca dimensi piksel gambar dari header bytes, DETERMINISTIK & tanpa dependency.
// Dipakai Template Engine untuk menghitung penempatan "contain" foto di slide sendiri,
// bukan menggantungkan proporsi pada perilaku library PPT. Mendukung persis 4 tipe yang
// diizinkan lib/storage.ts: PNG, JPEG, GIF, WebP. Tak terbaca -> null (pemanggil pakai
// rasio fallback; report tetap jalan — Prinsip #3).

export type ImagePxSize = { w: number; h: number };

function u32be(b: Uint8Array, off: number): number {
  return (b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3];
}
function u16be(b: Uint8Array, off: number): number {
  return (b[off] << 8) | b[off + 1];
}
function u16le(b: Uint8Array, off: number): number {
  return b[off] | (b[off + 1] << 8);
}
function u24le(b: Uint8Array, off: number): number {
  return b[off] | (b[off + 1] << 8) | (b[off + 2] << 16);
}

// PNG: signature 8 byte, chunk pertama wajib IHDR -> width/height u32 big-endian.
function pngSize(b: Uint8Array): ImagePxSize | null {
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return null;
  // b[12..15] = "IHDR"
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const w = u32be(b, 16);
  const h = u32be(b, 20);
  return w > 0 && h > 0 ? { w, h } : null;
}

// JPEG: scan marker sampai SOF (C0..CF kecuali C4/C8/CC) -> height,width u16 big-endian.
function jpegSize(b: Uint8Array): ImagePxSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < b.length) {
    if (b[off] !== 0xff) {
      off++; // padding/isi entropi — cari marker berikutnya
      continue;
    }
    const marker = b[off + 1];
    if (marker === 0xff) {
      off++; // fill byte
      continue;
    }
    // Marker tanpa panjang (RST/SOI/EOI) — lewati saja.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      off += 2;
      continue;
    }
    const len = u16be(b, off + 2);
    if (len < 2) return null;
    const isSOF =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      // payload: precision(1) height(2) width(2)
      const h = u16be(b, off + 5);
      const w = u16be(b, off + 7);
      return w > 0 && h > 0 ? { w, h } : null;
    }
    off += 2 + len;
  }
  return null;
}

// GIF: "GIF87a"/"GIF89a" lalu logical screen width/height u16 little-endian.
function gifSize(b: Uint8Array): ImagePxSize | null {
  if (b.length < 10) return null;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  const w = u16le(b, 6);
  const h = u16le(b, 8);
  return w > 0 && h > 0 ? { w, h } : null;
}

// WebP: RIFF....WEBP lalu chunk pertama VP8 (lossy) / VP8L (lossless) / VP8X (extended).
function webpSize(b: Uint8Array): ImagePxSize | null {
  if (b.length < 30) return null;
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) if (b[off + i] !== s.charCodeAt(i)) return false;
    return true;
  };
  if (!ascii(0, "RIFF") || !ascii(8, "WEBP")) return null;
  if (ascii(12, "VP8X")) {
    // canvas = u24le minus-one di offset 24 (width) dan 27 (height)
    return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  }
  if (ascii(12, "VP8L")) {
    // signature 0x2F lalu 14 bit width-1, 14 bit height-1
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    return { w, h };
  }
  if (ascii(12, "VP8 ")) {
    // frame tag 3 byte, sync 9D 01 2A, lalu width/height u16le (14 bit efektif)
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const w = u16le(b, 26) & 0x3fff;
    const h = u16le(b, 28) & 0x3fff;
    return w > 0 && h > 0 ? { w, h } : null;
  }
  return null;
}

export function imageSizePx(bytes: Uint8Array, contentType: string): ImagePxSize | null {
  switch (contentType) {
    case "image/png":
      return pngSize(bytes);
    case "image/jpeg":
      return jpegSize(bytes);
    case "image/gif":
      return gifSize(bytes);
    case "image/webp":
      return webpSize(bytes);
    default:
      // Content-type tak dikenal: coba semua (key storage bisa saja .bin).
      return pngSize(bytes) ?? jpegSize(bytes) ?? gifSize(bytes) ?? webpSize(bytes);
  }
}
