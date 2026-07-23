import type { MetricType, ExtractionStatus, Platform } from "@prisma/client";
import type { ImageBytes } from "@/lib/storage";
import { parseDurationToSeconds } from "@/lib/duration";
import { cleanMetricText } from "@/lib/text-metric";
import { llmBackend, anthropicClient, LLM_MAX_TOKENS } from "@/lib/llm";

// Metrik yang diharapkan section (memandu extractor).
export type ExpectedMetric = { key: string; label: string; type: MetricType };

// Hasil ekstraksi satu metrik (sebelum ditulis ke tabel Extraction).
export type ExtractionResult = {
  key: string;
  value: number | null;
  rawText: string | null;
  confidence: number;
  status: ExtractionStatus;
};

export type ExtractionOutcome = {
  extractor: "claude" | "stub";
  results: ExtractionResult[];
};

// Ambang confidence: di bawah ini ditandai low_confidence (perlu konfirmasi user — Tahap 5).
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

const MODEL = "claude-opus-4-8";

// ---- Normalisasi notasi singkatan (per-platform) ----
// Screenshot seller center memakai notasi singkatan yang beda per platform (mis. "M" = juta di
// Shopee tapi = miliar di TikTok). Diserahkan ke aritmetika LLM, ini jadi sumber kesalahan
// sistematis. Karena itu Extractor menormalkan raw_text -> nilai PENUH secara DETERMINISTIK.
// Lihat docs/DESIGN.md §Normalisasi Notasi Singkatan. Huruf tidak peduli besar/kecil; embel
// I/IDR/Rp dan spasi diabaikan.

// Pengali suffix per platform. "m" SENGAJA beda arti: juta di Shopee, miliar di TikTok.
// "jt"/"juta" berlaku di kedua platform — Shopee berlokal Indonesia juga menampilkannya.
const MULTIPLIERS: Record<Platform, Record<string, number>> = {
  shopee: { k: 1_000, jt: 1_000_000, juta: 1_000_000, m: 1_000_000, b: 1_000_000_000 },
  tiktok: { k: 1_000, jt: 1_000_000, juta: 1_000_000, m: 1_000_000_000, b: 1_000_000_000 },
};

// Suffix yang BERMAKNA besaran di mana pun. Dipakai untuk membedakan dua hal yang dulu
// sama-sama jadi ×1: (a) embel non-besaran ("120 pesanan") yang memang wajar diabaikan,
// dan (b) besaran yang tak dikenal platform ini ("1,2 mio") — yang kalau diam-diam ×1
// menghasilkan kesalahan ribuan sampai jutaan kali. Kasus (b) WAJIB ditandai ragu.
const MAGNITUDE_SUFFIXES = new Set([
  "k", "rb", "ribu", "jt", "juta", "m", "mio", "b", "miliar", "milyar", "t", "triliun",
]);

// Buang noise floating-point: bulatkan bila sangat dekat ke bilangan bulat.
function cleanFloat(n: number): number {
  const rounded = Math.round(n);
  return Math.abs(n - rounded) < 1e-4 ? rounded : n;
}

// Hasil normalisasi + apakah ada suffix BESARAN yang tak dikenal platform ini. Pemanggil
// wajib menurunkan status jadi low_confidence bila unknownMagnitude — lihat statusFor().
export type NormalizedNumber = { value: number | null; unknownMagnitude: boolean };

// raw_text (teks apa adanya dari gambar) -> nilai numerik PENUH, mengikuti aturan per-platform.
// Mengembalikan null kalau tak ada angka yang bisa dibaca.
export function normalizeAbbreviatedNumber(
  rawText: string | null | undefined,
  platform: Platform
): number | null {
  return normalizeAbbreviatedNumberDetailed(rawText, platform).value;
}

