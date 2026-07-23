import sharp from "sharp";
import { anthropicClient, llmBackend, LLM_MAX_TOKENS } from "@/lib/llm";
import { ANALYSIS_MAX_PX } from "@/lib/merge-suggest";

// Pembaca KONTEKS FOTO (Jul 2026), server-only.
//
// Semula khusus deteksi bulan; sejak Fase 1 ia juga membaca teks TAB AKTIF supaya foto bisa
// dicocokkan ke sub-grup section (Flash Sale / Diskon / Voucher). Keduanya dibaca dalam
// SATU panggilan — konteks foto memang satu tarikan, dan menambah endpoint kedua berarti
// dua kali biaya untuk gambar yang sama.
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
  properties: {
    periodText: { type: ["string", "null"] },
    tabLabel: { type: ["string", "null"] },
  },
  required: ["periodText", "tabLabel"],
} as const;

export type PhotoContext = {
  periodText: string | null;
  tabLabel: string | null;
};

const INSTRUCTION =
  `Baca dua hal dari screenshot dashboard ini.\n\n` +
  `(1) periodText — salin teks PERIODE DATA UTAMA yang tampak, PERSIS ` +
  `sebagaimana tertulis (mis. "01/06/2026 - 30/06/2026", "Periode Data Per Bulan 2026.06 ` +
  `(GMT+07)", "Jun 01, 2026 - Jun 30, 2026").\n\n` +
  `ABAIKAN:\n` +
  `- periode PEMBANDING — yang berlabel "Bandingkan", "vs", atau rentang KEDUA yang ` +
  `muncul setelah rentang utama;\n` +
  `- timestamp PEMBARUAN — "Diperbarui pada", "Data diperbarui", atau tanggal tunggal ` +
  `yang disertai jam.\n\n` +
  `Kalau tidak ada periode utama yang terlihat, isi null. JANGAN menebak, JANGAN ` +
  `menyimpulkan bulannya sendiri, JANGAN merapikan formatnya — cukup salin teksnya.\n\n` +
  `(2) tabLabel — kalau tampak indikator TAB/MENU yang sedang AKTIF di bagian atas ` +
  `dashboard (mis. Flash Sale / Diskon / Voucher), salin teks tab aktif itu PERSIS. ` +
  `Tab aktif biasanya ditandai garis bawah, warna berbeda, atau huruf tebal. ` +
  `Kalau tidak yakin tab mana yang sedang aktif — atau tidak ada tab sama sekali — isi ` +
  `null. Lebih baik null daripada salah tab.`;

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

const EMPTY: PhotoContext = { periodText: null, tabLabel: null };

// Konteks satu foto APA ADANYA. null di tiap field = tak ada / tak terbaca.
export async function detectPhotoContext(photo: Buffer): Promise<PhotoContext> {
  // Tanpa API key (dev): JANGAN mengarang apa pun — label bulan atau sub-grup yang salah
  // diam-diam jauh lebih berbahaya daripada dropdown yang dibiarkan kosong.
  if (llmBackend() !== "claude") return EMPTY;

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
  if (!textBlock || textBlock.type !== "text") return EMPTY;
  const parsed = JSON.parse(textBlock.text) as { periodText?: unknown; tabLabel?: unknown };
  const clean = (v: unknown) =>
    typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 120) : null;
  return { periodText: clean(parsed.periodText), tabLabel: clean(parsed.tabLabel) };
}
