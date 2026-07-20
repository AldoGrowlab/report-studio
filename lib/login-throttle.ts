// Audit P7 — throttle percobaan login gagal. Bukan benteng anti-brute-force penuh
// (state in-memory per instance; lintas-instance tak dibagi — cukup untuk tools internal),
// tapi memperlambat tebak-password beruntun. Reset saat login berhasil.
//
// Kebijakan: FREE_ATTEMPTS gagal pertama tanpa delay; sesudahnya delay tumbuh eksponen
// (0,5s, 1s, 2s, …) sampai MAX_DELAY_MS. Jendela lupa WINDOW_MS sejak gagal terakhir.

const FREE_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;
const WINDOW_MS = 15 * 60 * 1000; // 15 menit

type Entry = { fails: number; last: number };
const attempts = new Map<string, Entry>();

// Delay (ms) yang HARUS ditunggu sebelum memproses percobaan untuk key ini, berdasarkan
// riwayat gagal. `now` diinjeksi supaya murni & bisa diuji.
export function throttleDelayMs(key: string, now: number): number {
  const e = attempts.get(key);
  if (!e) return 0;
  if (now - e.last > WINDOW_MS) {
    attempts.delete(key);
    return 0;
  }
  const over = e.fails - FREE_ATTEMPTS;
  if (over < 0) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** over, MAX_DELAY_MS);
}

// Sapu entri kedaluwarsa. Tanpa ini `attempts` tumbuh TANPA BATAS: key-nya
// `email|ip` dan keduanya dikendalikan pengirim, jadi skrip yang mengirim login gagal
// dengan email acak menambah satu entri permanen per percobaan — entri lama hanya
// terhapus kalau key yang SAMA diakses lagi. Disapu oportunistik (bukan timer) supaya
// tidak menahan proses hidup, dan hanya saat Map sudah besar agar tetap murah.
const SWEEP_THRESHOLD = 1000;
function sweepExpired(now: number): void {
  if (attempts.size < SWEEP_THRESHOLD) return;
  for (const [k, e] of attempts) {
    if (now - e.last > WINDOW_MS) attempts.delete(k);
  }
}

// Catat satu percobaan GAGAL (dipanggil setelah password terbukti salah).
export function recordFailure(key: string, now: number): void {
  sweepExpired(now);
  const e = attempts.get(key);
  if (e && now - e.last <= WINDOW_MS) {
    e.fails += 1;
    e.last = now;
  } else {
    attempts.set(key, { fails: 1, last: now });
  }
}

// Bersihkan riwayat (dipanggil saat login BERHASIL).
export function clearFailures(key: string): void {
  attempts.delete(key);
}

// Helper delay nyata (tidak dipakai di unit test murni).
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Untuk pengujian: jumlah entri yang sedang ditahan di memori.
export function trackedKeyCount(): number {
  return attempts.size;
}
