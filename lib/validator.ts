import type { Platform } from "@prisma/client";
import {
  HARD_MAX_POINTS,
  parseStructuredPoints,
  POINTS_SCHEMA,
  pointsOutputRule,
  renderStoredPoints,
} from "@/lib/analyst";
import { llmBackend } from "@/lib/llm";

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
    .map((s) => `Section "${s.sectionName}":\n${renderStoredPoints(s.points)}`)
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
    `4. ${pointsOutputRule("rangkumannya")}\n` +
    `5. Rangkai lintas-section: angkat benang merah, kekuatan, dan perhatian utama — ` +
    `bukan mengulang tiap insight satu-satu.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: POINTS_SCHEMA } },
    messages: [{ role: "user", content: instruction }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Validator: respons model tidak berisi teks.");
  }
  return parseStructuredPoints(textBlock.text, "Validator");
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
  if (llmBackend() === "claude") {
    const points = await concludeWithClaude(input);
    return { generator: "claude", points };
  }
  return { generator: "stub", points: concludeWithStub(input) };
}

// ---- Cek konsistensi antar-insight (Tahap 7b) ----
// HANYA dua jenis cek, keduanya TANPA KB (penilaian koherensi umum — DESIGN §Validator &
// Kesimpulan: "cek logika/kontradiksi = instruksi bawaan, TANPA KB"):
//   kontradiksi — dua insight yang bertentangan secara logika;
//   tone        — nada loncat-loncat antar section tanpa alasan.
// Cek konsistensi-GAYA (butuh KB general) DITUNDA. Validator TIDAK menulis ulang —
// tiap temuan menunjuk SATU section + instruksi koreksi untuk dieksekusi Analyst.

export type ConsistencyIssueKind = "kontradiksi" | "tone";

export type ConsistencyIssue = {
  sectionIndex: number; // indeks pada input.sections (bukan id — model tak lihat id)
  kind: ConsistencyIssueKind;
  finding: string; // inkonsistensi yang ditemukan (alasan revisi — disimpan di jejak)
  instruction: string; // instruksi koreksi untuk Analyst (bukan tulisan pengganti)
};

export type ConsistencyInput = {
  platform: Platform;
  sections: ValidatorSection[]; // urut narrativeOrder, indeks = sectionIndex
};

export type ConsistencyOutcome = {
  generator: "claude" | "stub";
  issues: ConsistencyIssue[];
};

async function checkWithClaude(input: ConsistencyInput): Promise<ConsistencyIssue[]> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const platformLabel = input.platform === "shopee" ? "Shopee" : "TikTok";
  const numbered = input.sections
    .map((s, i) => `Section ${i} — "${s.sectionName}":\n${renderStoredPoints(s.points)}`)
    .join("\n\n");

  const instruction =
    `Kamu Narrative Validator report performa online shop. Periksa KONSISTENSI antar-insight ` +
    `section platform ${platformLabel} berikut.\n\n${numbered}\n\n` +
    `Periksa HANYA dua jenis masalah ini:\n` +
    `1. "kontradiksi" — dua insight yang bertentangan secara logika (mis. satu section bilang ` +
    `sebuah hal naik/kuat, section lain bilang hal yang sama turun/lemah tanpa penjelasan).\n` +
    `2. "tone" — nada antar section loncat-loncat tanpa alasan (mis. satu section sangat ` +
    `optimis, section lain sangat pesimis padahal datanya sejalan).\n\n` +
    `Aturan WAJIB:\n` +
    `a. JANGAN memeriksa hal lain: gaya penulisan, panjang kalimat, pilihan kata, kelengkapan ` +
    `analisa, atau kebenaran angka BUKAN urusanmu di pemeriksaan ini.\n` +
    `b. Angka bernama sama di section berbeda (mis. GMV) BOLEH berbeda nilainya — konteks/` +
    `filternya beda dan itu SAH, BUKAN kontradiksi. Kontradiksi adalah pertentangan KLAIM/` +
    `NARASI, bukan perbedaan angka.\n` +
    `c. Untuk tiap masalah, tunjuk SATU section (sectionIndex) yang insight-nya paling tepat ` +
    `dikoreksi, tulis "finding" (uraian singkat inkonsistensinya) dan "instruction" (instruksi ` +
    `koreksi untuk analis section itu). Kamu TIDAK menulis ulang insight — analis yang merevisi.\n` +
    `d. Instruksi koreksi HANYA boleh menyangkut narasi/tone — DILARANG menyuruh mengubah, ` +
    `menambah, menghapus, atau menghitung ulang angka apa pun.\n` +
    `e. Kalau tidak ada masalah, kembalikan issues kosong. Jangan mengada-ada masalah kecil — ` +
    `hanya inkonsistensi yang nyata mengganggu kesatuan cerita.`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sectionIndex: { type: "integer" },
            kind: { type: "string", enum: ["kontradiksi", "tone"] },
            finding: { type: "string" },
            instruction: { type: "string" },
          },
          required: ["sectionIndex", "kind", "finding", "instruction"],
        },
      },
    },
    required: ["issues"],
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
    throw new Error("Validator (cek konsistensi): respons model tidak berisi teks.");
  }
  const parsed = JSON.parse(textBlock.text) as { issues?: ConsistencyIssue[] };
  // Buang temuan yang menunjuk section di luar daftar (model meleset) — lebih baik
  // kehilangan satu temuan daripada merevisi section yang salah.
  return (parsed.issues ?? []).filter(
    (i) =>
      Number.isInteger(i.sectionIndex) &&
      i.sectionIndex >= 0 &&
      i.sectionIndex < input.sections.length &&
      (i.kind === "kontradiksi" || i.kind === "tone") &&
      typeof i.finding === "string" &&
      typeof i.instruction === "string"
  );
}

export async function checkConsistency(
  input: ConsistencyInput
): Promise<ConsistencyOutcome> {
  if (llmBackend() === "claude") {
    const issues = await checkWithClaude(input);
    return { generator: "claude", issues };
  }
  // Stub dev: selalu konsisten — alur lolos tanpa revisi/flag, pipeline tetap teruji.
  return { generator: "stub", issues: [] };
}
