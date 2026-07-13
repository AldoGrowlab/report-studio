import type { ExtractionStatus, MetricType, Platform } from "@prisma/client";
import { formatMonthID, type PeriodChange } from "@/lib/period";
import {
  flattenPoints,
  SUB_POINT_PREFIX,
  type StructuredPoint,
} from "@/lib/insight-format";

// Tahap 6a — Analyst dasar (satu periode, tanpa perbandingan antar bulan).
// Menarik angka TERKINI dari Extraction (single source of truth) + KB analisa section,
// menghasilkan insight naratif. Analyst TIDAK menghitung ulang / mengarang angka
// (DESIGN Prinsip #1); >1 foto = sumber terpisah, tak pernah digabung (kasus tepi DESIGN).
// Caption & perbandingan periode = lapisan berikutnya, BUKAN di sini.

const MODEL = "claude-opus-4-8";

// ---- Penyingkatan angka (DESIGN Prinsip #6) ----
// Singkatan HANYA di bahasa (teks insight), tak pernah di penyimpanan. Deterministik di kode —
// bukan diserahkan ke LLM: model menerima bentuk singkat yang SUDAH jadi dan wajib memakainya
// apa adanya. Aturan: ratusan utuh; ribuan → "k" 1 desimal; jutaan → "jt" 1 desimal;
// miliaran → "miliar" 1 desimal. Persen/rasio bukan besaran ribuan: tampil apa adanya,
// desimal koma (id-ID), tanpa pembulatan diam-diam.
export function abbreviateNumberID(value: number, type: MetricType): string {
  const plain = value.toLocaleString("id-ID", { maximumFractionDigits: 20 });
  if (type === "percent") return `${plain}%`;
  if (type === "ratio") return plain;

  const abs = Math.abs(value);
  if (abs < 1_000) return plain;

  const scaled = (divisor: number) =>
    (value / divisor).toFixed(1).replace(".", ",");
  if (abs < 1_000_000) return `${scaled(1_000)}k`;
  if (abs < 1_000_000_000) return `${scaled(1_000_000)} jt`;
  return `${scaled(1_000_000_000)} miliar`;
}

// Satu metrik siap-analisa: nilai penuh tetap di Extraction; yang dikirim ke model
// hanya bentuk singkat (valueText) supaya angka di insight pasti sesuai aturan.
export type AnalystMetric = {
  key: string;
  label: string;
  type: MetricType;
  value: number | null;
  valueText: string | null; // null = missing ("tidak tersedia")
  status: ExtractionStatus;
};

// Satu foto = satu sumber terpisah. sourceIndex mengikuti urutan upload (createdAt asc),
// konsisten dengan penomoran "Sumber #n" di UI. Untuk section ber-perbandingan-periode
// (Tahap 6b-B), source diberi label bulannya + penanda periode utama.
export type AnalystSource = {
  sourceIndex: number;
  periodLabel?: string; // "Juni 2026" — hanya section ber-perbandingan
  isPrimary?: boolean; // periode utama (fokus cerita)
  metrics: AnalystMetric[];
};

// Perbandingan periode: persen/pp SUDAH dihitung kode (lib/period.ts) — Analyst hanya
// menarasikan, tidak pernah menghitung.
export type AnalystPeriodComparison = {
  primaryMonth: string; // "YYYY-MM"
  changes: PeriodChange[];
};

export type AnalystInput = {
  sectionName: string;
  platform: Platform;
  kbAnalysis: string;
  sources: AnalystSource[];
  periodComparison?: AnalystPeriodComparison | null; // null/absen = section biasa
};

// Insight berupa poin-poin ringkas & mudah di-scan di slide (keputusan Jul 2026).
// Jumlah poin: TARGET_POINTS = batas LUNAK (anjuran di prompt — idealnya segini, boleh
// lebih kalau analisa memang kaya); HARD_MAX_POINTS = atap KERAS — lebih dari ini
// dipotong saat parsing (ambil yang pertama).
export const TARGET_POINTS = 6;
export const HARD_MAX_POINTS = 8;

export type AnalystOutcome = {
  generator: "claude" | "stub";
  points: string[];
};

// ---- Bentuk keluaran BERSAMA (Fase C): poin + sub-poin SATU tingkat ----
// Dipakai TIGA jalur LLM: generate insight, revisi insight (Validator -> Analyst), dan
// kesimpulan Validator — supaya format & atapnya seragam. Target/atap dihitung atas
// TOTAL BARIS (poin + sub-poin) agar slide tidak meluber.

