import type { MetricType, ExtractionStatus, Platform } from "@prisma/client";
import type { ImageBytes } from "@/lib/storage";
import { llmBackend } from "@/lib/llm";

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

// Pengali suffix per platform. Suffix tak dikenal -> ×1.
const MULTIPLIERS: Record<Platform, Record<string, number>> = {
  shopee: { k: 1_000, m: 1_000_000, b: 1_000_000_000 },
  tiktok: { k: 1_000, jt: 1_000_000, m: 1_000_000_000, b: 1_000_000_000 },
};

// Buang noise floating-point: bulatkan bila sangat dekat ke bilangan bulat.
function cleanFloat(n: number): number {
  const rounded = Math.round(n);
  return Math.abs(n - rounded) < 1e-4 ? rounded : n;
}

// raw_text (teks apa adanya dari gambar) -> nilai numerik PENUH, mengikuti aturan per-platform.
// Mengembalikan null kalau tak ada angka yang bisa dibaca.
export function normalizeAbbreviatedNumber(
  rawText: string | null | undefined,
  platform: Platform
): number | null {
  if (typeof rawText !== "string") return null;

  // Buang embel mata uang (IDR/Rp) dan "I" berdiri sendiri; jangan sentuh persen/rasio.
  let s = rawText.replace(/idr|rp/gi, " ").replace(/\bi\b/gi, " ").trim();
  if (s === "") return null;

  // Ambil suffix huruf di ujung (mis. K, M, jt, b) — dipisah dari inti angka.
  const sufMatch = s.match(/([a-z]+)\s*$/i);
  let suffix = "";
  if (sufMatch) {
    suffix = sufMatch[1].toLowerCase();
    s = s.slice(0, sufMatch.index).trim();
  }

  // Sisakan hanya karakter angka + pemisah + tanda; buang spasi dalam ("191,1 jt").
  const num = s.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(num)) return null;

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
  if (!Number.isFinite(base)) return null;

  // Langkah 2 — pengali per platform (suffix tak dikenal → ×1).
  const mult = MULTIPLIERS[platform][suffix] ?? 1;
  return cleanFloat(base * mult);
}

function clampConfidence(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.min(1, Math.max(0, v));
}

// Aturan status presisi (DESIGN): angka tak ada -> missing; ragu -> low_confidence; sisanya ok.
function statusFor(value: number | null, confidence: number): ExtractionStatus {
  if (value === null) return "missing";
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
    // Prioritaskan normalisasi deterministik dari raw_text; fallback ke value LLM.
    const normalized = normalizeAbbreviatedNumber(rawText, platform);
    const value = normalized !== null ? normalized : llmValue;
    const confidence = value === null ? 0 : clampConfidence(item?.confidence);
    return { key: m.key, value, rawText, confidence, status: statusFor(value, confidence) };
  });
}

// ---- Claude Opus 4.8 (vision + structured output) ----
async function extractWithClaude(
  metrics: ExpectedMetric[],
  image: ImageBytes,
  context: { sectionName: string; platform: Platform }
): Promise<ExtractionResult[]> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // membaca ANTHROPIC_API_KEY dari env

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
    max_tokens: 16000,
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
