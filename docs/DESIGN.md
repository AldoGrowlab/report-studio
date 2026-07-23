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
   - **Metrik DURASI (Jul 2026) tidak ikut aturan k/jt/miliar.** Disimpan dalam satuan
     KANONIK **detik** di `Extraction.value`, dibahasakan sebagai "1j 23mnt 45dtk"
     (komponen bernilai 0 dibuang; minimal "0dtk"). 5.025 detik → "1j 23mnt 45dtk",
     BUKAN "5,0k". Lihat §Tipe Metrik Durasi.
   - **Metrik TEKS (Jul 2026) di luar aturan ini seluruhnya** — bukan angka, jadi tak
     pernah disingkat, dihitung, maupun di-bold. Disimpan apa adanya di
     `Extraction.rawText` (`value` NULL). Lihat §Tipe Metrik Teks.

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

## Tipe Metrik Durasi (Jul 2026)

Tipe metrik kelima di samping `number`/`currency`/`percent`/`ratio`: **`duration`**
(label UI "Durasi"), untuk metrik seperti durasi live. (Yang keenam, `text`, dibahas di
§Tipe Metrik Teks.)

- **Satuan kanonik = DETIK** di `Extraction.value` (Prinsip #6: simpan penuh, singkat hanya
  saat dibahasakan). `raw_text` tetap teks asli apa adanya (mis. `01:23:45`).
- **Bentuk yang dibaca dari screenshot** (keputusan user): `hh:mm:ss`, `... s`, `... min`,
  `...h...min`. Ditambah varian Indonesia yang lazim: `jam/j`, `menit/mnt`, `detik/dtk`,
  dan gabungan (`1h 30m 15s`, `2 jam 15 menit`). Desimal koma diterima (`1,5 jam`).
  Dua bagian bertitik dua dibaca **mm:ss** (`12:30` = 750 detik), tiga bagian **hh:mm:ss**.
  Angka telanjang tanpa satuan → diperlakukan detik.