export function normalizeAbbreviatedNumberDetailed(
  rawText: string | null | undefined,
  platform: Platform
): NormalizedNumber {
  const miss: NormalizedNumber = { value: null, unknownMagnitude: false };
  if (typeof rawText !== "string") return miss;

  // Buang embel mata uang (IDR/Rp) dan "I" berdiri sendiri; jangan sentuh persen/rasio.
  let s = rawText.replace(/idr|rp/gi, " ").replace(/\bi\b/gi, " ").trim();
  if (s === "") return miss;

  // Ambil suffix huruf di ujung (mis. K, M, jt, b) — dipisah dari inti angka.
  const sufMatch = s.match(/([a-z]+)\s*$/i);
  let suffix = "";
  if (sufMatch) {
    suffix = sufMatch[1].toLowerCase();
    s = s.slice(0, sufMatch.index).trim();
  }

  // Sisakan hanya karakter angka + pemisah + tanda; buang spasi dalam ("191,1 jt").
  const num = s.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(num)) return miss;

  // Langkah 1 — desimal vs ribuan.
  let normalized: string;
  if (num.includes(",")) {
    // (a) ada koma → koma = desimal, titik = ribuan.
    normalized = num.replace(/\./g, "").replace(",", ".");
  } else {
    const dotCount = (num.match(/\./g) || []).length;
    if (dotCount === 0) {
      normalized = num;
    } else if (dotCount === 1) {
      const frac = num.split(".")[1] ?? "";
      if (frac.length <= 2 && suffix) {
        // (b) satu titik diikuti 1–2 digit lalu huruf → titik = desimal.
        normalized = num;
      } else if (frac.length === 3) {
        // (c) titik memisahkan kelompok 3 digit → titik = ribuan.
        normalized = num.replace(/\./g, "");
      } else {
        // Ambigu (tanpa suffix / panjang tak lazim): perlakukan titik sebagai desimal.
        normalized = num;
      }
    } else {
      // Banyak titik tanpa koma → semua titik = pemisah ribuan.
      normalized = num.replace(/\./g, "");
    }
  }

  const base = parseFloat(normalized);
  if (!Number.isFinite(base)) return miss;

  // Langkah 2 — pengali per platform. Suffix tak dikenal tetap ×1 (angka tidak dibuang),
  // TAPI kalau bentuknya besaran ("mio", "rb", "miliar" di Shopee) itu ditandai supaya
  // masuk antrean konfirmasi manual — bukan lolos diam-diam sebagai angka yang sah.
  const known = MULTIPLIERS[platform][suffix];
  const unknownMagnitude = known === undefined && MAGNITUDE_SUFFIXES.has(suffix);
  return { value: cleanFloat(base * (known ?? 1)), unknownMagnitude };
}

function clampConfidence(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(1, Math.max(0, v));
}

// Aturan status presisi (DESIGN): angka tak ada -> missing; ragu -> low_confidence; sisanya ok.
// Suffix besaran tak dikenal SELALU low_confidence berapa pun confidence model: nilainya
// dihitung ×1 dan bisa meleset ribuan kali, jadi tidak boleh lolos tanpa dilihat manusia.
function statusFor(
  value: number | null,
  confidence: number,
  unknownMagnitude = false
): ExtractionStatus {
  if (value === null) return "missing";
  if (unknownMagnitude) return "low_confidence";
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return "low_confidence";
  return "ok";
}

