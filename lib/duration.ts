// Metrik bertipe DURASI (Jul 2026) — parsing & pembahasaan.
//
// Prinsip #6 tetap berlaku: penyimpanan memakai satuan KANONIK **detik** di
// `Extraction.value` (angka penuh, tanpa singkatan), dan bentuk manusiawi ("1j 23mnt 45dtk")
// HANYA dipakai saat angka dibahasakan (Analyst/PPT/UI). Konversi dilakukan DETERMINISTIK
// di kode — bukan aritmetika LLM (Prinsip #1), sama seperti normalisasi notasi singkatan.
//
// Bentuk yang dibaca dari screenshot (keputusan user, Jul 2026):
//   hh:mm:ss  ·  "... s"  ·  "... min"  ·  "...h...min"
// Ditambah varian Indonesia yang lazim muncul (jam/menit/detik, j/mnt/dtk) supaya
// screenshot berbahasa Indonesia tidak jatuh ke jalur salah.

// Pengali ke DETIK. Urutan kunci di regex di bawah yang menentukan pencocokan,
// bukan urutan objek ini.
const UNIT_SECONDS: Record<string, number> = {
  jam: 3600, jm: 3600, j: 3600,
  hours: 3600, hour: 3600, hrs: 3600, hr: 3600, h: 3600,
  menit: 60, minutes: 60, minute: 60, mins: 60, min: 60, mnt: 60, m: 60,
  detik: 1, seconds: 1, second: 1, secs: 1, sec: 1, dtk: 1, s: 1,
};

// Alternasi SENGAJA diurut dari yang terpanjang: tanpa ini "menit" tercocokkan sebagai
// "m" lalu menyisakan "enit", dan "hours" jadi "h". `(?![a-z])` menutup ekor supaya
// satuan tidak nyangkut di kata lain (mis. "3 sales" tidak terbaca 3 detik).
const UNIT_RE =
  /(\d+(?:[.,]\d+)?)\s*(jam|jm|hours|hour|hrs|hr|j|h|menit|minutes|minute|mins|mnt|min|m|detik|seconds|second|secs|sec|dtk|s)(?![a-z])/gi;

// Buang noise floating-point (pola sama dengan extractor).
function cleanFloat(n: number): number {
  const rounded = Math.round(n);
  return Math.abs(n - rounded) < 1e-6 ? rounded : n;
}

// Angka longgar: koma = desimal (id-ID), titik dianggap pemisah ribuan bila
// memisahkan kelompok 3 digit.
function looseNumber(raw: string): number | null {
  const s = raw.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  let norm: string;
  if (s.includes(",")) {
    norm = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    norm = s.replace(/\./g, "");
  } else {
    norm = s;
  }
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : null;
}

// Teks durasi apa adanya -> DETIK. null = tak ada durasi yang bisa dibaca.
//
// Urutan penentuan sengaja: (1) bentuk titik dua, (2) bentuk bersatuan, (3) angka
// telanjang. Bentuk titik dua didahulukan karena "1:30" bersatuan-implisit dan tak
// boleh jatuh ke jalur angka telanjang.
export function parseDurationToSeconds(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const text = raw.toLowerCase().trim();
  if (text === "") return null;

  // (1) hh:mm:ss atau mm:ss. Dua bagian dibaca MENIT:DETIK — konvensi lazim durasi
  // (mis. "12:30" = 12 menit 30 detik), sedangkan tiga bagian jam:menit:detik.
  const colon = text.match(/(\d{1,4}):([0-5]?\d)(?::([0-5]?\d))?/);
  if (colon) {
    const a = Number(colon[1]);
    const b = Number(colon[2]);
    if (colon[3] !== undefined) return a * 3600 + b * 60 + Number(colon[3]);
    return a * 60 + b;
  }

  // (2) satu atau lebih komponen bersatuan: "45 s", "12 min", "1h 30min", "2j 5mnt 10dtk".
  let total = 0;
  let found = false;
  for (const m of text.matchAll(UNIT_RE)) {
    const n = looseNumber(m[1]);
    const mult = UNIT_SECONDS[m[2].toLowerCase()];
    if (n === null || mult === undefined) continue;
    total += n * mult;
    found = true;
  }
  if (found) return cleanFloat(total);

  // (3) angka telanjang tanpa satuan -> diperlakukan DETIK (satuan kanonik).
  const bare = looseNumber(text);
  return bare === null ? null : cleanFloat(bare);
}

// DETIK -> bentuk manusiawi ringkas Indonesia: "1j 23mnt 45dtk".
// Komponen bernilai 0 dibuang, tapi hasil tidak pernah string kosong ("0dtk").
// Dipakai Analyst/PPT/UI — penyimpanan tetap detik penuh.
export function formatDurationID(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "tidak tersedia";
  const negative = totalSeconds < 0;
  let rest = Math.round(Math.abs(totalSeconds));

  const hours = Math.floor(rest / 3600);
  rest -= hours * 3600;
  const minutes = Math.floor(rest / 60);
  rest -= minutes * 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}j`);
  if (minutes > 0) parts.push(`${minutes}mnt`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest}dtk`);

  return `${negative ? "-" : ""}${parts.join(" ")}`;
}
