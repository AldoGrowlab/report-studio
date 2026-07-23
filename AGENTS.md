<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design source of truth: docs/DESIGN.md

`docs/DESIGN.md` is the authoritative design document for this project. Before building any new feature or making a design decision, **read `docs/DESIGN.md` first** and make your work conform to it — its guiding principles, pipeline architecture, edge-case rulings, and technical decisions.

- If a request, plan, or implementation **conflicts** with `docs/DESIGN.md`, do NOT silently proceed. Flag the conflict explicitly, quote the relevant part of the doc, and raise it for discussion before continuing. The document wins unless the user decides to change it.
- When the design genuinely needs to evolve, update `docs/DESIGN.md` (and the build-status checklist in it) as part of the same change, so the doc stays the source of truth.

# Produksi: koneksi & kredensial (konvensi wajib)

Latar: 24 Jul 2026 sebuah `.env.prod.local` basi (Postgres lama yang sudah diganti — skema ~20 Jul, 0 report, tanpa `_prisma_migrations`) dikira produksi. Untung ketahuan lewat preflight read-only sebelum ada tulisan. Aturan berikut mencegah terulang:

1. **Kredensial DB produksi TIDAK disimpan di file lokal** (repo maupun mesin dev) — bukan di `.env*`, bukan di file backup. Prod dijangkau HANYA lewat environment Railway. `.env` lokal khusus dev.
2. **Preflight/verifikasi produksi wajib READ-ONLY.** Operasi TULIS ke produksi (migrasi manual, backfill, seed, perbaikan data) hanya lewat `railway run …` atau Railway shell — supaya menyentuh `DATABASE_URL` prod asli, bukan connection string lokal yang bisa basi. Agen tidak menjalankan tulis-prod dengan menempelkan connection string prod di mesin dev.
3. **Setiap klaim "terhadap produksi" wajib menyebutkan jalur koneksinya** (mis. "via `railway run`", atau "via `.env.X` → host `…`") DAN satu bukti identitas DB yang benar sebelum dipercaya — mis. `_prisma_migrations` memuat migrasi terbaru, tabel fitur terakhir ada, jumlah baris masuk akal. Host yang tampak "prod" saja tidak cukup.