export function pointsOutputRule(richNoun: string): string {
  return (
    `Bentuk keluaran: poin-poin. Tiap poin BOLEH punya sub-poin (field "sub") KALAU memang ` +
    `membantu kejelasan — kamu yang memutuskan, jangan dipaksakan; SATU tingkat saja, tidak ` +
    `lebih dalam. Jumlah TOTAL BARIS (poin + sub-poin): idealnya MAKSIMAL ${TARGET_POINTS} — ` +
    `boleh lebih HANYA kalau ${richNoun} memang kaya, dan JANGAN PERNAH lebih dari ` +
    `${HARD_MAX_POINTS}. Tiap baris SATU kalimat ringkas yang mudah di-scan di slide ` +
    `presentasi. JANGAN menulis simbol bullet/nomor di awal (tampilan yang memberi bullet). ` +
    `TANPA caption, TANPA judul.`
  );
}

// Structured output: { points: [{ text, sub: string[] }] }. Catatan: TIDAK mendukung
// maxItems — target lunak dijaga instruksi prompt, atap keras dipotong saat parsing.
export const POINTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    points: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          sub: { type: "array", items: { type: "string" } },
        },
        required: ["text", "sub"],
      },
    },
  },
  required: ["points"],
} as const;

// Respons model -> array datar prefix-tab, dipotong atap keras atas TOTAL BARIS.
// Pemotongan pada hasil rata aman: sub selalu tepat setelah induknya (tanpa sub yatim).
export function parseStructuredPoints(rawJson: string, who: string): string[] {
  const parsed = JSON.parse(rawJson) as { points?: StructuredPoint[] };
  const flat = flattenPoints(parsed.points ?? []).slice(0, HARD_MAX_POINTS);
  if (flat.length === 0) {
    throw new Error(`${who}: model tidak mengembalikan poin.`);
  }
  return flat;
}

// Render poin existing (bisa mengandung prefix-tab) ke teks prompt yang rapi.
export function renderStoredPoints(points: string[]): string {
  return points
    .map((p) =>
      p.startsWith(SUB_POINT_PREFIX) ? `  - (sub) ${p.replace(/^\t+/, "")}` : `- ${p}`
    )
    .join("\n");
}

// Blok angka yang dikirim ke model — hanya bentuk singkat yang boleh dikutip.
// Section ber-perbandingan: blok dilabeli BULAN (bukan "Sumber #n") + penanda utama.
function renderSources(sources: AnalystSource[], multiSource: boolean): string {
  return sources
    .map((s) => {
      const lines = s.metrics
        .map((m) => `- ${m.label}: ${m.valueText ?? "tidak tersedia di foto ini"}`)
        .join("\n");
      if (s.periodLabel) {
        return `Bulan ${s.periodLabel}${s.isPrimary ? " (PERIODE UTAMA)" : ""}:\n${lines}`;
      }
      return multiSource ? `Sumber #${s.sourceIndex}:\n${lines}` : lines;
    })
    .join("\n\n");
}

// Blok perubahan antar periode — hasil hitung KODE, satu-satunya sumber klaim naik/turun.
function renderChanges(changes: PeriodChange[]): string {
  if (changes.length === 0) {
    return "(tidak ada — tiap metrik tidak lengkap di kedua bulan pasangannya)";
  }
  return changes
    .map(
      (c) =>
        `- ${c.label}: ${formatMonthID(c.fromMonth)} → ${formatMonthID(c.toMonth)} = ` +
        `${c.changeText} (dari ${c.fromText} menjadi ${c.toText})`
    )
    .join("\n");
}