- **Parsing DETERMINISTIK di kode** (`lib/duration.ts`, bukan aritmetika LLM — Prinsip #1),
  dan **punya jalur sendiri di Extractor**: normalizer notasi singkatan membuang `:` sehingga
  `01:23:45` terbaca **12345** (bukan 5025) — itu sebabnya `type === "duration"` dicabang
  sebelum normalizer. Suffix besaran (k/jt/M) tidak berlaku → `unknownMagnitude` selalu false.
- **Perbandingan periode**: durasi adalah besaran, jadi memakai rumus RELATIF (`+50,0%`)
  seperti number/currency/ratio — bukan poin persentase (itu khusus `percent`).
- **UI koreksi manual**: nilai ditampilkan & diketik manusiawi ("1j 23mnt", "01:23:45",
  "45 s") lalu dikonversi ke detik di client; API `/api/extractions/[id]` tetap hanya
  menerima angka (satuan kanonik) — kontrak server tidak berubah.

## Tipe Metrik Teks (Jul 2026)

Tipe metrik keenam: **`text`** (label UI "Teks"), untuk nilai yang memang BUKAN angka —
nama produk, nama affiliator. Tujuannya agar nama dari screenshot ikut dianalisa Analyst,
bukan cuma angkanya.

- **Penyimpanan: menumpang `Extraction.rawText`, `Extraction.value` tetap NULL.** TANPA
  kolom/tabel baru — satu-satunya perubahan schema adalah nilai enum `MetricType`
  (`ALTER TYPE ... ADD VALUE 'text'`, aditif & non-destruktif). Alasan: teks tak punya
  bentuk kanonik numerik, jadi kolom yang sudah menampung "teks apa adanya dari gambar"
  adalah tempat yang benar; menambah kolom `textValue` hanya menduplikasi maknanya.
  **Konsekuensi yang diterima:** untuk metrik teks `rawText` BUKAN lagi provenance OCR
  murni — koreksi manual menimpanya, karena di sanalah nilainya tinggal. Untuk metrik
  ANGKA aturan lama tetap: koreksi manual TIDAK menyentuh `rawText`/`confidence`.
- **Keputusan isi: simpan apa adanya, tanpa elipsis akhir, tanpa tebakan.** Model diminta
  menyalin teks PERSIS seperti tertulis — dilarang menerjemahkan, merapikan ejaan, atau
  melengkapi teks yang terpotong; kalau terpotong, salin yang terbaca saja. Pembuangan
  penanda potong dilakukan KODE (`lib/text-metric.ts`), bukan model: hanya `...`/`…`/`··`
  di **ujung** yang dibuang (`"Bumbu Mala Pedas Hot..."` → `"Bumbu Mala Pedas Hot"`).
  Titik TUNGGAL yang sah (`"75gr."`) dan bagian TENGAH teks tidak pernah disentuh.
- **Aturan baris-sama untuk metrik ber-indeks.** Metrik dengan sufiks indeks sama WAJIB
  berasal dari baris tabel yang sama: `nama_produk_1` + `penjualan_produk_1` = baris
  peringkat 1 (baris teratas sesuai urutan tampil), `_2` = baris ke-2, dst. Model dilarang
  mengurutkan ulang tabel. Saat data dirakit untuk Analyst, pasangan itu dirender sebagai
  `- Peringkat 1 — <nama>: <angka>` (per bulan pada section perbandingan, per Sumber #n
  pada section multi-sumber). Metrik teks tanpa pasangan angka tampil `- <Label>: <teks>`.
- **Jalur sendiri di Extractor, didahulukan sebelum normalizer angka** — kalau lolos ke
  sana, `"Bumbu Mala 75gr"` terbaca **75** dan `"Kaos Polos 2M"` jadi **2 miliar**.
- **Tidak pernah ikut aritmetika**: `computeChainedChanges` melewati metrik teks, jadi
  tak ada persen/pp untuk nama. **Tidak pernah ter-bold**: `valueText` metrik teks null,
  sehingga nama tak masuk `Insight.numbers` (kosakata bold) — nama bukan angka.
- **Aturan Analyst tambahan** (hanya muncul di prompt kalau section punya metrik teks,
  jadi prompt section lama tak berubah): nama dikutip persis; teks terpotong dirujuk apa
  adanya atau lewat peringkatnya, dilarang ditebak; pada section perbandingan periode,
  sebelum menarasikan persen suatu peringkat wajib dicek apakah nama peringkat itu sama
  di kedua bulan — kalau berbeda, dibingkai sebagai **pergantian penghuni peringkat**
  (sebut kedua nama), bukan naik/turunnya satu produk.
- **UI koreksi manual**: input TEKS (bukan angka), maks 200 karakter, dibersihkan dengan
  helper yang SAMA dengan Extractor. API `/api/extractions/[id]` menerima
  `{ rawText: string | null }` untuk metrik teks dan `{ value: number | null }` untuk
  metrik angka — bentuk body ditentukan TIPE metrik di server, bukan oleh client. Alur
  low-confidence → konfirmasi manual berlaku sama seperti angka.

## Gabung Foto (pra-proses client, Jul 2026)

Satu tampilan seller center sering tidak muat dalam satu screenshot (terpotong ke bawah
atau ke samping). Operator memilih potongan-potongannya, menggabungkannya jadi **SATU file
gambar di sisi CLIENT**, lalu mengunggahnya lewat alur yang sudah ada.

- **TANPA perubahan backend.** Endpoint unggah, schema Prisma, alur ekstraksi, dan aturan
  "section perbandingan periode = satu bulan satu foto" tetap utuh. Server menerima satu
  file biasa dan tidak tahu file itu hasil gabungan. Hasil gabungan masuk ke ANTREAN unggah
  yang sama, jadi pemilihan bulan + periode utama berjalan persis seperti foto tunggal.
- **TIDAK ADA deteksi/pembuangan irisan otomatis berbasis konten gambar.** Sudah dibuktikan
  dengan foto produksi: dua screenshot berulang dari jendela yang sama **tidak identik
  piksel** (ukuran jendela beda beberapa px + resampling), sehingga pencocokan piksel gagal
  SENYAP — dan kegagalan senyap pada bahan angka melanggar Prinsip #1. Irisan dibuang
  operator lewat **crop interaktif**, dan konfigurasinya disimpan sebagai preset supaya
  hanya sekali kerja.
- **Penggabungan deterministik**: crop → skala proporsional → tempel berurutan. Tidak ada
  AI, tidak ada content-aware apa pun. Vertikal: lebar hasil = lebar TERBESAR pasca-crop,
  tiap potongan diskalakan ke lebar itu, ditempel dari atas. Horizontal: cerminnya.
  Geometrinya MURNI di `lib/merge-images.ts` (tanpa DOM/canvas) sehingga bisa diuji penuh;
  yang menggambar hanya modal client lewat `ctx.drawImage`.
- **Trim disimpan sebagai FRAKSI 0..1 per sisi, bukan piksel** — supaya preset dari bulan
  lalu tetap benar walau screenshot bulan ini beda resolusi (potongan 56% pada foto 1844px
  jatuh proporsional di foto 2304px). Guard: potongan tidak boleh menyisakan < 10% dimensi
  asli per sumbu.
- **Arah gabung: default "Vertikal" + toggle satu klik + preview**, bukan tebakan pintar.
  Auto-deteksi HANYA menyala pada sinyal tegas — satu sumbu mirip antar foto (< 15%) DAN
  sumbu lainnya beda jauh (> 40%). Alasan: screenshot jendela yang sama hampir selalu
  berdimensi mirip di KEDUA sumbu, dan dimensi tidak mencerminkan arah scroll konten;
  menebak dari sinyal lemah berarti operator harus membatalkan tebakan kita tiap kali.
- **Preview WAJIB.** Kanvas dirender ulang (debounce ~150 ms) tiap file/arah/urutan/trim
  berubah, dan tombol simpan hanya hidup saat kanvas yang tergambar cocok dengan keadaan
  sekarang (dibandingkan lewat tanda-tangan) — tidak ada celah menyimpan kanvas basi.
- **Guard dimensi 8000 px**: kalau sisi terpanjang hasil melebihi itu, SELURUH kanvas
  diperkecil proporsional (bukan per gambar, supaya baris tabel tetap sejajar) dan preview
  menandainya "diperkecil otomatis". Selain kasus ini resolusi TIDAK pernah diturunkan —
  ketajaman file menentukan akurasi ekstraksi vision.
- **Keluaran**: `canvas.toBlob("image/png")`; hanya kalau melebihi batas unggah, mundur ke
  `image/jpeg` quality 0.9. Nama file `gabungan_<timestamp>.png|jpg`. Latar kanvas putih
  (JPEG tak punya alpha).
- **Preset per section**: `{arah, jumlahFoto, trimPerPosisiFoto}` disimpan di
  `localStorage` dengan key `mergePreset:<sectionId>` saat hasil gabungan disimpan.
  Diterapkan otomatis saat modal dibuka lagi untuk section yang sama DAN jumlah foto sama,
  dengan badge "preset bulan lalu diterapkan — periksa preview" + tombol "Reset preset".
  MURNI client-side, tidak ada penyimpanan server (preset adalah kenyamanan operator, bukan
  bahan report — kegagalan `localStorage` di mode privat tidak menggagalkan penggabungan).
- **Alur unggah foto tunggal tidak berubah sedikit pun.**

### Auto-potong (AI) — pengisi saran, bukan eksekutor

Satu tombol di modal: Claude vision melihat potongan-potongan terpilih, lalu **mengisikan**
arah gabung + fraksi trim per foto ke kontrol yang sudah ada.

- **Peran AI SEMPIT dan disengaja.** Model tidak pernah memotong, menggabung, atau menyimpan
  apa pun. Crop + gabung tetap dieksekusi deterministik oleh `lib/merge-images.ts`, dan
  **preview tetap gerbang keputusan operator** — sejalan Prinsip #1: apa pun yang menyentuh
  bahan angka wajib bisa diperiksa mata manusia sebelum dipakai. Setelah saran masuk,
  operator tetap bisa menggeser garis potong (state-nya sama persis).
- **Prioritas nilai trim saat modal dibuka: preset localStorage > Auto-potong > 0.** Preset
  yang ada diterapkan **tanpa memanggil AI sama sekali** — nilai yang sudah divetting
  operator bulan lalu lebih tepercaya daripada tebakan baru, dan gratis. Tombolnya tetap
  tersedia untuk re-run manual. Hasil AI yang disimpan operator otomatis menjadi preset
  bulan berikutnya, jadi biayanya sekali per section, bukan tiap bulan.
- **Model tier hemat, dapat ditimpa env** — `MERGE_SUGGEST_MODEL`, default
  `claude-haiku-4-5-20251001`. Pola SAMA dengan `PERIOD_DETECT_MODEL` (lihat §Deteksi Bulan
  Otomatis). Yang dibaca tata letak, bukan angka, jadi tier termurah memadai; naikkan lewat
  env tanpa menyentuh kode bila akurasi sarannya kurang. Extractor/Analyst/Validator TETAP
  `claude-opus-4-8` dan tidak pernah ikut diturunkan — merekalah yang menyentuh angka.
- **Hemat token**: foto dikecilkan ke sisi terpanjang ≤ 1200 px sebelum dianalisis (di
  client DAN lagi di server sebagai jaring pengaman). Yang dianalisis tata letak — mana blok
  yang terulang — bukan angkanya. Fraksi hasilnya berlaku ke resolusi ASLI di client; inilah
  keuntungan menyimpan trim sebagai fraksi, bukan piksel.
- **Bias ke aman: ragu = tidak memotong.** Prompt memerintahkan trim 0 + confidence rendah
  bila model tidak yakin, termasuk bila foto-foto itu ternyata bukan potongan satu tampilan.
  Aturannya eksplisit: gabungan bagian tersisa WAJIB memuat semua elemen unik — lebih baik
  hasilnya dobel daripada ada data yang terbuang.
- **Validasi server atas keluaran model** (`lib/merge-suggest.ts`, murni & teruji): fraksi
  di-clamp ke 0..0,7; saran yang menyisakan < 10% pada sumbu mana pun **di-reset ke 0 untuk
  foto itu** (bukan dipaksa masuk batas — potongan sedalam itu hampir pasti salah baca);
  jumlah foto tak cocok / bentuk respons rusak → semua trim 0. Sanitizer tidak pernah
  melempar, dan keluarannya dijamin lolos guard geometri.
- **Confidence < 0,6 → badge peringatan** ("AI kurang yakin — periksa/geser garis potong")
  menggantikan badge biasa; `reason` satu kalimat selalu ditampilkan.
- **Gagal apa pun = trim tidak berubah** (Prinsip #3): fitur bantu tidak boleh menghentikan
  pekerjaan, operator masih bisa menggeser garis potong manual. Tanpa API key di dev,
  endpoint mengembalikan trim 0 + confidence 0 — TIDAK mengarang potongan.
- **Catatan pemakaian (teruji Jul 2026):** alokasi potongan bervariasi antar-run — membuang
  grafik ganda lewat foto #1 atau foto #2 sama-sama sah dan menghasilkan isi yang sama.
  Yang KONSISTEN: arah benar, tidak ada elemen unik yang hilang, dan keluarannya selalu
  lolos guard. Kasus kolom beku (horizontal) jauh lebih stabil daripada kasus panel kartu.
  Itulah sebabnya preview tetap wajib dan preset dipertahankan menang atas AI.
- **Endpoint** `POST /api/merge-suggest` — session-guarded, TIDAK menyentuh DB dan tidak
  menyimpan apa pun (karena itu tak ada pemeriksaan kepemilikan report: tak ada report yang
  terlibat). Bagian server-only (sharp + SDK) dipisah ke `lib/merge-suggest-vision.ts`
  supaya modal client bisa memakai kontraknya tanpa menyeret sharp ke bundle browser.

## Deteksi Bulan Otomatis (Jul 2026)

Extractor ikut menyalin teks periode yang tampak di screenshot; kode memetakannya ke bulan
kalender; hasilnya **mengisi** label bulan report bila masih kosong, atau menjadi
**pemeriksaan** bila bulan report sudah ada.

**DUA JALUR dengan tugas berbeda** (revisi Jul 2026):

| Jalur | Kapan | Model | Tugas |
|---|---|---|---|
| `POST /api/period-detect` | saat foto DIPILIH, sebelum/selagi unggah | tier hemat (default `claude-haiku-4-5-20251001`, dapat ditimpa `PERIOD_DETECT_MODEL`) | **pengisi** label "bulan foto ini" per foto, dan bulan report bila masih kosong |
| `detectedPeriod` pada ekstraksi | saat "Ekstrak angka" | model Extractor (menumpang, **gratis**) | **pembanding** untuk guard salah-bulan Validator |

- **Biaya**: jalur pengisi = satu panggilan vision KECIL per foto yang dipilih (gambar
  dikecilkan ke ≤1200 px, keluaran satu field pendek), memakai tier termurah. Dipanggil
  untuk setiap foto tanpa melihat jenis section — saat foto dipilih, section-nya memang
  belum ditentukan, dan hasilnya tetap berguna untuk mengisi bulan report. Jalur pembanding
  **tidak menambah panggilan sama sekali**: satu field menumpang respons ekstraksi yang
  memang sudah diminta.
- **Prompt jalur pengisi menyaring di sumbernya**: salin PERIODE UTAMA saja; abaikan
  periode PEMBANDING ("Bandingkan", "vs", rentang kedua setelah rentang utama) dan
  TIMESTAMP pembaruan ("Diperbarui pada", "Data diperbarui", tanggal tunggal ber-jam).
  Tidak ada periode utama → null.
- **Parser menyaring lagi sebagai lapis kedua** (`stripComparisonNoise`): segmen yang
  memuat penanda pembanding/pembaruan dipangkas tepat di penandanya. Perlu karena teks
  periode juga datang dari jalur ekstraksi yang prompt-nya lebih umum — tanpa ini
  `"Jun 01, 2026 - Jun 30, 2026 | Bandingkan May 02, 2026 …"` terbaca lintas bulan → null,
  padahal periode utamanya jelas.
- **Pembagian tugas seperti normalisasi notasi & durasi (Prinsip #1):** model HANYA
  menyalin teks periode APA ADANYA (`"01/06/2026 - 30/06/2026"`, `"Juni 2026"`,
  `"30 hari terakhir"`) dan dilarang menyimpulkan bulannya sendiri. Pemetaan teks → bulan
  dikerjakan parser DETERMINISTIK `lib/period-parser.ts` yang teruji penuh.
- **Parser bersikap KONSERVATIF — ragu berarti diam.** Menghasilkan `null` (tanpa autofill,
  tanpa peringatan) bila:
  - rentang tanggal melintasi lebih dari satu bulan kalender (`15/05/2026 - 14/06/2026`),
    termasuk saat salah satu ujungnya tak bertahun (`28/05 - 30/06/2026`);
  - label relatif tanpa tanggal eksplisit (`30 hari terakhir`, `minggu ini`, `bulan lalu`);
  - **tahun tidak terlihat** (`Juni`, `1 - 30 Juni`) — tahun tidak pernah dikarang;
  - bulan sama tapi tahun berbeda (`Juni 2026 - Juni 2027`).
  Format yang dikenali: `DD/MM/YYYY` (juga `-` dan `.`) tunggal maupun rentang, nama bulan
  Indonesia & Inggris beserta singkatannya, gaya Inggris `MMM DD, YYYY - MMM DD, YYYY`
  (`Jun 01, 2026 - Jun 30, 2026`), `MM/YYYY`, `YYYY-MM`, `YYYY-MM-DD`, dan **`YYYY.MM`**
  (`Periode Data Per Bulan 2026.06 (GMT+07)` — bentuk nyata Shopee; noise zona waktu di
  sekitarnya diabaikan). Tanggal eksplisit MENANG atas label relatif yang menyertainya.
- **Label bulan PER FOTO** terisi dari jalur pengisi begitu foto dipilih, dengan badge
  "terdeteksi" dan penanda "mendeteksi bulan…" selama menunggu. Beberapa foto dideteksi
  PARALEL, masing-masing mengisi labelnya sendiri. Gagal atau tak terbaca = **diam**
  (silent fallback): dropdown tetap "— bulan foto ini —", tanpa pesan error yang
  mengganggu, operator memilih manual. **Pilihan manual menang permanen** — hasil deteksi
  yang datang belakangan tidak pernah menimpa nilai yang sudah dipilih.
- **Autofill bulan report hanya saat kosong, dan edit manual menang PERMANEN.**
  `Report.reportPeriod` kini nullable; `Report.periodDetected` menandai nilai hasil deteksi
  (badge "terdeteksi dari foto" di halaman report). Aturan "hanya saat kosong" ditegakkan
  DI SERVER (`PATCH /api/reports/[id]` dengan `detected: true`), bukan dipercayakan ke
  client — beberapa foto dideteksi paralel dan yang kedua tak boleh menimpa yang pertama.
  Menyunting periode manual menyetel `periodDetected=false`, sehingga deteksi berikutnya
  tidak akan pernah menimpanya lagi.
- **Guard salah bulan.** Bila bulan report sudah ada dan bulan hasil deteksi BERBEDA,
  ditulis `Flag` bertipe `periode`, severity **tinggi** (menyentuh presisi: screenshot dari
  bulan yang salah membuat seluruh angka report salah, bukan sekadar narasi janggal), dengan
  bunyi: *"Periode pada foto terbaca &lt;rawText&gt; (=&lt;Bulan YYYY&gt;), berbeda dengan bulan
  report (&lt;Bulan YYYY&gt;). Periksa apakah screenshot salah bulan."* Tampil di panel Flag
  halaman report yang sudah ada. Perbandingan hanya dilakukan bila KEDUA sisi bisa dipetakan
  parser — label kustom (`"Q2 2026"`) tidak pernah diprotes.
- **Umur flag mengikuti ekstraksi, bukan kesimpulan.** Flag `periode` dihapus-lalu-ditulis
  di tiap ekstraksi foto itu, jadi "Ekstrak ulang" tidak menumpuk peringatan. `deleteMany`
  milik alur kesimpulan discope ke `type: "inkonsistensi"`, jadi keduanya tidak saling hapus.
- **Ekstraksi metrik tidak terpengaruh sama sekali**: apa pun hasil deteksi periode, angka
  tetap diekstrak seperti biasa (Prinsip #3 — report selalu jalan sampai selesai). PPT tanpa
  periode memakai label "Periode belum ditentukan", tidak gagal.
- **Jejak per foto** disimpan di `Upload.detectedPeriodRaw` (teks apa adanya) dan
  `Upload.detectedPeriodMonth` (`"YYYY-MM"`, null bila tak bisa dipastikan) — provenance
  deteksi tetap bisa diperiksa, sejalan dengan pola `rawText` pada `Extraction`.

## Sub-grup Section (Fase 1, Jul 2026)

Section seperti **Promotion Tools** terdiri dari beberapa tool (Flash Sale, Diskon,
Voucher) yang **fotonya terpisah** dan metriknya **bernama sama** ("Penjualan"). Dua
akibatnya mengubah struktur, bukan sekadar tampilan:

- kelengkapan expected metrics **tidak boleh dinilai per FOTO** — satu foto hanya memuat
  metrik satu tool — melainkan **per SUB-GRUP atas gabungan foto** section itu;
- metrik bernama sama **wajib jadi entitas berbeda**, sehingga tabrakan mustahil secara
  STRUKTUR, bukan dicegah lewat konvensi penamaan.

**Kunci ber-scope: `platform + section + subGroupKey + nama metrik`.** Ini juga fondasi
referensi metrik turunan (Fase 2) — ref menunjuk kunci yang sama persis.

- **Section tanpa sub-grup = perilaku lama, persis.** Ia memakai satu sub-grup tunggal
  implisit dengan kunci sentinel `"_default"`.
- **Sentinel, BUKAN NULL — dan itu keputusan struktural.** `Upload` punya unique
  `(reportId, sectionId, subGroupKey, periodMonth)` untuk menegakkan "satu bulan satu foto
  per sub-grup" (tanpa `subGroupKey` di sana, Flash Sale Juni dan Voucher Juni di section
  yang sama akan ditolak database). Postgres memperlakukan **NULL sebagai saling berbeda**
  di unique constraint, jadi kolom nullable akan **diam-diam mencabut proteksi duplikat
  yang selama ini dinikmati section lama**. Sentinel membuat aturannya satu dan sama untuk
  section lama maupun baru. Alternatif `NULLS NOT DISTINCT` ditolak karena menuntut
  Postgres ≥15 dan tidak bisa dideklarasikan lewat `@@unique` Prisma 6 — indeksnya harus
  ditulis tangan, sehingga schema tak lagi menggambarkan database (drift).
  String ajaibnya dijinakkan di dua tempat: satu konstanta `DEFAULT_SUB_GROUP_KEY` dan
  validasi KB yang **menolak** sub-grup buatan founder dengan kunci itu.
- **`aliases`** = variasi teks tab yang lazim ("Voucher Toko", "Vouchers"). Pencocokan
  teks tab → sub-grup dilakukan **EKSAK di kode** (`lib/subgroups.ts`), case & spasi
  diabaikan. Pencocokan longgar (awalan/substring) SENGAJA tidak dipakai: "Voucher Gratis
  Ongkir" adalah tool lain, dan menebaknya sebagai "Voucher" menyimpan angka ke sub-grup
  yang salah tanpa gejala apa pun.
- **Alias/label bentrok antar sub-grup DITOLAK saat simpan KB** — kalau dua tool berbagi
  teks pencocokan, foto bisa masuk sub-grup yang salah dan tak ada cara mendeteksinya.
- **Campuran metrik section + metrik sub-grup DITOLAK.** Saat mengekstrak satu foto sistem
  harus tahu PASTI daftar metrik mana yang berlaku; kalau keduanya ada, jawabannya ambigu —
  dan ambiguitas di jalur angka melanggar Prinsip #1.
- **Nama lengkap** `"<Label Sub-grup> — <Nama Metrik>"` dipakai Analyst, Validator, dan PPT.
  Tanpa sub-grup: nama metrik apa adanya.
- **`/api/period-detect` jadi PEMBACA KONTEKS FOTO**, bukan lagi khusus bulan: satu
  panggilan mengembalikan `{ periodText, tabLabel }`. Konteks foto memang satu tarikan, dan
  endpoint kedua berarti dua kali biaya untuk gambar yang sama. Model hanya MENYALIN teks
  tab aktif; pencocokan ke sub-grup murni kode. Tab tak terbaca / tak yakin → `null`.
- **Pencocokan tab dijalankan SETELAH section dipilih.** Saat foto masuk antrean,
  section-nya belum ditentukan — padahal daftar sub-grup milik section. Karena itu
  `tabLabel` disimpan apa adanya di baris antrean, lalu dicocokkan pada dua momen: saat
  hasil deteksi tiba, dan saat operator memilih section (mana pun yang belakangan).
  Ganti section = daftar sub-grup berganti, jadi pilihan lamanya direset.
- **Pilihan manual menang PERMANEN** atas deteksi yang datang belakangan — pola sama
  dengan deteksi bulan. Tab yang terbaca tapi tak cocok ditampilkan apa adanya
  ("tab X tidak cocok — pilih manual"), bukan disembunyikan.
- **Ekstraksi BER-SCOPE**: satu foto hanya membawa expected metrics milik sub-grupnya.
  Mengirim daftar campuran berarti model diminta mencari metrik yang memang tidak ada di
  gambar itu — hasilnya missing palsu, atau lebih buruk, angka tool lain ditempelkan ke
  sini. Foto tanpa sub-grup di section ber-sub-grup: **ekstraksi DITAHAN** dengan pesan
  "pilih sub-grup dulu", bukan diekstrak dengan daftar campuran.
- **"Satu bulan satu foto" dan "satu periode utama" kini per (report, section, SUB-GRUP)** —
  tiap tool punya periode utamanya sendiri, karena perbandingan antar bulan juga per tool.
- **Kelengkapan dinilai atas GABUNGAN foto satu sub-grup, bukan per foto** — satu foto
  Flash Sale mungkin hanya memuat sebagian metriknya, yang lain melengkapi
  (`lib/completeness.ts`, murni & teruji). **Sub-grup ber-KB tanpa satu pun foto BUKAN
  error**: daftar tool yang aktif berbeda tiap klien dan tiap bulan, jadi yang terbit cuma
  catatan info *"Tidak ada aktivitas &lt;label&gt; bulan ini"*. Metrik hilang dari sub-grup yang
  ADA fotonya → flag `kelengkapan` dengan nama ber-prefix: `required` → severity **tinggi**,
  opsional → **info**. Metrik `required` yang masih `low_confidence` DAN belum dikonfirmasi
  manusia dihitung BELUM lengkap — angka yang belum divetting tak boleh lolos diam-diam.
- **Gabung Foto hanya menerima potongan dari SUB-GRUP YANG SAMA.** Tab tiap potongan dibaca
  lalu campuran ditolak: menggabung Flash Sale dengan Voucher menghasilkan satu foto yang
  angkanya milik dua tool, dan ekstraksi ber-scope tidak punya cara memisahkannya lagi.
  Hasil gabungan **mewarisi** label sub-grup sumbernya.
- **Preset trim di-key per section + sub-grup** (`mergePreset:<sectionId>:<subGroupKey>`):
  potongan Flash Sale dan Voucher berbeda, presetnya tak boleh saling menimpa. Section
  tanpa sub-grup tetap memakai key LAMA persis — preset yang sudah ada di browser operator
  tetap terbaca, **tanpa migrasi paksa localStorage**.
- **Foto menyimpan `subGroupKey` sebagai STRING, bukan FK** — sama seperti `Extraction.key`
  terhadap metrik. Founder menata ulang KB tidak menghapus foto yang sudah ada.

## Metrik Turunan (Fase 2, Jul 2026) — "kode menghitung, AI mengutip"

Nilai yang DIHITUNG KODE dari metrik lain (boleh lintas section), lalu diperlakukan sebagai
fakta jadi yang tinggal dikutip Analyst. Kelanjutan lurus dari aturan yang sudah berlaku:
Analyst dilarang aritmetika, dan persen antar periode pun dihitung kode.

- **Formula HANYA A ÷ B × 100.** Sengaja tidak dibangun bahasa formula umum: begitu ada
  penjumlahan, kurung, dan prioritas operator, KB berubah jadi bahasa pemrograman mini yang
  salahnya baru ketahuan di angka klien. **Penyebut resmi = GMV** (bukan omzet bersih).
- **Ref = kunci ber-scope Fase 1** (`platform + section + subGroupKey + metrik`), disimpan
  **empat kolom eksplisit per operan** — bukan string ber-pemisah, karena nama section boleh
  memuat `/` dan `—` dan pemisah apa pun jadi bug escaping yang gagal senyap.
- **Scope platform KETAT** (Prinsip #4): promo Shopee ÷ GMV Shopee, promo TikTok ÷ GMV
  TikTok. Di editor, platform bahkan tidak bisa dipilih — ia diturunkan dari section pemilik.
- **FAIL FAST saat simpan KB**: ref yang menunjuk sesuatu yang tak ada ditolak dengan pesan
  **menyebut ref-nya utuh**. Menyimpannya lalu "menunggu operan" selamanya = kegagalan senyap.
  Di editor, operan **dipilih dari KB**, bukan diketik — salah eja mustahil sejak input, dan
  validasi ini jadi lapisan kedua.
- **Pemilihan operan tidak pernah MENJUMLAH**: section ber-perbandingan-periode memakai foto
  periode utama; selain itu wajib tepat satu foto. Lebih dari satu = "sumber terpisah" yang
  tak boleh digabung → status `ambigu`.
- **Guard**: operan belum ada → `menunggu` + catatan menyebut ref yang kurang (bukan nol,
  bukan error); penyebut 0/null → `penyebut_nol`; **NaN & Infinity tak pernah bisa tersimpan**.
  Operan yang tersedia belakangan memunculkan kontribusinya **otomatis** pada hitung-ulang
  berikutnya. Dihitung ulang setelah ekstraksi DAN setelah tiap koreksi manual, ditulis-ulang
  total sehingga duplikat mustahil.
- **Hanya `status === "ok"` yang boleh dikutip.** Filternya ada DI QUERY pada ketiga konsumen
  (paket fakta Analyst, kesimpulan, PPT) — bukan disaring belakangan — sehingga nilai non-ok
  tak punya jalan menyelinap lewat perubahan kode di kemudian hari.
- **Presisi**: nilai penuh tersimpan, yang dikutip bentuk 1 desimal (`13,5%`) — Prinsip #6.
- **Baris kontribusi di PPT ditambahkan DETERMINISTIK** oleh route, bukan digantungkan pada
  apakah Analyst kebetulan menyebutnya.
- **Jumlah kontribusi TIDAK dipaksa/dinormalisasi ke 100%.** Begitu lebih dari satu tampil
  berdampingan, catatan standar ikut: *"Kontribusi antar tool dapat tumpang-tindih (satu
  pesanan bisa memakai lebih dari satu promo)."* Validator **dilarang mengoreksi angka**.
- **Kontribusi TUNGGAL > 100% → flag `turunan` severity tinggi**, memuat nilai kedua operan
  untuk ditelusuri: hampir selalu berarti operan salah ekstrak (mis. GMV dari kolom lain).

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

**Aturan pengisian metrik (penting — memengaruhi akurasi ekstraksi):** kolom **key DAN
Label sama-sama dikirim ke prompt vision** (`lib/extractor.ts`, format
`- <key> (<label>, tipe: <type>)`). Karena itu:
- **Label wajib ditulis PERSIS mengikuti teks di dashboard** — itulah yang dicocokkan model
  ke label kolom/kartu di screenshot.
- **key dibuat deskriptif dan serumpun dengan label** (`penjualan`, bukan `m1`): key yang
  menyimpang dari maknanya ikut menyesatkan model, karena ia pun terbaca di prompt — bukan
  sekadar pengenal internal.

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

> **TRANSISI ke periode level-report (Poin 2, mulai Jul 2026).** Pasangan bulan (periode
> **utama** + **pembanding** opsional) kini atribut REPORT (`Report.periodeUtama`,
> `Report.periodePembanding`, kanonik "YYYY-MM"), ditetapkan saat pembuatan report. Label
> bulan foto hanya boleh salah satu dari pasangan itu, dan status "periode utama" foto jadi
> **turunan** (`bulanFoto == periodeUtama`, `lib/report-period.ts`) — menggantikan flag
> `Upload.isPrimaryPeriod` per foto.
> - **2a (SELESAI):** kolom pasangan + helper murni (`isPrimaryMonth`, `periodMonthOptions`,
>   `matchMonthToPair`, `displayReportPeriod`) + migrasi ADITIF + backfill
>   `reportPeriod → periodeUtama` (label kustom tak terparse → null). Konsumen BELUM disentuh
>   → perilaku report lama identik.
> - **2b:** konsumen (rantai perbandingan, kontribusi turunan, kelengkapan, urutan PPT,
>   dropdown bulan foto, deteksi bulan sebagai pencocok) beralih membaca dari pasangan.
> - **2c:** edit pasangan + warning anomali + recompute; migrasi buang `isPrimaryPeriod`.
> - **`reportPeriod` DIPERTAHANKAN** sebagai label tampilan fallback (deprecated, read-only,
>   tak pernah dibaca logika). Aturan tampilan tunggal di semua tempat:
>   `formatMonthID(periodeUtama) ?? reportPeriod ?? "Periode belum ditentukan"`.
>
> Deskripsi di bawah adalah model per-foto LAMA; masih akurat untuk kode yang belum beralih
> (sampai 2b), lalu diperbarui saat konsumen pindah.

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
> - **Urutan foto di slide (Jul 2026):** di section perbandingan periode, foto PERIODE UTAMA
>   (`Upload.isPrimaryPeriod`) selalu ditaruh di ATAS, foto pembanding di bawah — konsisten
>   di semua slide. Diurut di route pptx dengan sort STABIL (utama dulu, sisanya tetap urut
>   input); section NON-perbandingan tidak diubah (urutan input/`createdAt` apa adanya).

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
| Metrik wajib (`required`) hilang | Section tetap dianalisa dengan angka yang ada; kekurangan di-flag `kelengkapan` severity tinggi saat "Buat kesimpulan" (Fase 1c). Dinilai per SUB-GRUP atas gabungan foto. Lihat §Sub-grup Section. |
| Angka sama nama lintas section (mis. GMV) | TIDAK direkonsiliasi. Konsistensi dijaga di level narasi saja. |
| Validator masih tak cocok setelah revisi ke-1 | Escalate + flag ke ringkasan akhir. Render tetap jalan. |
| User salah pilih section | Label terkunci ke section aktif; mitigasi via konfirmasi label ringan. |
| Section aktif tapi foto belum di-upload | Sistem deteksi & ingatkan user sebelum proses. |
| Visualisasi data | TIDAK pernah bikin chart dari angka. Foto asli yang tampil; angka hanya untuk analisa & caption. |
| Penyingkatan angka | Hanya saat dibahasakan (caption/narasi), tak pernah saat disimpan. Aturan k/jt/miliar 1 desimal — lihat Prinsip #6. |
| Notasi singkatan di screenshot | Extractor menormalkan `raw_text` → nilai PENUH secara deterministik, per-platform (`M`=juta di Shopee, `M`=miliar di TikTok). Lihat §Normalisasi Notasi Singkatan. |
| Metrik durasi (`hh:mm:ss`, `45 s`, `12 min`, `1h 30min`) | Jalur parsing SENDIRI di Extractor (normalizer singkatan membuang `:` → `01:23:45` jadi 12345). Disimpan detik, dibahasakan "1j 23mnt 45dtk", dibandingkan relatif (%). Lihat §Tipe Metrik Durasi. |
| Section terdiri dari beberapa tool berfoto terpisah | Sub-grup: metrik ber-scope `platform + section + subGroupKey + nama`, sehingga "Penjualan" di Flash Sale dan di Voucher adalah entitas BERBEDA. Kelengkapan dinilai per sub-grup atas gabungan foto, bukan per foto. Lihat §Sub-grup Section. |
| Periode di screenshot vs bulan report | Teks periode disalin Extractor (menumpang panggilan yang ada), dipetakan KODE ke bulan. Bulan report kosong → diisi + badge; sudah ada & berbeda → Flag `periode` severity tinggi; parser ragu (lintas bulan / relatif / tanpa tahun) → diam. Edit manual menang permanen. Lihat §Deteksi Bulan Otomatis. |
| Angka yang perlu dihitung dari metrik lain | Metrik turunan: KODE yang menghitung (A ÷ B × 100), Analyst hanya mengutip. Operan belum siap → `menunggu`, bukan nol. Jumlah kontribusi tak dipaksa 100%. Lihat §Metrik Turunan. |
| Satu tampilan terpotong jadi beberapa screenshot | Digabung jadi SATU file di CLIENT sebelum diunggah (crop interaktif membuang irisan), lalu lewat alur unggah biasa. TIDAK ada dedup otomatis berbasis konten — screenshot berulang tidak identik piksel. Lihat §Gabung Foto. |
| Metrik teks (nama produk/affiliator) | Bukan angka: nilainya di `Extraction.rawText`, `value` NULL. Disalin PERSIS, penanda potong di UJUNG dibuang KODE, tak pernah dilengkapi tebakan. Tak pernah dihitung (tanpa persen/pp) dan tak pernah ter-bold. Metrik ber-indeks sama = baris tabel sama. Lihat §Tipe Metrik Teks. |
| Nama peringkat berganti antar bulan | Analyst wajib membingkainya sebagai PERGANTIAN penghuni peringkat (sebut kedua nama), BUKAN naik/turunnya satu produk yang sama. |
| Section dengan perbandingan periode | Penanda bulan per-FOTO (bukan per-report); SATU foto per bulan (duplikat ditolak server); foto pembanding di-upload ulang tiap bulan, tanpa memori antar-report; Extractor tak menggabung; persen/pp dihitung KODE berantai antar bulan berdekatan (lewati bila data tak lengkap/pembagi 0), Analyst hanya menarasikan. Lihat §Perbandingan Periode. |
| Slide kesimpulan/summary | Ditulis VALIDATOR (bukan agent baru), per-platform di akhir bloknya masing-masing; TIDAK ada kesimpulan gabungan lintas-platform. Lihat §Validator & Kesimpulan. |

## Sistem Flag

- Dua tingkat keparahan: *info* (narasi janggal, metrik opsional hilang) → tetap render,
  tandai; *tinggi* (menyentuh presisi) → pertimbangkan tahan bagian itu. Yang terbit hari ini:
  `inkonsistensi` (info, escalate Validator), `periode` (tinggi, Deteksi Bulan Otomatis),
  `kelengkapan` (Fase 1c — tinggi bila metrik `required` hilang/ragu, info bila metrik
  opsional hilang atau sub-grup tak berfoto), dan `turunan` (Fase 2c — tinggi, kontribusi >100%).
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
- **Model LLM per peran.** Yang menyentuh ANGKA memakai `claude-opus-4-8` dan di-hardcode
  (Extractor, Analyst, Validator) — presisi tidak boleh diturunkan lewat env tanpa sengaja.
  Yang hanya membantu tata letak/label memakai tier hemat dengan default aman dan bisa
  ditimpa env: `MERGE_SUGGEST_MODEL` (Auto-potong Gabung Foto) dan `PERIOD_DETECT_MODEL`
  (Deteksi Bulan Otomatis), keduanya default `claude-haiku-4-5-20251001`. Keduanya juga
  yang paling sering dipanggil, jadi di sinilah biaya benar-benar terasa.
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
  platform: DIKETIK USER MANUAL (tabel `Recommendation.points` = `String[]`, unik per
  (report, platform), input poin demi poin di halaman report) — POIN DEMI POIN, dirender jadi
  bullet list (format seragam dengan slide Kesimpulan) TAPI TANPA AI/bold otomatis (murni
  manual, `numbers` kosong); tanpa poin = slide dilewati, bukan slide kosong. Revisi Jul 2026:
  dulu satu blok teks bebas `content`, kini `points[]` — input tiap poin punya baris sendiri
  (tambah/hapus), output tiap poin satu bullet.) Slide Thank You: teks + logo tema + kontak dari
  `Theme` (`contactEmail`/`contactWebsite`/`contactInstagram`, editable founder di
  `/dashboard/theme`; kosong = bagian itu tak tampil). Nama platform pindah dari cover ke
  pembatas; cover menampilkan periode + daftar platform. **Skala cover & penutup (Jul 2026):**
  daftar platform di cover BESAR & TEBAL (font judul 26pt; sebelumnya font body 12pt biasa)
  dengan warna `primary` bila gelap — cover selalu berlatar putih, jadi primer TERANG jatuh
  ke `secondary` agar tidak terang-di-putih; brand + periode di band jadi 26pt TEBAL dengan
  kontras penuh (`onPrimaryText`, dulu 18pt biasa `onPrimarySubtle`); logo diperbesar di
  cover (kotak 2,8"x1,2" -> 4,2"x1,95") dan di Thank You (2,2"x1,1" -> 3,5"x1,75").
  Semua kotak dihitung agar tak bertindihan: logo cover tutup di 2,5" (band mulai 2,8"),
  brand+periode 4,05"–4,75" (band tutup 4,8"), logo penutup tutup di 2,8" ("Thank You"
  mulai 3,0").
  **Logo di slide Thank You saat tema gelap (Jul 2026):** logo tema dirancang untuk cover
  yang SELALU putih, jadi tintanya gelap dan lenyap di slide penutup berlatar primer gelap.
  Route pptx menyiapkan varian PUTIH (siluet: kanvas putih dimasking alpha logo, via `sharp`)
  dan `lib/ppt.ts` memakainya HANYA di slide itu saat `isDarkColor(primary)`. Hanya untuk
  logo ber-alpha (logo tanpa transparansi punya latar sendiri — dimasking malah jadi kotak
  putih); gagal apa pun = pakai logo asli (Prinsip #3). Cover tetap memakai logo asli.
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
- [x] Rekomendasi poin demi poin (Jul 2026) — `Recommendation.content` (teks bebas) →
  `Recommendation.points` (`String[]`, migrasi `recommendation_points` mengubah `content`
  jadi poin per baris). Input di halaman report: tiap poin punya baris sendiri (tambah/hapus),
  bukan lagi textarea. Output PPT: bullet list via `addPointsText` (format seragam dgn
  Kesimpulan) TAPI `numbers` kosong = TANPA bold otomatis (tetap murni manual). Paginasi
  "(lanjutan)" & guard `pageTotal` tetap. Slide dilewati bila tanpa poin. Lihat baris
  "Struktur PPT gaya agency" di §Stack.
- [ ] Tahap 11 — Deploy ke Railway

**Backlog (disengaja ditunda, keputusan audit Jul 2026):**
- Penanda bulan per-foto + flag perbandingan-periode di Section → Tahap 6b (lihat §Perbandingan Periode).
- Versioning `ValidatorKb` (à la `KbVersion` section) + provenance KB di `Conclusion` —
  relevan saat sistem flag (Tahap 9); untuk sekarang KB Validator tanpa versi.
- Cek konsistensi-GAYA oleh Validator (konsistensi TERHADAP GAYA agency, acuan KB
  general/merangkai) — menyusul setelah founder mengisi KB; dua cek bawaan (kontradiksi +
  tone) sudah jalan di Tahap 7b.
- Konfirmasi label ringan eksplisit (saat ini: dropdown + simpan eksplisit; `labelConfirmed` selalu true).
- **Reorder prompt Extractor agar Label jadi pencocok UTAMA** (bukan `key`): saat ini
  `lib/extractor.ts` merender `- <key> (<label>, tipe)`, sehingga `key` yang mendahului.
  Karena Label-lah yang benar-benar cocok dengan teks dashboard, urutannya sebaiknya dibalik
  agar Label memimpin. DIKERJAKAN BERSAMA QA regresi ekstraksi (perubahan prompt menyentuh
  semua tipe metrik) — bukan sekarang.
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
- **Batch E3 audit (Jul 2026)** — integritas & performa:
  (a) indeks FK `Extraction.uploadId` dan `Flag.reportId` (migrasi `add_fk_indexes`) —
  Postgres tidak membuatnya otomatis; Extraction tabel terbesar dan kolom itu dikenai
  `deleteMany` tiap ekstrak-ulang, `Flag.reportId` tiap generate kesimpulan.
  (b) **Lost update ditutup**: route kesimpulan membaca insight → menjalankan rantai LLM
  (puluhan detik–menit) → menulis balik. Kalau operator lain menekan "Generate ulang
  insight" di sela itu, penulisan tanpa syarat MENIMPA hasil barunya dengan revisi atas
  versi lama, dan jejak revisi justru menyembunyikan bahwa versi baru pernah ada. Kini
  `updateMany` bersyarat `updatedAt` snapshot: gagal tenang (count 0), revisi dilewati,
  dan pelewatannya DITANDAI sebagai flag + `consistency.skipped` — bukan disembunyikan.
  (c) `S3Client` dipakai ulang (dulu `new S3Client` tiap panggilan → report 30 foto = 30
  klien baru, nol penggunaan ulang koneksi).
- **Batch E4 audit (Jul 2026)** — batas waktu LLM. `new Anthropic()` tanpa opsi memakai
  default SDK: timeout **10 menit**, `maxRetries` 2, dan timeout ikut di-retry — satu
  request HTTP bisa hidup ~30 menit sementara browser operator sudah lama menyerah dan
  server terus membakar token. Kini semua pemanggil lewat `anthropicClient()` di
  `lib/llm.ts` dengan timeout 180 dtk + 1 retry (terburuk 6 menit), klien dipakai ulang,
  dan `max_tokens` jadi satu konstanta `LLM_MAX_TOKENS`.
  > Jangan naikkan `LLM_MAX_TOKENS` di atas ~21.300: SDK menolak permintaan NON-streaming
  > yang perkiraan durasinya melewati 10 menit ("Streaming is required") — semua jalur LLM
  > akan gagal keras seketika. Kalau perlu keluaran lebih panjang, pindah ke streaming.
- **Batch E5 audit (Jul 2026)** — pengerasan kecil:
  caption diputuskan PER SECTION (satu foto berlabel bulan → foto lain jadi "Tanpa periode",
  bukan bercampur dengan "Sumber #n"); notice "foto tidak terbaca" dipindah ke DALAM kartu
  putih dengan warna teks kartu (dulu abu terang di atas putih, nyaris tak terbaca, dan
  menembus garis footer); `buildReportPptx` menyanitasi warna & font tema sendiri
  (`normalizeHexColor`/`isSafeFont`) — warna tak valid dulu menghasilkan `tint()` "NaN"
  dan `isDarkColor` false sehingga teks GELAP dipilih di atas latar HITAM; `URL.revokeObjectURL`
  unduh PPT ditunda 1 dtk (mencabut di tick yang sama dengan `click()` membatalkan unduhan
  di Safari/Firefox); object URL pratinjau dicabut saat unmount; `extractAll` berhenti pada
  403 dan melaporkan ringkasan berhasil/gagal; tombol Enter di login menghormati state
  loading; `login-throttle` menyapu entri kedaluwarsa (Map dulu tumbuh tanpa batas karena
  key `email|ip` dikendalikan pengirim); login menjalankan bcrypt atas hash boneka saat
  email tak terdaftar — selisih waktu respons turun dari ~50-100 ms ke ~3 ms (terukur).
  > Catatan: `pageTotal` untuk rekomendasi berisi spasi saja sudah benar dengan sendirinya
  > sejak E1 (halaman rekomendasi dihitung dari hasil `trim()`), jadi tidak perlu perbaikan
  > terpisah — diverifikasi ulang.
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