// Susun satu hasil per expected metric, dari item mentah model (dicocokkan via key).
// value diturunkan dari raw_text secara DETERMINISTIK per-platform (single source of truth angka);
// value dari LLM hanya fallback kalau raw_text kosong/tak terbaca.
function buildResults(
  metrics: ExpectedMetric[],
  raw: { key: string; value: number | null; raw_text: string | null; confidence: number }[],
  platform: Platform
): ExtractionResult[] {
  const byKey = new Map(raw.map((r) => [r.key, r]));
  return metrics.map((m) => {
    const item = byKey.get(m.key);
    const rawText = item && typeof item.raw_text === "string" ? item.raw_text : null;
    const llmValue =
      item && typeof item.value === "number" && Number.isFinite(item.value) ? item.value : null;
    // Metrik TEKS punya jalur sendiri dan didahulukan: nilainya bukan angka sama sekali,
    // dan normalizer notasi singkatan akan membaca "Bumbu Mala 75gr" sebagai 75.
    // Nilainya tinggal di rawText, value SELALU null (tak pernah ikut aritmetika apa pun).
    // Pembersihan DETERMINISTIK di kode — bukan diserahkan ke model: hanya penanda potong
    // di UJUNG yang dibuang ("Bumbu Mala Pedas Hot..." -> "Bumbu Mala Pedas Hot").
    if (m.type === "text") {
      const text = cleanMetricText(rawText);
      const textConfidence = text === null ? 0 : clampConfidence(item?.confidence);
      return {
        key: m.key,
        value: null,
        rawText: text,
        confidence: textConfidence,
        // Tidak ada di gambar -> missing. Terbaca tapi model ragu tetap masuk antrean
        // konfirmasi manual (Tahap 5), sama perlakuannya dengan angka.
        status:
          text === null
            ? "missing"
            : textConfidence < LOW_CONFIDENCE_THRESHOLD
              ? "low_confidence"
              : "ok",
      };
    }
    // Metrik DURASI punya jalur sendiri: normalizer notasi singkatan membuang ":" dan
    // akan membaca "01:23:45" sebagai 12345. Parser durasi mengubahnya ke DETIK
    // (satuan kanonik). Suffix besaran (k/jt/M) tak berlaku di sini -> unknownMagnitude
    // selalu false. Fallback value LLM juga diperlakukan sebagai detik.
    if (m.type === "duration") {
      const seconds = parseDurationToSeconds(rawText);
      const durationValue = seconds !== null ? seconds : llmValue;
      const durationConfidence = durationValue === null ? 0 : clampConfidence(item?.confidence);
      return {
        key: m.key,
        value: durationValue,
        rawText,
        confidence: durationConfidence,
        status: statusFor(durationValue, durationConfidence),
      };
    }
    // Prioritaskan normalisasi deterministik dari raw_text; fallback ke value LLM.
    const normalized = normalizeAbbreviatedNumberDetailed(rawText, platform);
    const value = normalized.value !== null ? normalized.value : llmValue;
    const confidence = value === null ? 0 : clampConfidence(item?.confidence);
    return {
      key: m.key,
      value,
      rawText,
      confidence,
      status: statusFor(value, confidence, normalized.unknownMagnitude),
    };
  });
}

