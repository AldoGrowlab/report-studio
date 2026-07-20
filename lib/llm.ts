// Penentu backend LLM bersama untuk Extractor, Analyst, Validator.
// KRITIS (audit pra-deploy): stub dev mengembalikan data [DEV STUB] PALSU. Di produksi,
// itu berarti angka/insight/kesimpulan karangan bisa masuk report klien tanpa error —
// pelanggaran fatal Prinsip #1 (presisi). Karena itu: tanpa ANTHROPIC_API_KEY di
// produksi, GAGAL KERAS di sini, bukan diam-diam nge-stub. Stub HANYA hidup di dev.
export function llmBackend(): "claude" | "stub" {
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ANTHROPIC_API_KEY tidak diset di produksi — LLM (Extractor/Analyst/Validator) " +
        "wajib pakai model sungguhan. Menolak menghasilkan data stub palsu. " +
        "Set ANTHROPIC_API_KEY."
    );
  }
  return "stub";
}

// Batas waktu satu panggilan LLM. SDK Anthropic default-nya 10 MENIT dengan maxRetries 2,
// dan timeout ikut di-retry — artinya satu request HTTP bisa hidup sampai ~30 menit.
// Browser operator sudah lama menyerah, proxy kemungkinan memutus lebih dulu, tapi server
// terus bekerja dan membakar token; operator lalu menekan "generate" lagi → beban berlipat.
// 3 menit sudah longgar: keluaran kita paling banyak ~8 poin, `max_tokens: 16000` itu
// atap, bukan ukuran biasa. Satu retry cukup untuk gangguan sesaat.
const LLM_TIMEOUT_MS = 180_000;
const LLM_MAX_RETRIES = 1;

// Klien Anthropic dengan batas waktu EKSPLISIT. Semua pemanggil (Extractor, Analyst,
// Validator) wajib lewat sini supaya batasnya tidak berbeda-beda per file.
// Klien DIPAKAI ULANG (satu route kesimpulan saja memanggil LLM beberapa kali); promise
// di-cache supaya panggilan bersamaan berbagi satu instance — sama seperti S3Client.
let clientPromise: Promise<import("@anthropic-ai/sdk").default> | null = null;

export async function anthropicClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return new Anthropic({
      // ANTHROPIC_API_KEY tetap dibaca dari env oleh SDK.
      timeout: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
    });
  })();
  return clientPromise;
}

// Catatan batas atas `max_tokens`: SDK menolak permintaan NON-streaming yang perkiraan
// durasinya melebihi 10 menit ("Streaming is required"). Pada model yang kita pakai,
// 16000 masih di bawah ambang itu — tapi menaikkannya di atas ~21.300 akan membuat SEMUA
// jalur LLM gagal keras seketika. Kalau suatu saat perlu keluaran lebih panjang, pindah
// ke streaming, jangan sekadar menaikkan angkanya.
export const LLM_MAX_TOKENS = 16000;
