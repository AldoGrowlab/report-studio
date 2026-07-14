import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Audit M4 — konfigurasi Prisma pindah dari `package.json#prisma` (deprecated, dibuang di
// Prisma 7) ke file config ini. CATATAN PENTING: dengan file config, Prisma TIDAK lagi
// auto-load `.env`, jadi kita muat manual di sini supaya CLI (migrate/db execute/seed)
// tetap dapat DATABASE_URL & AUTH_SECRET/dll.
loadEnv();

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