// ---- Claude Opus 4.8 (vision + structured output) ----
async function extractWithClaude(
  metrics: ExpectedMetric[],
  image: ImageBytes,
  context: { sectionName: string; platform: Platform }
): Promise<ExtractionResult[]> {
  const client = await anthropicClient();

  const base64 = Buffer.from(image.bytes).toString("base64");
  const mediaType = (
    ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.contentType)
      ? image.contentType
      : "image/png"
  ) as "image/png" | "image/jpeg" | "image/webp" | "image/gif";

  const metricList = metrics
    .map((m) => `- ${m.key} (${m.label}, tipe: ${m.type})`)
    .join("\n");

  const platformLabel = context.platform === "shopee" ? "Shopee" : "TikTok";
  const instruction =
    `Ini screenshot performa online shop platform ${platformLabel} untuk section "${context.sectionName}".\n` +
    `Baca angka HANYA dari yang terlihat jelas di gambar. Untuk tiap metrik di bawah, ` +
    `kembalikan raw_text (teks PERSIS seperti tampil di gambar — WAJIB memuat suffix singkatan dan ` +
    `pemisah apa adanya, mis. "179.395,44K", "191,1 jt", "Rp1.234.567", "12,5%"), ` +
    `value (pembacaan angka terbaikmu; sistem akan menormalkan sendiri dari raw_text, jadi utamakan raw_text yang akurat; null kalau tak terlihat), ` +
    `dan confidence 0..1 (seberapa yakin angkanya benar). ` +
    `Untuk metrik bertipe "duration": salin raw_text PERSIS bentuk durasinya apa adanya ` +
    `(mis. "01:23:45", "45 s", "12 min", "1h 30min") — JANGAN diubah jadi angka/detik; ` +
    `sistem yang mengonversinya. Isi value dengan durasi dalam DETIK bila kamu yakin, selain itu null. ` +
    `Untuk metrik bertipe "text" (nama produk / nama affiliator): isi raw_text dengan teks ` +
    `dan value=null. Salin teks PERSIS seperti tertulis di gambar — DILARANG menerjemahkan, ` +
    `merapikan ejaan, atau melengkapi teks yang terpotong. Kalau teks terpotong (diakhiri ` +
    `elipsis atau terputus di tepi kolom), salin bagian yang terbaca saja. ` +
    `Metrik yang ber-INDEKS SAMA WAJIB berasal dari BARIS TABEL YANG SAMA: nama_produk_1 dan ` +
    `penjualan_produk_1 = baris peringkat 1 (baris teratas tabel sesuai urutan tampil), ` +
    `nama_produk_2 dan penjualan_produk_2 = baris ke-2, dan seterusnya. JANGAN mengurutkan ` +
    `ulang tabel — ikuti urutan yang tampak di gambar. ` +
    `JANGAN menebak: kalau metrik tidak ada di gambar, value=null, raw_text=null, confidence=0. ` +
    `Jangan menghitung ulang atau membuat angka baru.\n\nMetrik:\n${metricList}`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      extractions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            key: { type: "string" },
            value: { type: ["number", "null"] },
            raw_text: { type: ["string", "null"] },
            confidence: { type: "number" },
          },
          required: ["key", "value", "raw_text", "confidence"],
        },
      },
    },
    required: ["extractions"],
  } as const;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: LLM_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: instruction },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Extractor: respons model tidak berisi teks.");
  }
  const parsed = JSON.parse(textBlock.text) as {
    extractions?: { key: string; value: number | null; raw_text: string | null; confidence: number }[];
  };
  return buildResults(metrics, parsed.extractions ?? [], context.platform);
}

// ---- Stub dev (tanpa API key) ----
// Data sintetis deterministik yang menyentuh ketiga status, untuk menguji pipeline.
function extractWithStub(metrics: ExpectedMetric[]): ExtractionResult[] {
  return metrics.map((m, i) => {
    const mode = i % 3;
    // Metrik teks: nilainya di rawText, value null — supaya pemasangan nama+angka dan
    // tampilan UI teruji tanpa API key. Elipsis akhir sengaja dipasang lalu dibersihkan.
    if (m.type === "text") {
      const text = mode === 2 ? null : cleanMetricText(`[DEV STUB] ${m.key}...`);
      const confidence = text === null ? 0 : mode === 1 ? 0.5 : 0.95;
      return {
        key: m.key,
        value: null,
        rawText: text,
        confidence,
        status:
          text === null
            ? "missing"
            : confidence < LOW_CONFIDENCE_THRESHOLD
              ? "low_confidence"
              : "ok",
      };
    }
    if (mode === 2) {
      // missing
      return { key: m.key, value: null, rawText: `[DEV STUB] ${m.key}`, confidence: 0, status: "missing" };
    }
    const value = 1000 + i;
    const confidence = mode === 1 ? 0.5 : 0.95; // 1 -> low_confidence, 0 -> ok
    return {
      key: m.key,
      value,
      rawText: `[DEV STUB] ${m.key}=${value}`,
      confidence,
      status: statusFor(value, confidence),
    };
  });
}

// Pilih backend via guard bersama (lib/llm.ts) — di produksi tanpa API key GAGAL KERAS,
// tidak nge-stub angka palsu.
export async function extractMetrics(
  metrics: ExpectedMetric[],
  image: ImageBytes,
  context: { sectionName: string; platform: Platform }
): Promise<ExtractionOutcome> {
  if (llmBackend() === "claude") {
    const results = await extractWithClaude(metrics, image, context);
    return { extractor: "claude", results };
  }
  return { extractor: "stub", results: extractWithStub(metrics) };
}