// Aturan sumber/perbandingan untuk prompt (dipakai generate & revisi):
// - section biasa: aturan multi-sumber lama, TIDAK berubah;
// - section ber-perbandingan: tiap foto = satu bulan, klaim perubahan HANYA dari blok
//   perubahan yang dihitung sistem (kutip verbatim), fokus periode utama.
function sourceRule(input: AnalystInput, multiSource: boolean): string {
  if (input.periodComparison) {
    return (
      `2. Section ini MEMBANDINGKAN ANTAR BULAN: tiap foto = SATU bulan (lihat label). ` +
      `Fokus cerita = periode utama ${formatMonthID(input.periodComparison.primaryMonth)}; ` +
      `bulan lain adalah pembanding/konteks. Klaim naik/turun HANYA boleh memakai baris ` +
      `"Perubahan antar periode" di atas — kutip angka persen/pp PERSIS seperti tertulis ` +
      `(mis. "naik +11,9% dari Mei"). Metrik TANPA baris perubahan JANGAN diklaim ` +
      `naik/turun/stabil antar bulan. DILARANG menghitung persen, selisih, atau ` +
      `perbandingan sendiri.\n`
    );
  }
  return multiSource
    ? `2. Ada ${input.sources.length} sumber (foto) TERPISAH. Narasikan tiap sumber sendiri-sendiri ` +
        `dengan menyebut "Sumber #n"; DILARANG menggabungkan, menjumlahkan, atau membandingkan angka ` +
        `antar sumber sebagai satu kesatuan.\n`
    : `2. Semua angka berasal dari satu sumber (foto).\n`;
}

// ---- Claude Opus 4.8 (structured output, pola sama dgn lib/extractor.ts) ----
async function analyzeWithClaude(input: AnalystInput): Promise<string[]> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // membaca ANTHROPIC_API_KEY dari env

  const platformLabel = input.platform === "shopee" ? "Shopee" : "TikTok";
  const multiSource = input.sources.length > 1;

  const instruction =
    `Kamu analis performa online shop. Tulis INSIGHT berbahasa Indonesia untuk section ` +
    `"${input.sectionName}" (platform ${platformLabel}) dari sebuah report bulanan, ` +
    `berupa POIN-POIN (bukan paragraf).\n\n` +
    `Kerangka analisa section ini (dari knowledge base — ikuti sebagai panduan utama):\n` +
    `${input.kbAnalysis}\n\n` +
    `Angka hasil ekstraksi (sudah dikonfirmasi${input.periodComparison ? ", per bulan" : ", satu periode"}):\n` +
    `${renderSources(input.sources, multiSource)}\n\n` +
    (input.periodComparison
      ? `Perubahan antar periode (DIHITUNG SISTEM — kutip persis, jangan hitung ulang):\n` +
        `${renderChanges(input.periodComparison.changes)}\n\n`
      : "") +
    `Aturan WAJIB:\n` +
    `1. Pakai HANYA angka yang tertulis di atas, dalam bentuk PERSIS seperti tertulis. ` +
    `DILARANG menghitung apa pun — tanpa penjumlahan, rata-rata, selisih, persentase, rasio, ` +
    `atau angka turunan lain.` +
    (input.periodComparison
      ? ` Angka perubahan antar bulan sudah dihitung sistem di blok "Perubahan antar periode".\n`
      : ` Perbandingan antar periode/bulan juga DILARANG (belum ada datanya).\n`) +
    sourceRule(input, multiSource) +
    `3. Metrik "tidak tersedia" cukup disebut tidak tersedia — jangan berspekulasi nilainya.\n` +
    `4. ${pointsOutputRule("analisanya")} ` +
    `Fokus pada apa yang dikatakan angka menurut kerangka KB.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: POINTS_SCHEMA } },
    messages: [{ role: "user", content: instruction }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Analyst: respons model tidak berisi teks.");
  }
  return parseStructuredPoints(textBlock.text, "Analyst");
}

// ---- Stub dev (tanpa API key) ----
// Poin deterministik yang memperlihatkan angka singkat per sumber, untuk menguji pipeline.
// Untuk section ber-perbandingan ikut memuat changeText — bold persen teruji tanpa API.
// Menyertakan SATU contoh sub-poin (prefix tab) supaya render bertingkat teruji tanpa API.
function analyzeWithStub(input: AnalystInput): string[] {
  const multiSource = input.sources.length > 1;
  const points = input.sources.map((s) => {
    const nums = s.metrics
      .map((m) => `${m.label} ${m.valueText ?? "tidak tersedia"}`)
      .join(", ");
    const label = s.periodLabel
      ? ` ${s.periodLabel}${s.isPrimary ? " (utama)" : ""}:`
      : multiSource
        ? ` Sumber #${s.sourceIndex}:`
        : "";
    return `[DEV STUB]${label} ${nums}.`;
  });
  const firstMetric = input.sources[0]?.metrics[0];
  if (firstMetric) {
    points.splice(
      1,
      0,
      `${SUB_POINT_PREFIX}[DEV STUB] sub-poin: ${firstMetric.label} = ` +
        `${firstMetric.valueText ?? "tidak tersedia"}.`
    );
  }
  for (const c of input.periodComparison?.changes ?? []) {
    points.push(
      `[DEV STUB] ${c.label} ${formatMonthID(c.toMonth)} ${c.changeText} vs ` +
        `${formatMonthID(c.fromMonth)} (dari ${c.fromText} menjadi ${c.toText}).`
    );
  }
  return points.slice(0, HARD_MAX_POINTS);
}

