// Pecah teks poin insight menjadi segmen normal/bold secara DETERMINISTIK, berdasarkan
// kosakata angka singkat (Insight.numbers — snapshot valueText yang dikirim ke model saat
// generate). TANPA penanda markdown dari LLM: bold adalah properti segmen yang dihitung
// kode, jadi tidak bisa "rusak" (lupa tutup, salah posisi). Angka yang ditulis model
// menyimpang dari kosakata otomatis TIDAK di-bold — terlihat, bukan bold nyasar.
// Dipakai renderer PPT (lib/ppt.ts) dan panel web (UploadManager) supaya konsisten.

export type TextSegment = { text: string; bold: boolean };

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
    const match = candidates.find((c) => text.startsWith(c, i));
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
