// Gabung Foto (Jul 2026) — geometri penggabungan beberapa screenshot menjadi SATU gambar.
//
// MURNI & deterministik: tidak menyentuh DOM, canvas, maupun piksel. Fungsi di sini hanya
// menghitung "instruksi komposisi" (potongan sumber -> kotak tujuan di kanvas hasil);
// yang menggambar adalah pemanggilnya (modal client, lewat ctx.drawImage). Karena murni,
// seluruh aturan potong/skala/atap dimensi bisa diuji tanpa browser.
//
// Keputusan desain (lihat docs/DESIGN.md §Gabung Foto):
// - TIDAK ADA deteksi/pembuangan irisan otomatis berbasis konten gambar. Sudah dibuktikan
//   dengan foto produksi: dua screenshot dari jendela yang sama TIDAK identik piksel (ukuran
//   jendela beda beberapa px + resampling), sehingga pencocokan piksel gagal SENYAP —
//   kegagalan senyap pada bahan angka adalah pelanggaran Prinsip #1. Irisan dibuang operator
//   lewat crop interaktif, dan presetnya disimpan supaya hanya sekali kerja.
// - Alur: crop -> skala proporsional -> tempel berurutan. Tanpa AI, tanpa content-aware.

export type Trim = { top: number; right: number; bottom: number; left: number };
export type ImageSize = { width: number; height: number };
export type MergeDirection = "vertical" | "horizontal";
export type MergeSource = { size: ImageSize; trim: Trim };

// Satu instruksi drawImage: potongan (s*) dari gambar asli -> kotak (d*) di kanvas hasil.
export type Placement = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
};

export type MergeLayout = {
  width: number;
  height: number;
  placements: Placement[];
  // true = kena atap MAX_CANVAS_PX, seluruh kanvas diperkecil proporsional.
  scaledDown: boolean;
};

export type MergeLayoutResult =
  | { ok: true; layout: MergeLayout }
  | { ok: false; error: string };

export const MIN_MERGE_FILES = 2;
export const MAX_MERGE_FILES = 6;

// Sisi terpanjang kanvas hasil. Di atas ini seluruh kanvas diperkecil proporsional —
// bukan tiap gambar sendiri-sendiri, supaya baris tabel tetap sejajar.
export const MAX_CANVAS_PX = 8000;

// Potongan tidak boleh menyisakan kurang dari ini per sumbu. Menyisakan beberapa persen
// biasanya berarti operator salah geser, dan hasilnya baru ketahuan setelah ekstraksi.
export const MIN_REMAINING = 0.1;

export const NO_TRIM: Trim = { top: 0, right: 0, bottom: 0, left: 0 };

// Toleransi pembanding pecahan: 1 - 0.45 - 0.45 tidak persis 0.1 di floating point,
// dan potongan yang menyisakan TEPAT 10% harus tetap sah.
const EPS = 1e-9;

// null = potongan sah. Selain itu pesan siap tampil ke operator.
export function trimError(trim: Trim): string | null {
  for (const v of [trim.top, trim.right, trim.bottom, trim.left]) {
    if (!Number.isFinite(v) || v < 0 || v >= 1) {
      return "nilai potong harus antara 0 dan 1.";
    }
  }
  if (1 - trim.top - trim.bottom < MIN_REMAINING - EPS) {
    return "potongan atas+bawah menyisakan kurang dari 10% tinggi asli.";
  }
  if (1 - trim.left - trim.right < MIN_REMAINING - EPS) {
    return "potongan kiri+kanan menyisakan kurang dari 10% lebar asli.";
  }
  return null;
}

// Fraksi potong -> kotak sumber dalam PIKSEL gambar asli. Fraksi (bukan piksel) supaya
// preset dari bulan lalu tetap benar walau screenshot bulan ini beda resolusi.
export function computeCropRect(size: ImageSize, trim: Trim): {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
} {
  return {
    sx: size.width * trim.left,
    sy: size.height * trim.top,
    sw: size.width * (1 - trim.left - trim.right),
    sh: size.height * (1 - trim.top - trim.bottom),
  };
}

// Batas geser satu sisi supaya sisi seberangnya tetap menyisakan MIN_REMAINING.
export function maxTrimForSide(trim: Trim, side: keyof Trim): number {
  const opposite: Record<keyof Trim, keyof Trim> = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  };
  return Math.max(0, 1 - MIN_REMAINING - trim[opposite[side]]);
}

export function clampTrimValue(trim: Trim, side: keyof Trim, value: number): number {
  if (!Number.isFinite(value)) return trim[side];
  return Math.min(maxTrimForSide(trim, side), Math.max(0, value));
}