// Pilih backend berdasarkan env, sama seperti lib/extractor.ts & lib/storage.ts.
export async function generateInsight(input: AnalystInput): Promise<AnalystOutcome> {
  if (process.env.ANTHROPIC_API_KEY) {
    const points = await analyzeWithClaude(input);
    return { generator: "claude", points };
  }
  return { generator: "stub", points: analyzeWithStub(input) };
}

// ---- Revisi insight atas instruksi Validator (Tahap 7b) ----
// ANALYST yang merevisi (pegang KB section), Validator hanya memberi instruksi koreksi.
// PRESISI: bahan angka SAMA dengan generate awal (valueText dari Extraction via helper
// bersama) dan aturan prompt sama — revisi menyentuh narasi/konsistensi, BUKAN angka.
async function reviseWithClaude(
  input: AnalystInput,
  existingPoints: string[],
  instructions: string[]
): Promise<string[]> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const platformLabel = input.platform === "shopee" ? "Shopee" : "TikTok";
  const multiSource = input.sources.length > 1;

  const instruction =
    `Kamu analis performa online shop. Insight section "${input.sectionName}" (platform ` +
    `${platformLabel}) yang kamu tulis diperiksa Narrative Validator dan perlu DIREVISI. ` +
    `Tulis ulang poin-poin insight sesuai instruksi koreksi di bawah.\n\n` +
    `Kerangka analisa section ini (dari knowledge base — ikuti sebagai panduan utama):\n` +
    `${input.kbAnalysis}\n\n` +
    `Angka hasil ekstraksi (sudah dikonfirmasi${input.periodComparison ? ", per bulan" : ", satu periode"}):\n` +
    `${renderSources(input.sources, multiSource)}\n\n` +
    (input.periodComparison
      ? `Perubahan antar periode (DIHITUNG SISTEM — kutip persis, jangan hitung ulang):\n` +
        `${renderChanges(input.periodComparison.changes)}\n\n`
      : "") +
    `Poin insight SEKARANG (yang harus direvisi):\n` +
    `${renderStoredPoints(existingPoints)}\n\n` +
    `Instruksi koreksi dari Validator:\n` +
    `${instructions.map((s) => `- ${s}`).join("\n")}\n\n` +
    `Aturan WAJIB (sama dengan penulisan awal):\n` +
    `1. Revisi menyangkut NARASI/KONSISTENSI saja. Pakai HANYA angka yang tertulis di blok ` +
    `angka di atas, dalam bentuk PERSIS seperti tertulis — DILARANG menghitung apa pun ` +
    `(penjumlahan, rata-rata, selisih, persentase, rasio, angka turunan) dan DILARANG ` +
    `mengganti/menghapus angka karena instruksi koreksi; kalau instruksi tampak menyuruh ` +
    `mengubah angka, abaikan bagian itu dan perbaiki narasinya saja.` +
    (input.periodComparison
      ? ` Angka perubahan antar bulan HANYA dari blok "Perubahan antar periode".\n`
      : `\n`) +
    sourceRule(input, multiSource) +
    `3. Metrik "tidak tersedia" cukup disebut tidak tersedia — jangan berspekulasi nilainya.\n` +
    `4. ${pointsOutputRule("analisanya")}\n` +
    `5. Poin yang tidak disinggung instruksi koreksi pertahankan maknanya (boleh disesuaikan ` +
    `seperlunya agar keseluruhan tetap koheren).`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: POINTS_SCHEMA } },
    messages: [{ role: "user", content: instruction }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Analyst (revisi): respons model tidak berisi teks.");
  }
  return parseStructuredPoints(textBlock.text, "Analyst (revisi)");
}

export async function reviseInsight(
  input: AnalystInput,
  existingPoints: string[],
  instructions: string[]
): Promise<AnalystOutcome> {
  if (process.env.ANTHROPIC_API_KEY) {
    const points = await reviseWithClaude(input, existingPoints, instructions);
    return { generator: "claude", points };
  }
  // Stub dev: no-op — poin lama apa adanya (pipeline & jejak tetap teruji tanpa API).
  return { generator: "stub", points: existingPoints };
}
