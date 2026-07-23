import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Seed founder. Password TIDAK lagi di-hardcode (Jul 2026): nilainya dulu terbaca siapa
// pun yang membuka repo — dan repo ini PUBLIK. Kini wajib datang dari env.
//
// Catatan penting: `update: {}` disengaja — menjalankan seed ulang TIDAK menimpa password
// akun yang sudah ada. Jadi mengubah SEED_ADMIN_PASSWORD saja tidak merotasi password
// founder yang sudah telanjur dibuat; itu langkah terpisah.
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "youngtrepreneuridteam@gmail.com";
  const plainPassword = process.env.SEED_ADMIN_PASSWORD;

  // GAGAL KERAS, bukan diam-diam memakai default (pola sama dengan guard env di
  // lib/llm.ts & lib/storage.ts): akun founder berpassword yang bisa ditebak jauh lebih
  // berbahaya daripada seed yang menolak jalan.
  if (!plainPassword || plainPassword.trim() === "") {
    console.error(
      "SEED_ADMIN_PASSWORD tidak diset. Seed menolak membuat akun founder dengan password " +
        "bawaan. Set env itu dulu, mis:\n" +
        '  SEED_ADMIN_PASSWORD="$(openssl rand -base64 24)" npx prisma db seed'
    );
    process.exit(1);
  }
  if (plainPassword.length < 12) {
    console.error("SEED_ADMIN_PASSWORD terlalu pendek — minimal 12 karakter.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const founder = await prisma.user.upsert({
    where: { email },
    update: {}, // akun yang sudah ada TIDAK disentuh — lihat catatan di atas
    create: {
      email,
      passwordHash,
      role: Role.founder,
    },
  });

  console.log(`Founder siap: ${founder.email} (role: ${founder.role})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
