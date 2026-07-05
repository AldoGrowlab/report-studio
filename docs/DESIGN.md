# Report Studio — Dokumen Desain (Sumber Kebenaran)

> Tools internal agency untuk generate report PPT otomatis dari screenshot performa
> online shop (Shopee & TikTok). Founder menyiapkan knowledge base & aturan; operator
> upload + label screenshot; sistem menyusun analisa, caption, dan slide.
>
> Dokumen ini adalah rujukan desain resmi. Kalau ada keputusan implementasi yang
> bertentangan dengan dokumen ini, dokumen ini yang menang — atau angkat untuk dibahas.

## Prinsip Pemandu (mengunci seluruh desain)

1. **Angka harus presisi.** Semua angka berasal dari satu sumber kebenaran (tabel
   `Extraction`), tidak pernah dari "ingatan" LLM. Extractor tidak langsung percaya OCR:
   simpan `raw_text` + `confidence`, dan angka ragu dikonfirmasi user sebelum dipakai.
2. **Konsistensi yang dijaga adalah narasi, bukan angka antar section.** Angka bernama
   sama (mis. GMV) bisa berbeda sah karena beda filter/konteks — TIDAK direkonsiliasi.
3. **Report selalu jalan sampai selesai.** Masalah ditandai (flag) di ringkasan akhir,
   bukan menghentikan proses.
4. **Platform adalah batas yang bersih.** Dua platform: Shopee & TikTok. Framework
   analisa & metrik berbeda per platform. Narasi tidak menyeberang antar platform —
   dua cerita terpisah, tanpa perbandingan lintas-platform.
5. **Screenshot user adalah konten slide, bukan bahan mentah.** Angka diekstrak HANYA
   untuk analisa & caption — BUKAN untuk membuat chart/visualisasi sendiri. Foto asli
   user WAJIB ditampilkan di slide sebagai bukti visual otentik. Tidak ada grafik sintetis.
6. **Singkatan angka hanya di bahasa, bukan di penyimpanan.** Angka asli tersimpan UTUH di
   `Extraction` (single source of truth) — penyingkatan TIDAK pernah dilakukan saat menyimpan,
   HANYA saat angka dibahasakan di caption/narasi (Analyst & Template Engine). Aturan singkat:
   - ratusan tetap utuh (350 → 350);
   - ribuan → "k" 1 desimal, termasuk di bawah 10.000 (5.234 → 5,2k; 19.876 → 19,9k);
   - jutaan → "jt" 1 desimal (12.023.111 → 12,0 jt);
   - miliaran → "miliar" 1 desimal.

## Normalisasi Notasi Singkatan (aturan ekstraksi permanen, per-platform)

