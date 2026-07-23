// Deteksi bulan otomatis (Jul 2026) — pemetaan TEKS PERIODE -> bulan kalender.
//
// Pembagian tugas yang disengaja (Prinsip #1): Extractor hanya MENYALIN teks periode yang
// terlihat di screenshot apa adanya (`rawText`), dan file inilah yang memetakannya ke bulan
// — DETERMINISTIK, di kode, bisa diuji penuh. Model tidak pernah menyimpulkan bulan.
//
// Sikap dasarnya KONSERVATIF: kalau teks tidak menunjuk tepat satu bulan kalender dengan
// tahun yang TERLIHAT, hasilnya null — tidak ada autofill, tidak ada peringatan. Menebak
// bulan lebih berbahaya daripada diam: bulan yang salah membuat seluruh report salah label.

export type ParsedPeriod = { month: number; year: number };

// Nama bulan Indonesia & Inggris, termasuk singkatan yang lazim di dashboard.
const MONTH_NAMES: Record<string, number> = {
  januari: 1, january: 1, jan: 1,
  februari: 2, february: 2, pebruari: 2, feb: 2, peb: 2,
  maret: 3, march: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5, may: 5,
  juni: 6, june: 6, jun: 6,
  juli: 7, july: 7, jul: 7,
  agustus: 8, august: 8, agu: 8, agt: 8, ags: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  oktober: 10, october: 10, okt: 10, oct: 10,
  november: 11, nopember: 11, nov: 11, nop: 11,
  desember: 12, december: 12, des: 12, dec: 12,
};

// Alternasi diurut TERPANJANG DULU: tanpa ini "maret" tercocokkan sebagai "mar" dan
// menyisakan "et", "september" jadi "sep", dst.
const MONTH_ALTERNATION = Object.keys(MONTH_NAMES)
  .sort((a, b) => b.length - a.length)
  .join("|");

// Tahun yang masuk akal untuk label report. Dipakai juga sebagai penanda "tahun TERLIHAT".
const YEAR_RE = /\b(?:19|20)\d{2}\b/;

// Label periode RELATIF: tidak menunjuk bulan kalender mana pun. Kalau teksnya relatif DAN
// tidak memuat tahun sama sekali, berhenti di sini. (Kalau tahun ikut tertulis — mis.
// "30 hari terakhir (01/06/2026 - 30/06/2026)" — tanggal eksplisitnya yang dipakai.)
const RELATIVE_RE =
  /(\d+\s*hari\s*(terakhir|lalu)|hari\s*ini|kemarin|minggu\s*(ini|lalu|terakhir)|bulan\s*(ini|lalu|terakhir)|tahun\s*(ini|lalu)|real\s*-?\s*time|last\s*\d+\s*days?|(this|last)\s*(week|month|year)|today|yesterday|\bmtd\b|\bytd\b)/;

// Penanda bagian yang BUKAN periode utama. Dashboard sering menempelkan periode PEMBANDING
// dan waktu pembaruan pada label yang sama; keduanya menyebut bulan lain, dan kalau ikut
// terbaca hasilnya jadi "lintas bulan" -> null (padahal periode utamanya jelas).
// Prompt period-detect juga sudah menyuruh model mengabaikannya — ini lapis kedua di kode,
// karena teks periode juga datang dari jalur ekstraksi yang promptnya lebih umum.
const NOISE_MARKER_RE =
  /(bandingkan|dibandingkan|perbandingan|\bvs\.?\b|compared?\s*(to|with)?\b|diperbarui|pembaruan\s*terakhir|terakhir\s*diperbarui|last\s*updated|updated\s*(on|at)?\b)/;

// Pemisah antar-bagian pada label periode. " / " SENGAJA memakai spasi di kedua sisi:
// garis miring tanpa spasi adalah pemisah tanggal ("01/06/2026") dan tak boleh dipecah.
const SEGMENT_SPLIT_RE = /\s\/\s|[|;·•\n]/;

// Buang bagian pembanding & timestamp pembaruan, sisakan periode utamanya.
// Tiap segmen yang memuat penanda dipangkas TEPAT di penanda itu — jadi
// "Jun 01, 2026 - Jun 30, 2026 Bandingkan May 02, 2026 …" (tanpa pemisah sama sekali)
// tetap menyisakan rentang utamanya.
function stripComparisonNoise(text: string): string {
  return text
    .split(SEGMENT_SPLIT_RE)
    .map((segment) => {
      const hit = NOISE_MARKER_RE.exec(segment);
      return hit ? segment.slice(0, hit.index) : segment;
    })
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .join(" | ");
}

