// Metrik bertipe TEKS (Jul 2026) — nama produk / nama affiliator dari tabel screenshot.
//
// Nilainya BUKAN angka, jadi ia menumpang kolom `Extraction.rawText` yang sudah ada dan
// `Extraction.value` tetap NULL. Konsekuensinya (disengaja, lihat docs/DESIGN.md
// §Tipe Metrik Teks): untuk metrik teks rawText BUKAN lagi provenance OCR murni —
// koreksi manual menimpanya, karena di sinilah nilainya tinggal.
//
// Keputusan penyimpanan: **simpan apa adanya, tanpa elipsis akhir, tanpa tebakan**.
// Model dilarang melengkapi teks yang terpotong; kode yang membuang penanda potong di
// UJUNG saja — deterministik, bukan aritmetika/kreativitas LLM (Prinsip #1).

// Batas panjang untuk koreksi manual. Nama produk terpanjang di seller center jauh di
// bawah ini; batas ada supaya salah-tempel satu paragraf tidak masuk ke slide.
export const MAX_TEXT_LENGTH = 200;

// Penanda TERPOTONG di ujung teks: "..." / "…" / "··" dan campurannya. SENGAJA {2,}:
// titik TUNGGAL yang sah ("75gr.", "No. 1") tidak boleh ikut terbuang, dan bagian
// TENGAH teks tidak pernah disentuh.
const TRAILING_ELLIPSIS_RE = /[.…·]{2,}\s*$/;
const TRAILING_SINGLE_ELLIPSIS_RE = /…\s*$/;

// Teks apa adanya dari gambar -> teks siap simpan. null = tidak ada teks terbaca.
export function cleanMetricText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .replace(TRAILING_ELLIPSIS_RE, "")
    .replace(TRAILING_SINGLE_ELLIPSIS_RE, "")
    .trim();
  return cleaned === "" ? null : cleaned;
}

// Indeks BARIS TABEL dari key metrik: "nama_produk_1" -> 1, "penjualan_produk_1" -> 1.
// Metrik ber-indeks sama berasal dari baris peringkat yang sama di screenshot — itulah
// yang memasangkan nama dengan angkanya saat data dirakit untuk Analyst.
// null = key tanpa indeks (metrik biasa, tidak ikut pemasangan).
export function metricIndex(key: string): number | null {
  const m = /_(\d+)$/.exec(key);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) ? n : null;
}
