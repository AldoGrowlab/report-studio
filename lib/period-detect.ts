import sharp from "sharp";
import { anthropicClient, llmBackend, LLM_MAX_TOKENS } from "@/lib/llm";
import { ANALYSIS_MAX_PX } from "@/lib/merge-suggest";

// Deteksi Bulan Otomatis — jalur PENGISI LABEL (Jul 2026), server-only.
//
// Dipanggil saat operator MEMILIH foto, sebelum/selagi unggah, supaya dropdown "bulan foto
// ini" sudah terisi begitu barisnya muncul. Tugas modelnya sesempit mungkin: menyalin SATU
// label periode apa adanya. Pemetaan teks -> bulan tetap dikerjakan parser DETERMINISTIK
// lib/period-parser.ts (Prinsip #1) — file ini tidak pernah menyimpulkan bulan.
//
// Jalur KEDUA (pembanding) tetap ada dan tidak diubah: field detectedPeriod pada panggilan
// ekstraksi utama, yang dipakai guard salah-bulan Validator. Lihat docs/DESIGN.md.

// Tugasnya membaca satu label pendek dan dipanggil SEKALI PER FOTO YANG DIPILIH, jadi
// default-nya tier hemat — bukan model yang sama dengan Extractor/merge-suggest.
// Bisa ditimpa lewat env tanpa menyentuh kode bila akurasinya kurang.
const MODEL = process.env.PERIOD_DETECT_MODEL ?? "claude-haiku-4-5-20251001";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { rawText: { type: ["string", "null"] } },
  required: ["rawText"],
} as const;

const INSTRUCTION =
  `Salin teks PERIODE DATA UTAMA yang tampak pada screenshot dashboard ini, PERSIS ` +
  `sebagaimana tertulis (mis. "01/06/2026 - 30/06/2026", "Periode Data Per Bulan 2026.06 ` +
  `(GMT+07)", "Jun 01, 2026 - Jun 30, 2026").\n\n` +
  `ABAIKAN:\n` +
  `- periode PEMBANDING — yang berlabel "Bandingkan", "vs", atau rentang KEDUA yang ` +
  `muncul setelah rentang utama;\n` +
  `- timestamp PEMBARUAN — "Diperbarui pada", "Data diperbarui", atau tanggal tunggal ` +
  `yang disertai jam.\n\n` +
  `Kalau tidak ada periode utama yang terlihat, isi null. JANGAN menebak, JANGAN ` +
  `menyimpulkan bulannya sendiri, JANGAN merapikan formatnya — cukup salin teksnya.`;

// Foto dikecilkan dulu: yang dibaca hanya satu label pendek, bukan angka metrik.
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

// Teks periode APA ADANYA dari satu foto. null = tak ada / tak terbaca.
export async function detectPeriodText(photo: Buffer): Promise<string | null> {
  // Tanpa API key (dev): JANGAN mengarang periode — label bulan yang salah diam-diam
  // jauh lebih berbahaya daripada dropdown yang dibiarkan kosong.
  if (llmBackend() !== "claude") return null;

  const client = await anthropicClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: LLM_MAX_TOKENS,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: await toAnalysisJpeg(photo) },
          },
          { type: "text", text: INSTRUCTION },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;
  const parsed = JSON.parse(textBlock.text) as { rawText?: unknown };
  const raw = parsed.rawText;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim().slice(0, 120) : null;
}
