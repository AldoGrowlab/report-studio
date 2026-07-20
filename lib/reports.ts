import type { SessionData } from "@/lib/session";

// Batas ukuran file upload (10 MB) — screenshot wajar di bawah ini.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Batas panjang teks bebas milik report. Keduanya ikut ke slide cover; brandName juga
// ikut ke nama berkas unduhan (header Content-Disposition), jadi tak boleh tak terbatas.
export const MAX_BRAND_NAME = 120;
export const MAX_REPORT_PERIOD = 60;

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

// ---- Kesiapan report (badge) ----
// Batch C: badge DITURUNKAN dari isi report, bukan dari kolom `status`. Nilai enum
// `processing` dan `done` tidak pernah ditulis di mana pun, jadi badge lama selalu
// "draft" sampai PPT diunduh sekali lalu "downloaded" SELAMANYA — termasuk setelah
// foto/angka ditambah lagi sesudahnya. Turunan tidak bisa basi: ia dihitung ulang dari
// data setiap kali halaman dibuka, dan sekalian memberi tahu langkah berikutnya.
// `status` tetap dipakai untuk satu fakta yang memang tak bisa diturunkan: sudah diunduh.
export type ReportProgress = { label: string; tone: "ok" | "warn" | "muted" };

export function reportProgress(input: {
  status: string;
  uploadCount: number;
  sectionsWithPhotos: number;
  insightCount: number;
  platformsWithPhotos: number;
  conclusionCount: number;
  // Ada insight/kesimpulan yang datanya berubah sesudah dibuat. Hanya halaman detail yang
  // mengirim ini (perbandingan updatedAt-nya sudah dihitung di sana, jadi gratis). Daftar
  // report SENGAJA tidak menghitungnya — butuh agregat updatedAt per report, dan hitungan
  // cakupan section/platform di bawah tidak bisa melihat perubahan DI DALAM satu section.
  hasStale?: boolean;
}): ReportProgress {
  if (input.uploadCount === 0) return { label: "Belum ada foto", tone: "muted" };
  if (input.insightCount < input.sectionsWithPhotos) {
    return {
      label: `Perlu insight (${input.insightCount}/${input.sectionsWithPhotos})`,
      tone: "warn",
    };
  }
  if (input.conclusionCount < input.platformsWithPhotos) {
    return { label: "Perlu kesimpulan", tone: "warn" };
  }
  // Semua section punya insight & tiap platform punya kesimpulan, TAPI sebagiannya dibuat
  // dari data yang kini sudah berubah — mis. foto tambahan masuk ke section yang sudah
  // punya insight, yang tidak terlihat dari hitungan cakupan di atas.
  if (input.hasStale) return { label: "Perlu generate ulang", tone: "warn" };
  // "Terunduh" sengaja KALAH dari semua cek di atas: report yang pekerjaannya bertambah
  // setelah diunduh harus kembali menunjukkan sisa pekerjaan, bukan tetap hijau.
  if (input.status === "downloaded") return { label: "Terunduh", tone: "ok" };
  return { label: "Siap unduh", tone: "ok" };
}