// Teks periode apa adanya -> satu bulan kalender. null = tidak bisa dipastikan.
//
// Aturan (semua diuji):
// - Rentang tanggal dipetakan HANYA bila seluruh tanggalnya jatuh di bulan kalender yang
//   sama. Lintas bulan -> null.
// - Tahun harus TERLIHAT. "Juni" tanpa tahun -> null (jangan mengarang tahun).
// - Teks relatif -> null.
export function parsePeriodText(raw: string | null | undefined): ParsedPeriod | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized === "") return null;
  const text = stripComparisonNoise(normalized);
  if (text === "") return null;
  if (RELATIVE_RE.test(text) && !YEAR_RE.test(text)) return null;

  // Bulan yang DISEBUT di mana pun (dengan atau tanpa tahun) — dipakai untuk mendeteksi
  // rentang lintas bulan. `dated` hanya yang tahunnya ikut terlihat.
  const months = new Set<number>();
  const dated: ParsedPeriod[] = [];

  // Potongan yang sudah dikenali diganti spasi supaya pola yang lebih longgar di bawah
  // tidak mencocokkan ulang sisa-sisanya ("01/06/2026" tak boleh terbaca lagi sbg "06/20").
  let rest = text;
  const consume = (re: RegExp, take: (groups: string[]) => void) => {
    rest = rest.replace(re, (full, ...args) => {
      take(args.slice(0, -2).map((g) => (typeof g === "string" ? g : "")));
      return " ".repeat(full.length);
    });
  };

  const addDated = (month: number, year: number) => {
    if (month < 1 || month > 12) return;
    months.add(month);
    dated.push({ month, year });
  };

  // 1) ISO lengkap: 2026-06-15 / 2026/06/15 / 2026.06.15
  consume(/\b((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, ([y, m, d]) => {
    const day = Number(d);
    if (day >= 1 && day <= 31) addDated(Number(m), Number(y));
  });
  // 2) ISO bulan: 2026-06 / 2026/06 / 2026.06 — titik dipakai Shopee ("Per Bulan 2026.06").
  //    Tahun 4 digit HARUS di depan, jadi ini tak pernah bentrok dengan "15.06.2026".
  consume(/\b((?:19|20)\d{2})[-/.](\d{1,2})\b/g, ([y, m]) => addDated(Number(m), Number(y)));
  // 3) Tanggal Indonesia: 15/06/2026, 15-06-2026, 15.06.2026
  consume(/\b(\d{1,2})[./-](\d{1,2})[./-]((?:19|20)\d{2})\b/g, ([d, m, y]) => {
    const day = Number(d);
    if (day >= 1 && day <= 31) addDated(Number(m), Number(y));
  });
  // 4) Bulan/tahun: 06/2026
  consume(/\b(\d{1,2})[./-]((?:19|20)\d{2})\b/g, ([m, y]) => addDated(Number(m), Number(y)));
  // 5) Tanggal TANPA tahun: "28/05" di "28/05 - 30/06/2026". Tidak pernah jadi jawaban
  //    (tahunnya tak terlihat), TAPI wajib dihitung supaya rentang lintas bulan ketahuan.
  consume(/\b(\d{1,2})[./-](\d{1,2})\b/g, ([d, m]) => {
    const day = Number(d);
    const month = Number(m);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) months.add(month);
  });
  // 6) Gaya Inggris "MMM DD, YYYY": "Jun 01, 2026 - Jun 30, 2026". Didahulukan atas (7)
  //    karena tanggal di TENGAH memisahkan nama bulan dari tahunnya.
  consume(
    new RegExp(`\\b(${MONTH_ALTERNATION})\\b\\.?\\s*(\\d{1,2})\\s*,?\\s*((?:19|20)\\d{2})\\b`, "g"),
    ([name, d, y]) => {
      const day = Number(d);
      if (day >= 1 && day <= 31) addDated(MONTH_NAMES[name], Number(y));
    }
  );
  // 7) Nama bulan + tahun: "Juni 2026", "1 Juni 2026", "Jun 2026"
  consume(
    new RegExp(`\\b(${MONTH_ALTERNATION})\\b[^0-9a-z]{0,3}((?:19|20)\\d{2})\\b`, "g"),
    ([name, y]) => addDated(MONTH_NAMES[name], Number(y))
  );
  // 8) Nama bulan tanpa tahun: "28 Mei" di "28 Mei - 30 Juni 2026" — mention saja.
  consume(new RegExp(`\\b(${MONTH_ALTERNATION})\\b`, "g"), ([name]) => {
    months.add(MONTH_NAMES[name]);
  });

  // Lebih dari satu bulan disebut = rentang lintas bulan (atau teks campur) -> jangan tebak.
  if (months.size !== 1) return null;
  if (dated.length === 0) return null; // bulannya jelas, tahunnya tidak
  const first = dated[0];
  if (dated.some((d) => d.month !== first.month || d.year !== first.year)) return null;
  if (first.year < 2000 || first.year > 2100) return null;
  return first;
}

// {month, year} -> "YYYY-MM" (bentuk kanonik yang sama dengan Upload.periodMonth).
export function toPeriodMonth(p: ParsedPeriod): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

// Dua teks periode menunjuk bulan yang sama? null = salah satu tak bisa dipastikan,
// sehingga TIDAK boleh dianggap beda (pemanggil wajib diam, bukan memperingatkan).
export function samePeriod(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const pa = parsePeriodText(a);
  const pb = parsePeriodText(b);
  if (!pa || !pb) return null;
  return pa.month === pb.month && pa.year === pb.year;
}
