import type { ExtractionStatus, MetricType, Platform } from "@prisma/client";

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
// konsisten dengan penomoran "Sumber #n" di UI.
export type AnalystSource = {
  sourceIndex: number;
  metrics: AnalystMetric[];
};

export type AnalystInput = {
  sectionName: string;
  platform: Platform;
  kbAnalysis: string;
  sources: AnalystSource[];
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

// Blok angka yang dikirim ke model — hanya bentuk singkat yang boleh dikutip.
function renderSources(sources: AnalystSource[], multiSource: boolean): string {
  return sources
    .map((s) => {
      const lines = s.metrics
        .map((m) => `- ${m.label}: ${m.valueText ?? "tidak tersedia di foto ini"}`)
        .join("\n");
      return multiSource ? `Sumber #${s.sourceIndex}:\n${lines}` : lines;
    })
    .join("\n\n");
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
    `Angka hasil ekstraksi (sudah dikonfirmasi, satu periode):\n` +
    `${renderSources(input.sources, multiSource)}\n\n` +
    `Aturan WAJIB:\n` +
    `1. Pakai HANYA angka yang tertulis di atas, dalam bentuk PERSIS seperti tertulis. ` +
    `DILARANG menghitung apa pun — tanpa penjumlahan, rata-rata, selisih, persentase, rasio, ` +
    `atau angka turunan lain. Perbandingan antar periode/bulan juga DILARANG (belum ada datanya).\n` +
    (multiSource
      ? `2. Ada ${input.sources.length} sumber (foto) TERPISAH. Narasikan tiap sumber sendiri-sendiri ` +
        `dengan menyebut "Sumber #n"; DILARANG menggabungkan, menjumlahkan, atau membandingkan angka ` +
        `antar sumber sebagai satu kesatuan.\n`
      : `2. Semua angka berasal dari satu sumber (foto).\n`) +
    `3. Metrik "tidak tersedia" cukup disebut tidak tersedia — jangan berspekulasi nilainya.\n` +
    `4. Bentuk keluaran: idealnya MAKSIMAL ${TARGET_POINTS} poin — boleh lebih HANYA kalau ` +
    `analisanya memang kaya, dan JANGAN PERNAH lebih dari ${HARD_MAX_POINTS} poin. Tiap poin ` +
    `SATU kalimat ringkas yang mudah di-scan di slide presentasi. JANGAN menulis simbol ` +
    `bullet/nomor di awal poin (tampilan yang memberi bullet). TANPA caption, TANPA judul. ` +
    `Fokus pada apa yang dikatakan angka menurut kerangka KB.`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      // Catatan: structured output TIDAK mendukung maxItems — target lunak dijaga instruksi
      // prompt, atap keras HARD_MAX_POINTS dijaga pemotongan saat parsing.
      points: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["points"],
  } as const;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: instruction }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Analyst: respons model tidak berisi teks.");
  }
  const parsed = JSON.parse(textBlock.text) as { points?: string[] };
  const points = (parsed.points ?? [])
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .slice(0, HARD_MAX_POINTS); // atap keras: kalau model meleset, ambil 8 pertama
  if (points.length === 0) {
    throw new Error("Analyst: model tidak mengembalikan poin insight.");
  }
  return points;
}

// ---- Stub dev (tanpa API key) ----
// Poin deterministik yang memperlihatkan angka singkat per sumber, untuk menguji pipeline.
function analyzeWithStub(input: AnalystInput): string[] {
  const multiSource = input.sources.length > 1;
  return input.sources.slice(0, HARD_MAX_POINTS).map((s) => {
    const nums = s.metrics
      .map((m) => `${m.label} ${m.valueText ?? "tidak tersedia"}`)
      .join(", ");
    return `[DEV STUB]${multiSource ? ` Sumber #${s.sourceIndex}:` : ""} ${nums}.`;
  });
}

// Pilih backend berdasarkan env, sama seperti lib/extractor.ts & lib/storage.ts.
export async function generateInsight(input: AnalystInput): Promise<AnalystOutcome> {
  if (process.env.ANTHROPIC_API_KEY) {
    const points = await analyzeWithClaude(input);
    return { generator: "claude", points };
  }
  return { generator: "stub", points: analyzeWithStub(input) };
}