// Susun instruksi komposisi. Vertikal: lebar hasil = lebar TERBESAR pasca-crop, tiap
// gambar diskalakan proporsional ke lebar itu, ditempel berurutan dari atas. Horizontal:
// cerminnya (tinggi terbesar, ditempel dari kiri).
export function computeMergeLayout(
  sources: MergeSource[],
  direction: MergeDirection
): MergeLayoutResult {
  if (sources.length < MIN_MERGE_FILES) {
    return { ok: false, error: `Pilih minimal ${MIN_MERGE_FILES} foto untuk digabung.` };
  }
  if (sources.length > MAX_MERGE_FILES) {
    return { ok: false, error: `Maksimal ${MAX_MERGE_FILES} foto sekali gabung.` };
  }

  const crops: { sx: number; sy: number; sw: number; sh: number }[] = [];
  for (let i = 0; i < sources.length; i++) {
    const { size, trim } = sources[i];
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
      return { ok: false, error: `Foto #${i + 1} tidak punya dimensi yang sah.` };
    }
    const err = trimError(trim);
    if (err) return { ok: false, error: `Foto #${i + 1}: ${err}` };
    crops.push(computeCropRect(size, trim));
  }

  const vertical = direction === "vertical";
  // Sumbu MELINTANG disamakan supaya sambungan rapat: vertikal -> lebar, horizontal -> tinggi.
  const cross = vertical
    ? Math.max(...crops.map((c) => c.sw))
    : Math.max(...crops.map((c) => c.sh));

  const sized = crops.map((c) => {
    const k = vertical ? cross / c.sw : cross / c.sh;
    return { dw: c.sw * k, dh: c.sh * k };
  });

  let width = vertical ? cross : sized.reduce((a, s) => a + s.dw, 0);
  let height = vertical ? sized.reduce((a, s) => a + s.dh, 0) : cross;

  // Atap dimensi: perkecil SELURUH kanvas proporsional, bukan per gambar.
  let k = 1;
  let scaledDown = false;
  const longest = Math.max(width, height);
  if (longest > MAX_CANVAS_PX) {
    k = MAX_CANVAS_PX / longest;
    scaledDown = true;
  }
  width *= k;
  height *= k;

  const canvasW = Math.round(width);
  const canvasH = Math.round(height);

  // Offset dihitung KUMULATIF lalu dibulatkan sebagai TEPI (bukan tiap ukuran sendiri),
  // supaya potongan bertemu persis — tanpa garis putih sela atau tumpang tindih 1px.
  const placements: Placement[] = [];
  let cursor = 0;
  for (let i = 0; i < crops.length; i++) {
    const c = crops[i];
    const dw = sized[i].dw * k;
    const dh = sized[i].dh * k;
    if (vertical) {
      const dy = Math.round(cursor);
      cursor += dh;
      placements.push({ ...c, dx: 0, dy, dw: canvasW, dh: Math.round(cursor) - dy });
    } else {
      const dx = Math.round(cursor);
      cursor += dw;
      placements.push({ ...c, dx, dy: 0, dw: Math.round(cursor) - dx, dh: canvasH });
    }
  }

  return { ok: true, layout: { width: canvasW, height: canvasH, placements, scaledDown } };
}

// Tebakan arah dari DIMENSI saja — SENGAJA konservatif, dan null berarti "jangan menebak".
//
// Screenshot dari jendela yang sama hampir selalu berdimensi mirip di KEDUA sumbu, dan
// dimensi TIDAK mencerminkan arah scroll konten. Menebak dari sinyal lemah berarti operator
// harus membatalkan tebakan kita tiap kali — lebih buruk daripada default yang jujur.
// Karena itu auto-deteksi hanya menyala pada sinyal tegas: satu sumbu MIRIP antar foto
// (selisih < 15%) DAN sumbu lainnya BEDA JAUH antar foto (selisih > 40%).
const SIMILAR = 0.15;
const DIFFERENT = 0.4;

function spread(values: number[]): number {
  const max = Math.max(...values);
  const min = Math.min(...values);
  return max <= 0 ? 1 : (max - min) / max;
}

export function detectDirection(sizes: ImageSize[]): MergeDirection | null {
  if (sizes.length < 2) return null;
  if (sizes.some((s) => !Number.isFinite(s.width) || !Number.isFinite(s.height) || s.width <= 0 || s.height <= 0)) {
    return null;
  }
  const dw = spread(sizes.map((s) => s.width));
  const dh = spread(sizes.map((s) => s.height));
  // Lebar seragam + tinggi sangat beda -> potongan atas-bawah.
  if (dw < SIMILAR && dh > DIFFERENT) return "vertical";
  // Tinggi seragam + lebar sangat beda -> potongan kiri-kanan.
  if (dh < SIMILAR && dw > DIFFERENT) return "horizontal";
  return null;
}
