import sharp from "sharp";
import { anthropicClient, llmBackend, LLM_MAX_TOKENS } from "@/lib/llm";
import { MAX_MERGE_FILES, MIN_MERGE_FILES, type MergeDirection } from "@/lib/merge-images";
import {
  ANALYSIS_MAX_PX,
  sanitizeSuggestion,
  type MergeSuggestion,
  type PhotoSuggestion,
} from "@/lib/merge-suggest";

// Auto-potong (AI) — bagian SERVER-ONLY: pengecilan gambar (sharp) + panggilan model.
// Dipisah dari lib/merge-suggest.ts yang MURNI supaya modal client bisa memakai kontrak &
// helper-nya tanpa menyeret sharp/SDK Anthropic ke bundle browser.

const MODEL = "claude-opus-4-8";

const NO_SUGGESTION: PhotoSuggestion = { trimTop: 0, trimBottom: 0, trimLeft: 0, trimRight: 0 };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    direction: { type: "string", enum: ["vertical", "horizontal"] },
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          trimTop: { type: "number" },
          trimBottom: { type: "number" },
          trimLeft: { type: "number" },
          trimRight: { type: "number" },
        },
        required: ["trimTop", "trimBottom", "trimLeft", "trimRight"],
      },
    },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["direction", "photos", "confidence", "reason"],
} as const;

function buildInstruction(count: number, hint?: MergeDirection): string {
  return (
    `Ada ${count} foto (urut #1..#${count}) yang merupakan potongan SATU tampilan dashboard ` +
    `yang sama. Tentukan arah sambung — "vertical" untuk potongan atas-bawah / kartu ` +
    `carousel, "horizontal" untuk potongan kiri-kanan — dan bagian mana dari tiap foto yang ` +
    `DUPLIKAT terhadap foto lain: header halaman yang terulang, grafik yang sama muncul ` +
    `lagi, kolom tabel beku/frozen yang terulang, kolom metrik yang muncul di kedua foto.\n\n` +
    `Kembalikan fraksi trim per sisi (0..0,7 dari dimensi foto itu) sehingga setelah dipotong ` +
    `dan disambung berurutan:\n` +
    `1. TIDAK ada elemen yang tampil dua kali;\n` +
    `2. GABUNGAN semua bagian tersisa memuat SEMUA elemen unik — DILARANG membuang kartu ` +
    `metrik, kolom, atau baris yang hanya ada di satu foto;\n` +
    `3. untuk "horizontal", sisi yang memuat kolom nama/label DIPERTAHANKAN pada foto ` +
    `pertama (yang dibuang adalah salinannya di foto berikutnya).\n\n` +
    `Kalau ragu — termasuk kalau foto-foto ini ternyata BUKAN potongan dari satu tampilan ` +
    `yang sama — kembalikan semua trim 0 dan confidence rendah. Lebih baik hasilnya dobel ` +
    `daripada ada data yang terbuang.\n\n` +
    (hint ? `Dugaan awal operator: arah "${hint}" (boleh kamu koreksi).\n\n` : "") +
    `confidence = 0..1, seberapa yakin kamu. reason = SATU kalimat bahasa Indonesia.`
  );
}

// Kecilkan untuk analisis saja. Fraksi hasilnya berlaku ke resolusi asli di client, jadi
// pengecilan di sini tidak pernah menurunkan kualitas file yang benar-benar diunggah.
async function toAnalysisJpeg(bytes: Buffer): Promise<string> {
  const out = await sharp(bytes)
    .resize({
      width: ANALYSIS_MAX_PX,
      height: ANALYSIS_MAX_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  return out.toString("base64");
}

export async function suggestMergeTrims(
  photos: Buffer[],
  hint?: MergeDirection
): Promise<MergeSuggestion> {
  if (photos.length < MIN_MERGE_FILES || photos.length > MAX_MERGE_FILES) {
    throw new Error(`Kirim ${MIN_MERGE_FILES}–${MAX_MERGE_FILES} foto.`);
  }

  // Tanpa API key (dev): JANGAN mengarang potongan. Kembalikan "tanpa potong" +
  // confidence 0 — operator menggeser garis potongnya sendiri, seperti sebelum fitur ini.
  if (llmBackend() !== "claude") {
    return {
      direction: hint ?? "vertical",
      photos: photos.map(() => ({ ...NO_SUGGESTION })),
      confidence: 0,
      reason: "[DEV STUB] tanpa API key — saran otomatis tidak tersedia.",
    };
  }

  const encoded = await Promise.all(photos.map(toAnalysisJpeg));
  const client = await anthropicClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: LLM_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          ...encoded.flatMap((data, i) => [
            { type: "text" as const, text: `Foto #${i + 1}:` },
            {
              type: "image" as const,
              source: { type: "base64" as const, media_type: "image/jpeg" as const, data },
            },
          ]),
          { type: "text" as const, text: buildInstruction(photos.length, hint) },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Auto-potong: respons model tidak berisi teks.");
  }
  return sanitizeSuggestion(JSON.parse(textBlock.text), photos.length, hint);
}
