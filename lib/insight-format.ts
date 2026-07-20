// Pecah teks poin insight menjadi segmen normal/bold secara DETERMINISTIK, berdasarkan
// kosakata angka singkat (Insight.numbers — snapshot valueText yang dikirim ke model saat
// generate). TANPA penanda markdown dari LLM: bold adalah properti segmen yang dihitung
// kode, jadi tidak bisa "rusak" (lupa tutup, salah posisi). Angka yang ditulis model
// menyimpang dari kosakata otomatis TIDAK di-bold — terlihat, bukan bold nyasar.
// Kecocokan WAJIB berdiri sebagai token utuh (lihat isTokenBoundary): tanpa itu "4,4%"
// akan ikut mem-bold ekor "14,4%", dan "50" mem-bold ekor "2050".
// Dipakai renderer PPT (lib/ppt.ts) dan panel web (UploadManager) supaya konsisten.

// ---- Sub-poin bertingkat (Fase C, SATU tingkat) ----
// Penyimpanan tetap String[] (Insight.points / Conclusion.points / InsightRevision.points*):
// sub-poin dikodekan sebagai PREFIX TAB pada elemen array. Kompatibel mundur — poin lama
// tanpa prefix tetap sah (datar). splitByNumbers TIDAK berubah: dipanggil pada text yang
// sudah dilepas prefix, jadi bold per baris tetap jalan.

export const SUB_POINT_PREFIX = "\t";

export type ParsedPointLine = { depth: 0 | 1; text: string };

// Baris storage -> kedalaman + teks bersih. Lebih dari satu tab dijepit ke 1 (satu tingkat).
export function parsePointLine(line: string): ParsedPointLine {
  if (!line.startsWith(SUB_POINT_PREFIX)) return { depth: 0, text: line };
  return { depth: 1, text: line.replace(/^\t+/, "") };
}

// Bentuk structured output LLM (generate/revisi/kesimpulan): poin + sub-poin satu tingkat.
export type StructuredPoint = { text: string; sub: string[] };

// Struktur LLM -> array datar bertingkat prefix-tab untuk storage. Baris kosong dibuang;
// sub selalu berdiri TEPAT setelah induknya, jadi pemotongan atap pada hasil ratanya
// tidak pernah menghasilkan sub yatim.
export function flattenPoints(points: StructuredPoint[]): string[] {
  const flat: string[] = [];
  for (const p of points) {
    const text = typeof p?.text === "string" ? p.text.trim() : "";
    if (!text) continue;
    flat.push(text);
    const subs = Array.isArray(p.sub) ? p.sub : [];
    for (const s of subs) {
      const subText = typeof s === "string" ? s.trim() : "";
      if (subText) flat.push(`${SUB_POINT_PREFIX}${subText}`);
    }
  }
  return flat;
}

export type TextSegment = { text: string; bold: boolean };

// Kecocokan harus berdiri sebagai token utuh, bukan potongan angka lain. Titik dan koma
// TIDAK otomatis membatalkan: keduanya baru berarti "angka berlanjut" kalau diikuti/didahului
// digit ("50.000"), sebaliknya itu cuma tanda baca akhir kalimat ("naik 4,4%.") yang justru
// HARUS tetap di-bold. "#" di depan ditolak supaya "Sumber #1" tak dianggap angka metrik.
const isDigit = (c: string) => c >= "0" && c <= "9";

function isTokenBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : "";
  if (isDigit(before) || before === "#") return false;
  if ((before === "." || before === ",") && isDigit(text[start - 2] ?? "")) return false;

  const after = end < text.length ? text[end] : "";
  if (isDigit(after) || after === "%") return false;
  if ((after === "." || after === ",") && isDigit(text[end + 1] ?? "")) return false;

  return true;
}

export function splitByNumbers(text: string, numbers: string[]): TextSegment[] {
  // Kandidat unik, urut TERPANJANG dulu: "4,4%" harus menang atas kandidat lain yang
  // kebetulan menjadi awalannya — pencocokan tak boleh memotong angka jadi sebagian.
  const candidates = [...new Set(numbers)]
    .filter((n) => n.length > 0)
    .sort((a, b) => b.length - a.length);
  if (candidates.length === 0 || text.length === 0) {
    return text.length === 0 ? [] : [{ text, bold: false }];
  }

  const segments: TextSegment[] = [];
  let plainStart = 0;
  let i = 0;
  while (i < text.length) {
    // Kandidat pertama yang cocok DAN berdiri sebagai token utuh. Kandidat yang gagal
    // batas tidak menggugurkan yang lain di posisi sama (mis. "1" ditolak, "1,2k" lolos).
    const match = candidates.find(
      (c) => text.startsWith(c, i) && isTokenBoundary(text, i, i + c.length)
    );
    if (match) {
      if (i > plainStart) {
        segments.push({ text: text.slice(plainStart, i), bold: false });
      }
      segments.push({ text: match, bold: true });
      i += match.length; // tanpa tumpang tindih: lanjut setelah kecocokan
      plainStart = i;
    } else {
      i++;
    }
  }
  if (plainStart < text.length) {
    segments.push({ text: text.slice(plainStart), bold: false });
  }
  return segments;
}