Screenshot seller center memakai notasi singkatan angka yang **berbeda per platform**. Tanpa
normalisasi, ini menyebabkan kesalahan ekstraksi sistematis (mis. `292.513,82k` terbaca ~292 ribu,
padahal ~292 juta). Extractor WAJIB menormalkan `raw_text` menjadi nilai penuh secara
**deterministik** (bukan diserahkan ke aritmetika LLM — konsisten dengan Prinsip #1 & #6).
Huruf tidak peduli besar/kecil; abaikan embel `I`/`IDR`/`Rp` dan spasi.

**Langkah 1 — tentukan desimal vs ribuan:**
- (a) jika ada **KOMA** → koma = desimal, titik = pemisah ribuan;
- (b) jika **tidak ada koma** tapi ada **satu titik diikuti 1–2 digit lalu huruf** → titik = desimal;
- (c) jika tidak ada koma dan titik memisahkan **kelompok 3 digit** → titik = ribuan.

**Langkah 2 — kalikan per PLATFORM** (penting: `M` berbeda arti antar platform!):

| Suffix | Shopee | TikTok |
|---|---|---|
| `k` | ×1.000 | ×1.000 |
| `m` / `M` | ×1.000.000 (juta) | ×1.000.000.000 (miliar) |
| `jt` | — | ×1.000.000 (juta) |
| `b` | ×1.000.000.000 (miliar) | ×1.000.000.000 (miliar) |

> Catatan: di TikTok, juta ditulis `jt` dan miliar ditulis `M`. Di Shopee, juta ditulis `m`.
> Suffix yang tak dikenal → pengali ×1 (nilai apa adanya). Karena Extractor sudah tahu platform
> tiap foto, aturan pengali diterapkan per-platform.

**Langkah 3 — simpan nilai PENUH** hasil perkalian di `Extraction.value` (BUKAN yang bersingkatan).
`raw_text` tetap menyimpan teks asli apa adanya (mis. `179.395,44K`).

Contoh (teruji): Shopee `179.395,44K`→179395440, `2.069,95M`→2069950000, `23.2m`→23200000,
`548.5k`→548500, `1.2b`→1200000000; TikTok `191,1 jt`→191100000, `1,2 M`→1200000000,
`47.551.292 IDR`→47551292.

## Arsitektur Pipeline (4 lapisan tipis + orchestrator)

```
Data Extractor → Analyst → Narrative Validator → Template Engine
  (presisi)      (KB section)    (KB general)        (deterministik)
                 ↑ orchestrator tipis (pipa, bukan otak) ↑
```

- **Data Extractor** — tiap foto + label → JSON angka terstruktur, dipandu `expected_metrics`
  section. Simpan `value`, `raw_text`, `confidence`, `status` (ok/missing/low_confidence).
  Single source of truth. DILARANG bikin chart. Foto dibawa terus sebagai aset wajib tampil.
- **Analyst** — satu agent, KB di-swap per section yang dikerjakan. Tidak menghitung ulang
  angka; menarik dari Extraction dan merangkai insight + caption sesuai framework section.
  Jika satu section punya >1 sumber foto: narasikan tiap sumber terpisah, JANGAN gabung/jumlah.
  Untuk section berperbandingan-periode: pakai penanda bulan per-foto untuk menghitung perubahan
  dalam PERSEN saja (mis. "GMV Juni +15% vs Mei"), bulan sebagai konteks (lihat §Perbandingan Periode).
- **Narrative Validator** — satu-satunya lapisan yang melihat semua section satu platform.
  Memegang KB general ("cara merangkai keseluruhan"). Cek kontradiksi/koherensi. Wewenang:
  beri instruksi koreksi (bukan tulis ulang). Loop revisi MAKS 1x; gagal → escalate + flag,
  render tetap jalan. Jalan dua kali independen kalau dua platform dipilih.
- **Template Engine** — deterministik (bukan LLM). Tema bulanan = config. Menempatkan foto
  asli + caption + insight ke slide. Konsisten antar run.
- **Orchestrator** — tipis, cuma atur alur: extract → (konfirmasi angka) → analyst →
  validator → render.

## Model Section (dinamis tapi terkunci)

Founder bisa bikin section baru kapan saja. Section = paket:
- nama (jadi opsi label user)
- platform (shopee/tiktok) — identitas unik = `(platform, name)`
- KB analisa (dipakai Analyst)
- posisi narasi (`narrativeOrder`, ditentukan MANUAL oleh founder)
- `expected_metrics` (memandu Extractor)
- penanda **pakai perbandingan periode** (opsional; TIDAK semua section) — lihat §Perbandingan Periode

**Aturan "aktif kalau lengkap"**: section hanya `active` (muncul ke user sebagai opsi label)
kalau nama + KB + ≥1 metrik terisi. Selain itu `draft`. Status dihitung OTOMATIS server,
bukan disetel manual. — SUDAH DIIMPLEMENTASI.

## Platform di dua lapisan

- **Lapisan section — identitas.** "Voucher Shopee" dan "Voucher TikTok" = dua section
  terpisah, KB & metrik masing-masing.
- **Lapisan report — dimensi.** User pilih satu platform saja atau keduanya (Shopee lalu
  TikTok). Dua platform = dua blok berurutan, tiap blok berdiri sendiri. KB general
  per-platform; Validator jalan dua kali independen.

> CATATAN IMPLEMENTASI TERTUNDA: tahap upload saat ini = satu platform per report (disederhanakan).
> Untuk output dua-platform nanti perlu cara menyatukan dua report (Shopee + TikTok) jadi satu
> PPT dua-blok. Catat saat tiba di Template Engine.

## Perbandingan Periode (properti sebagian section)

- **Opt-in per section.** Founder menandai saat membuat section apakah section itu memakai
  perbandingan periode. TIDAK semua section pakai.
- **Penanda bulan di level FOTO/UPLOAD, bukan report.** Untuk section yang pakai: user mengunggah
  beberapa foto periode berbeda ke section yang sama, lalu menandai TIAP foto dengan bulan spesifik
  via dropdown (mis. "Juni 2026", "Mei 2026"). Bisa lebih dari dua periode.
- **Tanpa memori antar-report.** Foto pembanding diunggah ulang tiap bulan; sistem TIDAK mengingat
  angka dari report sebelumnya. Tiap report berdiri sendiri.
- **Extractor tetap sama.** Tiap foto dibaca seperti biasa — sumber terpisah, TIDAK digabung/
  dijumlah (konsisten dengan aturan ">1 foto = sumber terpisah").
- **Analyst memakai penanda bulan** untuk menghitung & menarasikan perubahan dalam PERSEN saja
  (mis. "GMV Juni +15% vs Mei"), dengan bulan sebagai konteks — bukan menyalin angka absolut antar
  periode sebagai klaim baru.
- **Dua lapis periode yang tidak bertabrakan:** `Report.reportPeriod` (periode report keseluruhan)
  vs penanda bulan per-foto (di `Upload`). Beda peran, tidak saling menggantikan.

> CATATAN IMPLEMENTASI: butuh field baru — flag perbandingan-periode di `Section` dan penanda bulan
> di `Upload`. Belum dibangun; relevan mulai saat Analyst (Tahap 6+).

## Alur UX

**Founder**: kelola section (nama+KB+order+metrik), tema bulanan (config), KB general
(perangkai narasi, hidup di Validator), aturan format. Kelola user.
**User/Operator**: buat report → upload screenshot → label tiap foto (satu foto satu label,
dari section aktif platform itu) → konfirmasi → generate. Sistem deteksi section aktif yang
fotonya belum ada.

## Aturan Kasus Tepi (sudah diputuskan)

| Kasus | Keputusan |
|---|---|
| Dua+ foto untuk section sama | Berdampingan sebagai sumber terpisah. TIDAK pernah gabung/jumlah/rata-rata otomatis. Analyst narasikan tiap sumber. |
| Metrik wajib (`required`) hilang | Section tetap dianalisa dengan angka yang ada; kekurangan di-flag. |
| Angka sama nama lintas section (mis. GMV) | TIDAK direkonsiliasi. Konsistensi dijaga di level narasi saja. |
| Validator masih tak cocok setelah revisi ke-1 | Escalate + flag ke ringkasan akhir. Render tetap jalan. |
| User salah pilih section | Label terkunci ke section aktif; mitigasi via konfirmasi label ringan. |
| Section aktif tapi foto belum di-upload | Sistem deteksi & ingatkan user sebelum proses. |
| Visualisasi data | TIDAK pernah bikin chart dari angka. Foto asli yang tampil; angka hanya untuk analisa & caption. |
| Penyingkatan angka | Hanya saat dibahasakan (caption/narasi), tak pernah saat disimpan. Aturan k/jt/miliar 1 desimal — lihat Prinsip #6. |
| Notasi singkatan di screenshot | Extractor menormalkan `raw_text` → nilai PENUH secara deterministik, per-platform (`M`=juta di Shopee, `M`=miliar di TikTok). Lihat §Normalisasi Notasi Singkatan. |
| Section dengan perbandingan periode | Penanda bulan per-FOTO (bukan per-report); foto pembanding di-upload ulang tiap bulan, tanpa memori antar-report; Extractor tak menggabung; Analyst hitung perubahan PERSEN saja. Lihat §Perbandingan Periode. |

## Sistem Flag

- Dua tingkat keparahan: *info* (narasi janggal, metrik opsional hilang) → tetap render,
  tandai; *tinggi* (metrik `required` low-confidence/missing tak terkonfirmasi) → menyentuh
  presisi, pertimbangkan tahan bagian itu.
- Flag harus visible di ringkasan akhir (bukan terkubur di log).
- Akumulasi flag = alat perbaikan KB. Sering ke-flag lintas report → KB perlu dipertajam.
  Tiap insight bawa `kb_version` untuk pelacakan.

## Stack & Keputusan Teknis

- Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4 + TypeScript, TANPA folder `src`.
- Prisma 6 + PostgreSQL (Railway). JANGAN naik ke Prisma 7.
- Auth buatan sendiri: cookie session bertanda tangan HMAC (`rs_session`), BUKAN next-auth.
- Pola data: client component + fetch ke route handler (konsisten di seluruh app).
- Storage gambar: Cloudflare R2 (S3-compatible), bucket private, disajikan via presigned URL
  di balik auth. Abstraksi di `lib/storage.ts` (fallback disk lokal untuk dev). Volume target:
  ~30 foto/report × ~100 report/bulan.
- Deploy: Railway (app + Postgres). CATATAN: Railway disk sementara — file lokal hilang saat
  redeploy, itu sebabnya pakai R2 untuk produksi.
- LLM Extractor: Claude Opus 4.8 (`claude-opus-4-8`) via `@anthropic-ai/sdk` — vision (gambar
  base64) + structured output (`output_config.format`) + adaptive thinking. Abstraksi di
  `lib/extractor.ts` (fallback stub dev kalau `ANTHROPIC_API_KEY` kosong). Ambang low-confidence
  0.75. Model lain belum diputuskan untuk Analyst/Validator.

## Status Pembangunan

- [x] Tahap 0 — Setup (Next + Prisma + Postgres + migrasi + seed founder)
- [x] Tahap 1a — Auth + 2 peran (login, sesi, proteksi, dashboard per peran)
- [x] Tahap 1b — Kelola user (founder bikin akun)
- [x] Tahap 2 — Section & KB (CRUD + aturan aktif-kalau-lengkap)
- [x] Tahap 3 — Generate report: upload + label (Report → Upload, storage R2, di balik auth)
- [x] Tahap 4 — Extractor (foto → Extraction; Claude Opus 4.8 vision, presisi via confidence/status
  + normalisasi notasi singkatan deterministik per-platform)
- [x] Tahap 5 — Konfirmasi angka low-confidence + koreksi manual. Hasil edit PERSIST ke `Extraction`
  (`value`/`status` diperbarui, `manuallyConfirmed=true`); `raw_text` & `confidence` asli TIDAK
  ditimpa (provenance OCR). Ekstrak-ulang mengganti semua baris — UI minta persetujuan bila ada
  angka yang sudah divetting manual. Bundel: dua pelengkap UI Tahap 3 — (a) deteksi & pengingat
  section aktif yang fotonya belum ada; (b) foto tersimpan dikelompokkan per section dengan penanda
  "Sumber #1/#2 — sumber terpisah" saat >1 foto.
- [ ] Tahap 6 — Analyst (insight + caption per section, KB section)
- [ ] Tahap 7 — Narrative Validator (KB general, loop revisi 1x, escalate+flag)
- [ ] Tahap 8 — Template Engine (PPT: foto asli + caption + insight, tema)
- [ ] Tahap 9 — Dashboard flag (founder)
- [ ] Tahap 10 — Tema bulanan (config)
- [ ] Tahap 11 — Deploy ke Railway

**Backlog (disengaja ditunda, keputusan audit Jul 2026):**
- Penanda bulan per-foto + flag perbandingan-periode di Section → Tahap 6 (lihat §Perbandingan Periode).
- Konfirmasi label ringan eksplisit (saat ini: dropdown + simpan eksplisit; `labelConfirmed` selalu true).
- Bersihkan file storage saat hapus report — route DELETE report BELUM ada; saat dibangun, WAJIB hapus
  file R2/disk semua upload dulu (cascade DB tidak menyentuh storage). Pola benar sudah ada di
  DELETE upload tunggal.

## Catatan Operasional

- Railway Postgres cold-start: request pertama tiap sesi bisa 500 ("Can't reach database
  server"), retry sukses. Bukan bug. Pertimbangkan pesan error ramah saat DB belum siap.
- Ganti password founder default sebelum produksi.
