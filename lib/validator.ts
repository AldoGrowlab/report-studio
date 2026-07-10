import type { Platform } from "@prisma/client";
import { HARD_MAX_POINTS, TARGET_POINTS } from "@/lib/analyst";

// Tahap 7a — Validator, peran pertama: MENULIS kesimpulan per platform (DESIGN
// §Validator & Kesimpulan). Membaca SEMUA insight section satu platform lalu merangkumnya
// jadi poin-poin kesimpulan. Cek konsistensi + loop revisi + flag = Tahap 7b, BUKAN di sini.
// PRESISI (Prinsip #1): kesimpulan merangkum NARASI, bukan aritmetika baru — angka hanya
// boleh dikutip persis seperti tertulis di poin insight; dilarang menjumlah/merekonsiliasi
// angka antar section (angka bernama sama bisa beda konteks — DESIGN Prinsip #2).

const MODEL = "claude-opus-4-8";

// Satu section yang sudah punya insight, urut narrativeOrder (urutan cerita).
export type ValidatorSection = {
  sectionName: string;
  points: string[];
};

export type ValidatorInput = {
  platform: Platform;
  reportPeriod: string;
  kbGeneral: string; // KB general/merangkai — boleh kosong
  kbConclusion: string; // KB kesimpulan — boleh kosong
  sections: ValidatorSection[];
};

export type ValidatorOutcome = {
  generator: "claude" | "stub";
  points: string[];
};

function renderSections(sections: ValidatorSection[]): string {
  return sections
    .map((s) => `Section "${s.sectionName}":\n${s.points.map((p) => `- ${p}`).join("\n")}`)
    .join("\n\n");
}

const KB_EMPTY = "(belum diisi — pakai penilaian umum merangkum yang baik)";

// ---- Claude Opus 4.8 (structured output, pola sama dgn lib/analyst.ts) ----
async function concludeWithClaude(input: ValidatorInput): Promise<string[]> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // membaca ANTHROPIC_API_KEY dari env

  const platformLabel = input.platform === "shopee" ? "Shopee" : "TikTok";

  const instruction =
    `Kamu Narrative Validator report performa online shop. Di hadapanmu SEMUA insight ` +
    `section platform ${platformLabel} untuk report periode "${input.reportPeriod}". ` +
    `Tulis slide KESIMPULAN platform ${platformLabel} berbahasa Indonesia, berupa ` +
    `POIN-POIN yang merangkum insight-insight itu jadi satu cerita utuh.\n\n` +
    `KB general/merangkai (cara section dirangkai jadi cerita sesuai gaya agency):\n` +
    `${input.kbGeneral.trim() || KB_EMPTY}\n\n` +
    `KB kesimpulan (cara menulis slide kesimpulan yang baik):\n` +
    `${input.kbConclusion.trim() || KB_EMPTY}\n\n` +
    `Insight per section (urut alur cerita report):\n` +
    `${renderSections(input.sections)}\n\n` +
    `Aturan WAJIB:\n` +
    `1. Kesimpulan merangkum NARASI, bukan membuat aritmetika baru. Angka HANYA boleh ` +
    `dikutip PERSIS seperti tertulis di poin insight di atas. DILARANG menghitung apa pun — ` +
    `tanpa penjumlahan, total, rata-rata, selisih, persentase, atau angka turunan lain.\n` +
    `2. DILARANG menggabungkan/merekonsiliasi angka antar section — angka bernama sama ` +
    `(mis. GMV) di section berbeda bisa punya konteks/filter berbeda dan itu sah.\n` +
    `3. HANYA platform ${platformLabel}. DILARANG menyebut atau membandingkan dengan ` +
    `platform lain.\n` +
    `4. Bentuk keluaran: idealnya MAKSIMAL ${TARGET_POINTS} poin — boleh lebih HANYA kalau ` +
    `rangkumannya memang kaya, dan JANGAN PERNAH lebih dari ${HARD_MAX_POINTS} poin. Tiap ` +
    `poin SATU kalimat ringkas yang mudah di-scan di slide presentasi. JANGAN menulis ` +
    `simbol bullet/nomor di awal poin (tampilan yang memberi bullet). TANPA judul.\n` +
    `5. Rangkai lintas-section: angkat benang merah, kekuatan, dan perhatian utama — ` +
    `bukan mengulang tiap insight satu-satu.`;

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
    throw new Error("Validator: respons model tidak berisi teks.");
  }
  const parsed = JSON.parse(textBlock.text) as { points?: string[] };
  const points = (parsed.points ?? [])
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .slice(0, HARD_MAX_POINTS); // atap keras: kalau model meleset, ambil 8 pertama
  if (points.length === 0) {
    throw new Error("Validator: model tidak mengembalikan poin kesimpulan.");
  }
  return points;
}

// ---- Stub dev (tanpa API key) ----
// Satu poin per section (dipotong atap keras) yang mengutip poin pertama insight-nya,
// untuk menguji pipeline + bold deterministik tanpa API.
function concludeWithStub(input: ValidatorInput): string[] {
  return input.sections.slice(0, HARD_MAX_POINTS).map(
    (s) => `[DEV STUB] Rangkuman "${s.sectionName}": ${s.points[0] ?? "(tanpa poin)"}`
  );
}

// Pilih backend berdasarkan env, sama seperti lib/analyst.ts & lib/extractor.ts.
export async function generateConclusion(input: ValidatorInput): Promise<ValidatorOutcome> {
  if (process.env.ANTHROPIC_API_KEY) {
    const points = await concludeWithClaude(input);
    return { generator: "claude", points };
  }
  return { generator: "stub", points: concludeWithStub(input) };
}
