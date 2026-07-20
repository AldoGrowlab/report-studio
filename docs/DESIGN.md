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
   - miliaran → "miliar" 1 desimal (tingkat teratas; ≥1.000 miliar tampil "1000,0 miliar").
   - Satuan dipilih SETELAH pembulatan (Jul 2026): 999.999 membulat ke "1000,0k", yang
     sebenarnya "1,0 jt" — naik satu tingkat bila pembulatan menyentuh 1000.
   - Nilai non-finite (NaN/Infinity) → "tidak tersedia", tak pernah tercetak di slide.

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
| `jt` / `juta` | ×1.000.000 (juta) | ×1.000.000 (juta) |
| `b` | ×1.000.000.000 (miliar) | ×1.000.000.000 (miliar) |

> Catatan: di TikTok, juta ditulis `jt` dan miliar ditulis `M`. Di Shopee, juta ditulis `m`.
> `jt`/`juta` berlaku di KEDUA platform (Jul 2026): Shopee berlokal Indonesia juga menampilkan
> "jt", dan sebelumnya suffix itu diam-diam jadi ×1 di Shopee — `191,1 jt` tersimpan sebagai
> `191,1`, salah 1.000.000×, tetap berstatus `ok`.
> Suffix yang tak dikenal → pengali ×1 (nilai apa adanya). Karena Extractor sudah tahu platform
> tiap foto, aturan pengali diterapkan per-platform.
>
> **Namun ×1 tidak boleh diam-diam (Jul 2026).** Bedakan dua hal yang dulu diperlakukan sama:
> embel NON-besaran ("120 pesanan") wajar diabaikan dan tetap berstatus `ok`, sedangkan suffix
> yang BERMAKNA besaran tapi tak dikenal platform itu (mis. `mio`, `rb`, `miliar` di Shopee)
> dipaksa berstatus **`low_confidence`** berapa pun confidence model, sehingga masuk antrean
> konfirmasi manual Tahap 5. Alasan: ×1 pada besaran bisa meleset ribuan sampai jutaan kali,
> dan angka sesalah itu tidak boleh lolos ke insight/PPT tanpa dilihat manusia (Prinsip #1).

**Langkah 3 — simpan nilai PENUH** hasil perkalian di `Extraction.value` (BUKAN yang bersingkatan).
`raw_text` tetap menyimpan teks asli apa adanya (mis. `179.395,44K`).

Contoh (teruji): Shopee `179.395,44K`→179395440, `2.069,95M`→2069950000, `23.2m`→23200000,
`548.5k`→548500, `1.2b`→1200000000; TikTok `191,1 jt`→191100000, `1,2 M`→1200000000,
`47.551.292 IDR`→47551292.

## Arsitektur Pipeline (4 lapisan tipis + orchestrator)

```
Data Extractor → Analyst → Narrative Validator → Template Engine
  (presisi)      (KB section)   (2 KB: merangkai      (deterministik)
                                 + kesimpulan)
                 ↑ orchestrator tipis (pipa, bukan otak) ↑
```

- **Data Extractor** — tiap foto + label → JSON angka terstruktur, dipandu `expected_metrics`
  section. Simpan `value`, `raw_text`, `confidence`, `status` (ok/missing/low_confidence).
  Single source of truth. DILARANG bikin chart. Foto dibawa terus sebagai aset wajib tampil.
- **Analyst** — satu agent, KB di-swap per section yang dikerjakan. Tidak menghitung ulang
  angka; menarik dari Extraction dan merangkai insight + caption sesuai framework section.
  Jika satu section punya >1 sumber foto: narasikan tiap sumber terpisah, JANGAN gabung/jumlah.
  Untuk section berperbandingan-periode: menarasikan perubahan PERSEN antar bulan yang sudah
  dihitung KODE dari Extraction (mis. "GMV Juni +15% vs Mei"), bulan sebagai konteks — Analyst
  tidak menghitung (lihat §Perbandingan Periode).
- **Narrative Validator** — satu-satunya lapisan yang melihat semua section satu platform.
  Berperan GANDA (lihat §Validator & Kesimpulan): (1) cek konsistensi — wewenang: beri
  instruksi koreksi (bukan tulis ulang), loop revisi MAKS 1x; gagal → escalate + flag,
  render tetap jalan; (2) MENULIS slide kesimpulan/summary platform itu. Jalan dua kali
  independen kalau dua platform dipilih.
- **Template Engine** — deterministik (bukan LLM). Tema bulanan = config. Menempatkan foto
  asli + caption + insight ke slide. Konsisten antar run. Struktur PPT punya SLOT KESIMPULAN
  di akhir tiap blok platform — diisi Validator (Tahap 7); Tahap 8 dibangun dengan slot ini
  kosong dulu.
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
  per-platform; Validator jalan dua kali independen. Tiap blok ditutup slide KESIMPULAN
  platform itu sendiri — TIDAK ada kesimpulan gabungan lintas-platform (lihat §Validator
  & Kesimpulan).

> TERPASANG (Jul 2026): satu report bisa mencakup dua platform sekaligus. Form report baru
> memilih Shopee dan/atau TikTok; `POST /api/reports` menerima `platforms[]` dan menormalkan
> urutannya ke Shopee → TikTok. Tidak ada penggabungan dua report — `Report.platforms` memang
> array sejak awal dan seluruh alur hilir (dropdown section, kesimpulan, rekomendasi, blok PPT)
> sudah per-platform. Diverifikasi: PPT dua blok = cover → divider Shopee → section → kesimpulan
> → rekomendasi → divider TikTok → … → Thank You, penomoran halaman menerus.

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
- **Persen dihitung DETERMINISTIK DI KODE** dari Extraction (revisi Jul 2026 — semula
  "Analyst menghitung"; diubah konsisten Prinsip #1 & pola normalisasi notasi: LLM tidak
  menghitung). Analyst hanya MENARASIKAN perubahan yang sudah dihitung (mis. "GMV Juni
  +15% vs Mei"), bulan sebagai konteks — bukan menyalin angka absolut antar periode
  sebagai klaim baru. Detail pola berantai & aturan lewati = Tahap 6b-B.
- **Dua lapis periode yang tidak bertabrakan:** `Report.reportPeriod` (periode report keseluruhan)
  vs penanda bulan per-foto (di `Upload`). Beda peran, tidak saling menggantikan.

> IMPLEMENTASI (Tahap 6b-A, Jul 2026): `Section.usesPeriodComparison` (toggle founder di
> halaman Section & KB); `Upload.periodMonth` kanonik "YYYY-MM" (label "Juni 2026" hanya di
> render — `lib/period.ts`, dropdown 13 bulan terakhir berjalan) + `Upload.isPrimaryPeriod`.
> Periode UTAMA ditandai EKSPLISIT user (tidak pernah otomatis), maks SATU per
> (report, section) — ditegakkan server (menandai utama baru meng-unset yang lama).
>
> IMPLEMENTASI (Tahap 6b-B, Jul 2026) — perhitungan & narasi:
> - **Persen dihitung KODE** (`computeChainedChanges`, `lib/period.ts`), BERANTAI: tiap bulan
>   vs bulan tepat sebelumnya secara kronologis (April,Mei,Juni → Mei-vs-April & Juni-vs-Mei;
>   semua periode terpakai). Rumus per tipe metrik: number/currency/ratio → relatif
>   `((baru−lama)/lama)×100`, format "+15,3%" 1 desimal; metrik bertipe PERSEN → selisih
>   POIN PERSENTASE "+0,12 pp" 2 desimal (keputusan Jul 2026 — rumus relatif pada persen
>   ambigu/terbaca pp).
> - **Aturan LEWATI (tanpa mengarang)**: metrik tak ada di salah satu sisi pasangan; nilai
>   null; pembagi 0. Tidak pernah menghasilkan 0/tebakan sebagai pengganti.
> - **Satu bulan = SATU foto** per (report, section) — ditegakkan server saat upload & ganti
>   bulan (duplikat ditolak); `buildAnalystSources` memvalidasi defensif (bulan lengkap,
>   tepat satu utama, tanpa duplikat) sebelum generate.
> - **Analyst hanya menarasikan**: prompt varian ber-perbandingan memberi blok angka per
>   bulan + blok "Perubahan antar periode (DIHITUNG SISTEM)"; klaim naik/turun HANYA dari
>   blok itu, kutip verbatim, fokus periode utama; metrik tanpa baris perubahan tidak boleh
>   diklaim berubah. Persen/pp ikut kosakata `Insight.numbers` → ter-bold oleh splitter yang
>   sama; TIDAK disimpan sebagai baris Extraction (turunan, dihitung saat generate).

## Validator & Kesimpulan (keputusan Jul 2026)

- **Validator berperan ganda: cek konsistensi + TULIS kesimpulan.** Validator satu-satunya
  lapisan yang melihat semua section satu platform — jadi lapisan paling tepat untuk merangkum.
  TIDAK dibuat agent baru untuk kesimpulan: itu duplikasi kerja membaca-semua-section yang
  Validator sudah lakukan.
- **Dua bagian KB Validator** (dikelola founder):
  - **KB general/merangkai** — "bagaimana section jadi satu cerita utuh sesuai gaya agency".
    Sekaligus acuan cek konsistensi TERHADAP GAYA.
  - **KB kesimpulan** — "bagaimana menulis slide kesimpulan yang baik".
- **Cek logika/kontradiksi = instruksi bawaan, TANPA KB.** Mendeteksi dua insight yang
  bertentangan, tone yang loncat, dsb. adalah penilaian koherensi umum — bukan aturan agency,
  jadi tidak butuh KB.
- **Kesimpulan per-platform, tidak pernah gabungan.** Konsisten Prinsip #4 (dua platform = dua
  cerita terpisah, tanpa perbandingan lintas-platform): tiap platform punya slide kesimpulannya
  sendiri di AKHIR bloknya. TIDAK ada kesimpulan gabungan lintas-platform.
- **Slot kesimpulan di struktur PPT.** Template Engine menyediakan slot kesimpulan di akhir tiap
  blok platform, diisi Validator (Tahap 7). Template Engine (Tahap 8) dibangun dengan slot ini
  KOSONG dulu, supaya struktur tidak perlu dibongkar saat Validator jadi.
- **Implementasi peran kesimpulan (Tahap 7a, Jul 2026):** dipicu MANUAL per platform dari
  halaman report (tombol "Buat kesimpulan"), bukan otomatis. Bahan = SEMUA insight section
  platform itu (urut `narrativeOrder`); wajib ≥1 insight; section aktif tanpa insight →
  peringatan ringan di UI (non-blocking). PRESISI: Validator TIDAK menyentuh Extraction —
  angka hanya dikutip VERBATIM dari teks insight, prompt melarang aritmetika/penjumlahan/
  rekonsiliasi antar section (Prinsip #1 & #2). Format & bold SERAGAM dengan insight: poin
  (target 6 lunak, atap keras 8) + kosakata angka = union `Insight.numbers` platform itu,
  bold deterministik via `lib/insight-format.ts`. Simpan di tabel `Conclusion` SENDIRI, unik
  per `(report, platform)`, generate ulang = replace — bukan `Insight` + penanda, karena
  identitasnya beda (per-platform vs per-section) dan query Insight lama tak perlu berubah.
  Dua KB Validator di tabel `ValidatorKb` (satu baris per platform: `kbGeneral` +
  `kbConclusion`), diisi founder via `/dashboard/validator-kb`; kosong = sah (prompt memakai
  penilaian umum).
- **Implementasi cek konsistensi (Tahap 7b, Jul 2026):** terpicu tombol "Buat kesimpulan"
  yang sama — satu klik = cek → revisi → kesimpulan. Dua cek bawaan TANPA KB: kontradiksi
  logika antar-insight + tone loncat tanpa alasan (cek konsistensi-GAYA butuh KB general —
  DITUNDA, lihat backlog). Validator TIDAK menulis ulang: tiap temuan menunjuk SATU section +
  INSTRUKSI koreksi; ANALYST yang merevisi (KB section + angka dari Extraction via helper
  bersama `lib/insight-source.ts` — angka TIDAK boleh berubah, aturan prompt sama dengan
  generate awal). Maks 1 putaran revisi per section per run, lalu cek ULANG sekali; masih
  bermasalah → escalate + `Flag` (type `inkonsistensi`, severity `info` — bukan `tinggi`,
  itu untuk presisi angka) — kesimpulan TETAP ditulis (Prinsip #3). Flag = keadaan run
  terakhir per (report, platform): run baru menghapus flag inkonsistensi lama. Jejak revisi
  di tabel `InsightRevision` (before + after + alasan + instruksi + resolved) — tidak ada
  perubahan diam-diam; tampil di halaman report (before/after berdampingan); generate ulang
  insight manual menghapus jejak generasi lama. Dashboard flag lintas-report = Tahap 9.

## Alur UX

**Founder**: kelola section (nama+KB+order+metrik), tema bulanan (config), dua KB Validator —
KB general/merangkai + KB kesimpulan (lihat §Validator & Kesimpulan), aturan format. Kelola user.
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
| Section dengan perbandingan periode | Penanda bulan per-FOTO (bukan per-report); SATU foto per bulan (duplikat ditolak server); foto pembanding di-upload ulang tiap bulan, tanpa memori antar-report; Extractor tak menggabung; persen/pp dihitung KODE berantai antar bulan berdekatan (lewati bila data tak lengkap/pembagi 0), Analyst hanya menarasikan. Lihat §Perbandingan Periode. |
| Slide kesimpulan/summary | Ditulis VALIDATOR (bukan agent baru), per-platform di akhir bloknya masing-masing; TIDAK ada kesimpulan gabungan lintas-platform. Lihat §Validator & Kesimpulan. |

## Sistem Flag

- Dua tingkat keparahan: *info* (narasi janggal, metrik opsional hilang) → tetap render,
  tandai; *tinggi* (metrik `required` low-confidence/missing tak terkonfirmasi) → menyentuh
  presisi, pertimbangkan tahan bagian itu.
- Flag harus visible di ringkasan akhir (bukan terkubur di log).
- Akumulasi flag = alat perbaikan KB. Sering ke-flag lintas report → KB perlu dipertajam.
  Tiap insight bawa `kb_version` untuk pelacakan.
- IMPLEMENTASI (Tahap 9, Jul 2026): dashboard founder `/dashboard/flags` (READ-ONLY, tanpa
  aksi) — SEMUA jenis flag di tabel `Flag`, dikelompokkan per (platform, section) dengan
  frekuensi lintas report (`lib/flags-view.ts`, urut paling-sering dulu) + hitungan report
  unik + penanda severity `tinggi`; tiap flag menaut ke report asalnya. Kelompok berulang
  (≥2) diberi petunjuk "pertimbangkan pertajam KB section ini".

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
  0.75.
- LLM Validator (peran kesimpulan, Tahap 7a): model sama (`claude-opus-4-8`), structured output +
  adaptive thinking, abstraksi `lib/validator.ts` (fallback stub dev, pola sama dgn Analyst).
  Poin + bold memakai mekanisme Analyst persis (target/atap & `lib/insight-format.ts`).
- Template Engine: `pptxgenjs` v4 (JS murni — tanpa runtime Python di deploy Railway). Builder
  deterministik `lib/ppt.ts` (data polos → Buffer, tanpa Prisma/AI); dimensi foto dibaca dari
  header bytes sendiri (`lib/image-size.ts`) supaya proporsi "contain" dihitung di kode, bukan
  perilaku library.
- Struktur PPT gaya agency (Fase A, Jul 2026): **cover report (1x) → per platform: [pembatas
  ("SHOPEE REPORT"/"TIKTOK SHOP REPORT", latar primer, styling saja) → slide section →
  Kesimpulan → Rekomendasi*] → Thank You (1x)**. (*Slide "Rekomendasi & Action Plan" per
  platform: DIKETIK USER MANUAL (tabel `Recommendation`, unik per (report, platform), textarea
  di halaman report) — teks bebas apa adanya, baris baru dipertahankan, TANPA AI/bold otomatis;
  kosong = slide dilewati, bukan slide kosong.) Slide Thank You: teks + logo tema + kontak dari
  `Theme` (`contactEmail`/`contactWebsite`/`contactInstagram`, editable founder di
  `/dashboard/theme`; kosong = bagian itu tak tampil). Nama platform pindah dari cover ke
  pembatas; cover menampilkan periode + daftar platform.
- Tema (Tahap 10, "Cara B"): SATU tema aktif GLOBAL di tabel `Theme` (record tunggal), diubah
  founder via `/dashboard/theme`, dipakai SEMUA report saat generate — termasuk report lama
  (disengaja: PPT dirakit on-the-fly dengan tema aktif; tema TIDAK disimpan per-report).
  Konfigurasi: warna primer/sekunder/aksen (hex tanpa `#`), font judul+body dari DAFTAR AMAN
  PPTX (`SAFE_FONTS`, `lib/theme.ts` — tersedia di Office Windows & Mac tanpa embed), logo
  cover (upload via `lib/storage.ts`, opsional — tanpa logo tetap jalan), override aksen per
  platform (OFF → aksen dasar). `lib/ppt.ts` tetap murni: tema masuk sebagai parameter
  (`PptTheme`), route pptx yang membaca DB; belum ada baris Theme → default netral.
- Polesan estetik PPT "Tingkat 2" (Tahap 10, deterministik tanpa AI — pola tetap): cover
  asimetris (panel primer ±38% kiri + garis aksen + logo + hierarki kicker/judul/periode);
  slide section ber-header (bar aksen + judul heading-font + garis pemisah), panel insight
  latar halus (tint aksen ~93% putih, garis aksen kiri), footer (label report + nomor
  halaman "n / total" dihitung manual); slide Kesimpulan ber-band primer lebar penuh (judul
  putih) supaya terasa penutup. Teks body tetap abu gelap netral (keterbacaan); foto asli
  TIDAK pernah ditimpa elemen; bold angka & geometri "contain" tak berubah. Desain artistik
  selevel template/Canva = peningkatan terpisah nanti, BUKAN bagian tahap ini.
- LLM Analyst: model sama dengan Extractor (`claude-opus-4-8`), structured output + adaptive
  thinking. Abstraksi di `lib/analyst.ts` (fallback stub dev, pola sama). Penyingkatan angka
  (Prinsip #6) dihitung DETERMINISTIK di kode — model hanya menerima & wajib mengutip bentuk
  singkat yang sudah jadi, dilarang aritmetika apa pun. Insight = POIN-POIN (satu kalimat
  ringkas per poin — keputusan Jul 2026, menggantikan paragraf; jumlah: TARGET 6/section
  sebagai batas lunak, boleh lebih kalau analisa kaya, ATAP KERAS 8 — lebih dari itu
  dipotong ambil 8 pertama saat parsing), tersimpan di
  `Insight.points` (unik per `(report, section)` — generate ulang = replace) bersama
  `Insight.numbers` = snapshot kosakata angka singkat yang dikirim ke model. **Bold angka
  metrik deterministik, TANPA penanda markdown dari LLM**: renderer (PPT & web) memecah tiap
  poin jadi run normal/bold via pencocokan substring terhadap kosakata itu (`lib/insight-format.ts`,
  kandidat terpanjang dulu, DAN wajib berdiri sebagai token utuh) — tak bisa rusak (tak ada
  sintaks penanda), dan yang di-bold pasti
  bentuk singkat yang dihitung dari `Extraction`; angka yang ditulis model menyimpang otomatis
  TIDAK di-bold (terlihat, bukan bold nyasar). Batas token (Jul 2026): kecocokan ditolak bila
  didahului digit atau "#" ("Sumber #1"), atau diikuti digit/"%" — tanpa itu "4,4%" ikut
  mem-bold ekor "14,4%" dan "50" mem-bold ekor "2050". Titik/koma hanya membatalkan bila
  diapit digit ("50.000"), supaya tanda baca akhir kalimat ("naik 4,4%.") tetap ter-bold.
  `kb_version` insight diisi via
  snapshot-lazy: saat generate, kalau `KbVersion` terbaru section tidak sama dengan `kbAnalysis`
  sekarang, buat versi baru (max+1) — provenance KB persis yang dipakai, tanpa membebani route
  section.

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
- [x] Tahap 6a — Analyst dasar: insight naratif satu-periode per section (angka terkini dari
  `Extraction` termasuk koreksi manual; wajib semua foto section sudah diekstrak; >1 foto
  dinarasikan per "Sumber #n" tanpa digabung; tanpa caption; UI generate + tampil di detail
  report, founder & operator). Pem-flag-an metrik wajib hilang DITUNDA ke Tahap 7/9 —
  insight menyebut kekurangan dalam teks, baris `Flag` belum ditulis. Revisi Jul 2026:
  output jadi poin-poin (target 6, atap keras 8) + snapshot kosakata angka untuk bold
  deterministik di renderer (lihat baris LLM Analyst di §Stack).
- [x] Tahap 6b-A — Perbandingan periode, data model + UI upload: toggle
  `usesPeriodComparison` per section (founder), penanda bulan per-foto ("YYYY-MM",
  dropdown 13 bulan) + periode utama eksplisit satu-per-(report, section). Lihat
  §Perbandingan Periode.
- [x] Tahap 6b-B — Perbandingan periode, perhitungan + narasi: persen/pp berantai antar
  bulan berdekatan dihitung DETERMINISTIK DI KODE dari Extraction (`computeChainedChanges`;
  metrik persen → poin persentase), Analyst hanya menarasikan via prompt varian; satu
  bulan satu foto ditegakkan server; persen ikut ter-bold (kosakata `Insight.numbers`).
  Lihat §Perbandingan Periode. Caption per-foto: bagian lama Tahap 6b, masih ditunda
  (backlog).
- [x] Tahap 7a — Validator, peran kesimpulan: baca SEMUA insight section satu platform →
  tulis poin kesimpulan platform itu (manual per platform dari halaman report; tabel
  `Conclusion` + `ValidatorKb`; angka verbatim dari insight, tanpa aritmetika/rekonsiliasi;
  slot Kesimpulan PPT terisi). Lihat catatan implementasi di §Validator & Kesimpulan.
- [x] Tahap 7b — Validator, cek konsistensi: kontradiksi logika + tone via instruksi bawaan
  TANPA KB; loop revisi 1x (instruksi koreksi ke Analyst, bukan tulis ulang; angka tetap
  dari Extraction), cek ulang, escalate + flag `inkonsistensi` severity `info`; jejak revisi
  `InsightRevision` tampil di halaman report. CATATAN: cek konsistensi-GAYA (via KB
  general/merangkai) DITUNDA → backlog. Lihat catatan implementasi di §Validator & Kesimpulan.
- [x] Tahap 8 — Template Engine: `.pptx` deterministik (TANPA AI) via `pptxgenjs`, builder murni
  `lib/ppt.ts`. Per blok platform (Shopee dulu): cover → slide per section (urut `narrativeOrder`;
  section masuk = yang punya upload; foto EMBEDDED di kiri — semua foto section satu slide, caption
  = label bulan user ("Juni 2026") bila section memakai perbandingan periode, selain itu
  "Sumber #n" saat >1; MAKS 4 foto per slide — selebihnya dipecah ke slide "(lanjutan)"
  dengan insight HANYA di slide pertama (Jul 2026: 5 foto sudah ≈0,86" dan tak terbaca;
  ≥12 foto membuat tinggi sel jatuh di bawah caption → geometri negatif → .pptx RUSAK);
  insight di kanan sebagai bullet list dengan ANGKA METRIK BOLD via run
  pptxgenjs — pencocokan kode terhadap `Insight.numbers`, bukan penanda LLM; kosong bila belum
  ada) → slide "Kesimpulan"
  KOSONG (slot Validator Tahap 7). Unduh dari halaman report (GET `/api/reports/[id]/pptx`),
  peringatan ringan non-blocking bila ada section berfoto tanpa insight. Tema netral terkumpul
  di `THEME` (`lib/ppt.ts`) — Tahap 10 tinggal mengganti. Caption per-foto (hasil Analyst 6b)
  belum ada — slot menyusul bersama 6b. Penggabungan DUA report (Shopee+TikTok) jadi satu PPT
  dua-blok TETAP TERTUNDA (lihat catatan §Platform).
- [x] Tahap 9 — Dashboard flag (founder): `/dashboard/flags` read-only, kelompok per
  (platform, section) + frekuensi lintas report — alat perbaikan KB (lihat §Sistem Flag)
- [x] Tahap 10 — Tema bulanan (config global "Cara B" + polesan estetik Tingkat 2):
  tabel `Theme` tunggal + `/dashboard/theme` (warna, font aman, logo, override aksen per
  platform) + cover/header/panel/footer/band kesimpulan bertema di `lib/ppt.ts` (lihat
  baris Tema & Polesan di §Stack)
- [x] Gaya agency Fase A (Jul 2026) — jenis slide baru: pembatas platform, Rekomendasi &
  Action Plan manual (tabel `Recommendation` + textarea per platform di halaman report),
  Thank You + kontak tema; cover jadi level-report. Lihat baris "Struktur PPT gaya agency"
  di §Stack.
- [x] Gaya agency Fase B (Jul 2026) — gaya visual default: primer default HITAM `111111`
  (migrasi memindah baris Theme existing hanya bila masih default lama; user tetap bebas
  ganti di `/dashboard/theme`); cover = logo atas + band primer "MONTHLY REPORT" + periode;
  judul section TEBAL BESAR UPPERCASE (bar aksen tetap); Kesimpulan/Rekomendasi = latar
  primer penuh + KARTU putih berisi poin (teks tetap gelap di dalam kartu, bold angka tak
  berubah); pembatas & Thank You senada (latar primer). Penyesuaian: slide SECTION ikut
  GELAP (latar primer; judul terang; foto dalam kartu putih membulat — foto tak pernah
  ditimpa, kartu di belakang; caption abu di dalam kartu — label bulan bila ada, selain itu
  "Sumber #n"; insight = panel
  primer-diterangkan-tipis + teks terang, bold angka tetap). Kontras SELALU dijaga
  `isDarkColor` (luminans, `lib/theme.ts`): tema berprimer TERANG otomatis memakai teks
  gelap/sekunder di semua slide berlatar primer — tak pernah putih-di-terang. Semua warna
  tetap dari tema — gaya agency hanya DEFAULT + struktur layout, bukan hardcode.
- [x] Gaya agency Fase C (Jul 2026) — sub-poin bertingkat SATU tingkat pada insight &
  kesimpulan, Analyst/Validator yang memutuskan kapan perlu (tidak diatur user).
  Penyimpanan: tetap `String[]` — sub-poin = elemen ber-PREFIX TAB (`\t`), kompatibel
  mundur (poin lama datar tetap sah; berlaku juga `InsightRevision.points*`); helper
  `parsePointLine`/`flattenPoints` di `lib/insight-format.ts`; `splitByNumbers` per baris
  tak berubah (bold tetap). Structured output ketiga jalur LLM (generate + revisi +
  kesimpulan) = `{points: [{text, sub[]}]}` via `POINTS_SCHEMA`/`pointsOutputRule`/
  `parseStructuredPoints` bersama di `lib/analyst.ts`. Atap dihitung atas TOTAL BARIS
  (poin + sub): target 6 lunak, atap keras 8 — dipotong pada array rata (sub selalu
  setelah induknya, tak pernah ada sub yatim). Render: PPT `indentLevel:1` + bullet
  sekunder (en dash) + huruf sedikit kecil; web = komponen `BoldPoints` bersama
  (insight, kesimpulan, before/after revisi).
- [ ] Tahap 11 — Deploy ke Railway

**Backlog (disengaja ditunda, keputusan audit Jul 2026):**
- Penanda bulan per-foto + flag perbandingan-periode di Section → Tahap 6b (lihat §Perbandingan Periode).
- Versioning `ValidatorKb` (à la `KbVersion` section) + provenance KB di `Conclusion` —
  relevan saat sistem flag (Tahap 9); untuk sekarang KB Validator tanpa versi.
- Cek konsistensi-GAYA oleh Validator (konsistensi TERHADAP GAYA agency, acuan KB
  general/merangkai) — menyusul setelah founder mengisi KB; dua cek bawaan (kontradiksi +
  tone) sudah jalan di Tahap 7b.
- Konfirmasi label ringan eksplisit (saat ini: dropdown + simpan eksplisit; `labelConfirmed` selalu true).
- ~~Bersihkan file storage saat hapus report~~ — SELESAI (Jul 2026): `DELETE /api/reports/[id]`
  menghapus file R2/disk semua upload DULU lalu cascade DB (Model B akses); tombol "Hapus report"
  di halaman detail report.

**Fitur report tambahan (Jul 2026):** `Report.brandName` (nama brand/toko, nullable — report
lama tak punya) diisi saat buat report; periode report kini dropdown "bulan lalu/ini/depan"
(nilai = label bulan sebenarnya). Brand tampil di daftar & detail report. PPT tak berubah.

## Akses & Permission (audit pra-deploy, Jul 2026)

- **MODEL B akses report (keputusan user):** SEMUA akun terautentikasi (founder & operator)
  boleh mengakses SEMUA report — buka, upload, generate insight/kesimpulan/PPT, isi
  rekomendasi. Kepemilikan (`createdById`) BUKAN batas akses (operator bekerja bergantian
  pada report yang sama). Satu titik aturan: `canAccessReport` (`lib/reports.ts`) — semua
  route report-scoped tetap memanggilnya. Daftar report tampil semua untuk semua peran.
- **Yang terlarang bagi operator hanya fitur founder:** KB section (`/api/sections*`),
  KB Validator, users, flags, theme (+logo) — semuanya 403 untuk non-founder, terverifikasi
  matriks runtime (anon/operator/founder) saat audit.
- **Guard server halaman founder:** 5 halaman founder adalah client component — `layout.tsx`
  server per route (`sections`, `users`, `theme`, `validator-kb`, `flags`) mengalihkan
  non-founder SEBELUM shell terkirim (temuan audit: tanpa guard, shell fitur ter-render
  meski data 403).
- **Anti-bocor KB tidak langsung:** payload halaman report (bahan dropdown section) memilih
  field eksplisit TANPA `kbAnalysis` — diverifikasi runtime terhadap fragmen isi KB
  sungguhan dari DB, bukan cuma nama field. Jaga pola ini saat menambah endpoint/halaman.

## Audit kode menyeluruh (pra-deploy, Jul 2026)

Sudah DIPERBAIKI (K = kritis, P = penting):
- **K1** `AUTH_SECRET` wajib — fallback "" dihapus; `sign()` gagal keras kalau kosong
  (lazy, import/build aman). Cegah pemalsuan cookie sesi founder.
- **K2/K3** Fallback dev yang menyembunyikan salah-konfigurasi produksi kini gagal keras:
  guard bersama `lib/llm.ts` (produksi tanpa `ANTHROPIC_API_KEY` → throw, tak nge-stub data
  palsu); `getStorage()` (produksi tanpa R2 lengkap → throw, tak jatuh ke disk sementara).
- **P1** Offboarding: `DELETE /api/users/[id]` (founder) — guard tak-hapus-diri-sendiri,
  tak-hapus-founder-terakhir, pre-check report (409).
- **P2/P3** Deteksi basi: `Extraction.updatedAt` + `Upload.updatedAt` (backfill epoch) →
  halaman report menandai insight/kesimpulan yang datanya berubah sesudah dibuat +
  peringatan di tombol Unduh PPT. (Catatan: hapus-foto-saja setelah generate TIDAK
  memicu badge — max-timestamp tak turun; jarang, generate ulang tetap manual.)
  **Penting (Jul 2026): server hanya menghitung ini saat halaman DIMUAT.** Klien wajib ikut
  menandai basi setelah tiap mutasi (`markStale` di UploadManager: unggah, hapus foto, ganti
  bulan, ekstrak, koreksi angka; generate insight → membasikan kesimpulan platformnya).
  Tanpa itu layar tetap tampak segar sesudah koreksi angka, dialog peringatan sebelum Unduh
  PPT tak pernah menyala, dan deck terkirim dengan narasi lama — tidak ada `router.refresh()`
  di aplikasi ini, jadi tak ada mekanisme pemulih lain selain reload manual.
- **Batch B audit (Jul 2026)** — empat cara output rusak/hilang tanpa sinyal:
  (a) blok platform hanya dilewati bila BENAR-BENAR kosong (tanpa foto DAN tanpa kesimpulan
  DAN tanpa rekomendasi) — dulu cukup "tanpa foto", sehingga rekomendasi platform yang
  tersimpan 200 lenyap dari deck dan sampul cuma menulis satu platform;
  (b) `containRect` menolak kotak ≤0 → geometri negatif tak pernah lolos ke pptxgenjs;
  (c) unggah foto & logo memverifikasi MAGIC BYTES lewat `imageSizePx`, bukan Content-Type
  kiriman client — file teks/PDF ber-`type=image/png` dulu diterima 201 lalu tertanam ke
  deck sebagai .png rusak tanpa error di titik mana pun;
  (d) `storage.read()` hanya mengembalikan null untuk "objek tidak ada"; gangguan R2 nyata
  (kredensial/jaringan/bucket) DILEMPAR → route pptx membalas 502 berpesan dan status report
  TIDAK maju ke `downloaded`. Dulu semua error jadi null, jadi gangguan R2 menyamar sebagai
  "foto belum diunggah" dan deck kosong terkirim dengan HTTP 200.
- **Batch C audit (Jul 2026)** — akun & sesi:
  (a) `PATCH /api/users/[id]` — reset password & ubah peran. Sebelumnya TIDAK ADA jalur
  mengubah keduanya, sehingga operator yang lupa password tidak bisa direset DAN tidak bisa
  dihapus bila sudah pernah membuat report (409) → akun terkunci permanen. Founder boleh
  mengubah siapa pun; user biasa hanya password DIRINYA dan wajib password lama. Guard:
  peran dari allowlist, founder terakhir tak boleh diturunkan, peran diri sendiri tak boleh
  diubah. UI: tombol reset + dropdown peran di halaman Users, kartu "Password akun" di dashboard.
  (b) Sesi diperkeras: klaim `exp` DI DALAM payload bertanda tangan (dulu 7 hari hanya
  ditegakkan browser — nilai cookie yang tersalin berlaku selamanya lewat curl); `role` dan
  keberadaan akun dibaca ULANG dari DB tiap request (dulu dipercaya dari cookie, sehingga
  offboarding tidak berfungsi — akun terhapus tetap bisa dipakai); bentuk payload divalidasi;
  tanda tangan dibandingkan `timingSafeEqual`. Biaya: satu lookup primary key per request.
  Konsekuensi rilis: cookie format lama (tanpa `exp`) ditolak → semua orang login ulang sekali.
  (c) Badge report DITURUNKAN dari data, bukan kolom `status` — lihat `reportProgress`
  (`lib/reports.ts`). Nilai enum `processing`/`done` memang tak pernah ditulis di mana pun.
  Halaman detail juga memakai penanda basi sehingga foto tambahan ke section yang sudah
  punya insight memunculkan "Perlu generate ulang"; daftar report sengaja tidak (butuh
  agregat updatedAt per report) dan itu batas yang diketahui.
- **Batch D audit (Jul 2026)** — kegagalan yang tak terlihat user:
  semua `res.json()` di klien memakai `.catch(() => ({}))` dan pesan cadangannya menyebut
  kode status (respons 500 HTML / 413 proxy / body kosong dulu melempar dan muncul sebagai
  "Kesalahan jaringan." padahal jaringan sehat); `deleteSaved` & `patchSavedPeriod` kini
  punya try/catch, guard klik-ganda, dan pesan per-foto (dulu hapus foto yang gagal membuat
  layar TIDAK berubah sama sekali); `savePending` mereset state saat 403 sehingga tombol
  tidak macet "Menyimpan…" selamanya; halaman Sections menampilkan pesan 409 dari server
  ("masih dipakai N foto") alih-alih membuangnya; ukuran file divalidasi di klien SEBELUM
  unggah; ketikan Rekomendasi yang belum disimpan ditandai "• belum tersimpan" + peringatan
  `beforeunload`.
  > Pelajaran yang dicatat: `tsc` TIDAK menangkap TDZ ketika referensi maju berada di dalam
  > callback (`platforms.some((p) => recoDirty(p))` sebelum `recoDirty` dideklarasikan).
  > Perubahan komponen client WAJIB diverifikasi dengan benar-benar merender halamannya.
- **Batch E1 audit (Jul 2026)** — `fit: "shrink"` DIBUANG dari seluruh `lib/ppt.ts`.
  pptxgenjs menulis `<a:normAutofit/>` telanjang TANPA `fontScale` (barisnya sengaja
  dikomentari di sumber library), dan PowerPoint baru menghitung skala saat teks diedit
  MANUAL — jadi di file yang dikirim ke klien teks dirender ukuran penuh dan TUMPAH keluar
  slide (terukur 13,61" teks di kotak 5,40" untuk rekomendasi 50 baris). Penggantinya
  deterministik, sejalan prinsip "tata letak dihitung di kode": `estimateTextHeight` +
  `fitFontSize` menurunkan ukuran bertingkat (judul section 24→14, subjudul cover 18→11,
  poin insight 13→9, rekomendasi 13→10), dan rekomendasi yang tetap tak muat di ukuran
  terkecil dipecah ke slide "Rekomendasi & Action Plan (lanjutan)" — dihitung SEBELUM
  `pageTotal` sehingga penomoran halaman tetap benar. Kotak diisi maksimal `FILL_SAFETY`
  92% karena perkiraan lebar karakter tak pernah persis.
- **Batch E2 audit (Jul 2026)** — validasi masukan API:
  tipe diperiksa saat RUNTIME sebelum memanggil method string (`brandName: 123` dulu
  menghasilkan 500 dengan body KOSONG, jadi klien tak menerima pesan apa pun); batas
  panjang `brandName` 120 & `reportPeriod` 60 (keduanya ikut ke cover, brandName juga ke
  nama berkas unduhan lewat Content-Disposition); `reportPeriod` menolak baris baru;
  format email divalidasi di server (input `type="email"` di halaman Users ada di LUAR
  `<form>` sehingga validasi browser tak pernah jalan); `narrativeOrder` dibatasi 0–9999
  (di luar rentang int4 dulu jadi 500 dari lapisan DB); seluruh `res.json()` di semua
  halaman client diberi `.catch(() => ({}))` — Batch D hanya menyentuh UploadManager.
  > Batas yang diakui: pembatasan `reportPeriod` MEMPERSEMPIT ruang prompt injection ke
  > Validator, tidak menutupnya — kalimat satu baris <60 karakter masih lewat. Memadai
  > untuk alat internal dengan operator tepercaya; kalau berubah, ganti ke allowlist format.
- **P4** Hapus section/user ber-relasi → pre-check count = 409 berpesan (relasi RESTRICT =
  Postgres 23001 di-surface Prisma sbg UnknownRequestError, bukan P2003 — jangan andalkan
  kode error).
- **P5** `Report.status` transisi `draft → downloaded` saat PPT PERTAMA diunduh (enum
  `downloaded` baru; hanya maju dari draft).
- **P6** Root `/` → redirect `/login` (dulu template create-next-app).
- **P7** Throttle login gagal (`lib/login-throttle.ts`, in-memory per email+IP): 3 percobaan
  gratis lalu delay 0,5s→1s→2s→… (maks 8s), reset saat sukses.

Sudah DIPERBAIKI (M = minor, kelompok terakhir audit):
- **M1** eslint `argsIgnorePattern: "^_"` — argumen ber-prefix `_` (mis. param Model B
  `canAccessReport`) tak lagi di-warning. tsc + eslint = NOL warning.
- **M2** Ekspor mati `PLATFORMS` (`lib/sections.ts`) dibuang.
- **M3** Kolom denormalisasi mati `Upload.reportPeriod` di-drop (hanya ditulis, tak dibaca).
- **M4** Konfigurasi seed pindah `package.json#prisma` → `prisma.config.ts` (deprecation
  hilang; `.env` dimuat manual via dotenv karena config file mematikan auto-load); script
  `typecheck` ditambah.
- **M6** `BoldPoints` (UploadManager) — ternary redundan disederhanakan.
- **M7** `@@unique([reportId, sectionId, periodMonth])` di `Upload` — satu bulan satu foto
  ditegakkan DB (NULL distinct → section non-perbandingan tetap boleh >1 foto); route
  upload menangkap P2002 sebagai pesan ramah (race-safe).
- **M8** `@@unique([sectionId, version])` di `KbVersion` — cegah duplikat versi; route
  insight menangkap P2002 → pakai versi pemenang (tanpa 500).

Utang teknis TERCATAT (C = catatan — boleh pasca-deploy):
- **C** Cookie sesi memuat `role` (edit-role tak berlaku sampai sesi kedaluwarsa);
  `canAccessReport` selalu true (Model B — branch redirect praktis mati, dipertahankan
  sbg titik aturan); `UploadManager.tsx` ~1.4k baris (pecah saat sempat); pemotongan atap
  sub-poin pada array rata (by design); `puppeteer-core` devDependency dari sesi screenshot.
- **DB dev (Jul 2026):** instance Railway `railway` sempat ter-reset (data hilang, tabel
  `_prisma_migrations` tak ada). Migrasi P2/P5 di-apply langsung via `db execute` ke DB dev;
  DB produksi baru (Tahap 11) menerima seluruh migrasi via `migrate deploy` di DB kosong.

## Catatan Operasional

- Railway Postgres cold-start: request pertama tiap sesi bisa 500 ("Can't reach database
  server"), retry sukses. Bukan bug. Pertimbangkan pesan error ramah saat DB belum siap.
- Ganti password founder default sebelum produksi. Akun uji audit
  (`audit-operator@test.local`) dibuat saat audit Jul 2026 — hapus sebelum produksi.
- **Uji beban (audit Jul 2026, dev server lokal — batas bawah konservatif):** 20 request
  paralel campuran (14 generate PPT ke 2 report berbeda + 6 baca data) → 20/20 sukses,
  tidak ada isi PPT tertukar (diverifikasi penanda periode+platform di tiap file; jalur PPT
  bebas state modul mutable — hanya singleton set-once storage/prisma). PPT tunggal ~2,2s;
  di bawah 14 pptx bersamaan naik ke rata-rata ~5s/maks 6,8s (CPU-bound, event loop Node);
  puncak RSS proses dev +287 MB di atas baseline ~169 MB. Kesimpulan: ~20 user AMAN untuk
  pola pakai nyata (generate PPT sesekali). Titik lemah pertama bila beban naik: banyak
  generate PPT BERSAMAAN (CPU + buffer gambar in-memory) — mitigasi masa depan: antrian/
  batas konkuren di route pptx, bukan optimasi prematur sekarang. LLM bersamaan aman secara
  arsitektur (client per panggilan, input per-request, upsert berkunci unik); catatan: dua
  generate serentak pada section yang sama = last-write-wins, dan snapshot lazy KbVersion
  bisa membuat dua baris versi pada balapan ekstrem (jinak — hanya provenance).
