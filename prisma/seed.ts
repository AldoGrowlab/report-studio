import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "youngtrepreneuridteam@gmail.com";
  const plainPassword = "youngtrepreneuridteam";

  const passwordHash = await bcrypt.hash(plainPassword, 10);

  const founder = await prisma.user.upsert({
    where: { email },
    update: {},
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