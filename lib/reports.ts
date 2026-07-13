import type { SessionData } from "@/lib/session";

// Batas ukuran file upload (10 MB) — screenshot wajar di bawah ini.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Aturan akses report — MODEL B (keputusan user, audit pra-deploy Jul 2026):
// SEMUA akun terautentikasi (founder & operator) boleh mengakses SEMUA report — buka,
// upload, generate insight/kesimpulan/PPT, isi rekomendasi. Kepemilikan (createdById)
// BUKAN batas akses; yang terbatas hanya fitur founder (KB/users/flags/theme).
// Fungsi dipertahankan sebagai SATU titik aturan — semua route report-scoped tetap
// memanggilnya, jadi kalau aturan berubah lagi cukup di sini.
export function canAccessReport(
  _session: SessionData,
  _report: { createdById: string }
): boolean {
  return true;
}
