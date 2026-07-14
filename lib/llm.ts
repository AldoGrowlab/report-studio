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
