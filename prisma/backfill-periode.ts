import { PrismaClient } from "@prisma/client";
import { parsePeriodText, toPeriodMonth } from "../lib/period-parser";

// Backfill periodeUtama dari reportPeriod (Poin 2a). Idempoten & aman dijalankan berkali-kali:
// hanya menyentuh report yang periodeUtama-nya masih NULL, dan reportPeriod TIDAK diubah.
//
// Label kustom yang tak terparse ke bulan kanonik (mis. "Q2 2026") dibiarkan periodeUtama
// NULL — report itu "tanpa periode" secara logika (keputusan user), tapi reportPeriod-nya
// tetap tampil sebagai label fallback (lib/report-period.ts displayReportPeriod).
//
// Jalankan sekali setelah migrasi:  npx tsx prisma/backfill-periode.ts
const prisma = new PrismaClient();

async function main() {
  const reports = await prisma.report.findMany({
    where: { periodeUtama: null },
    select: { id: true, reportPeriod: true },
  });

  let filled = 0;
  let leftNull = 0;
  for (const r of reports) {
    const parsed = parsePeriodText(r.reportPeriod);
    if (!parsed) {
      leftNull++;
      continue;
    }
    await prisma.report.update({
      where: { id: r.id },
      data: { periodeUtama: toPeriodMonth(parsed) },
    });
    filled++;
  }

  console.log(
    `Backfill selesai: ${filled} report terisi periodeUtama, ` +
      `${leftNull} dibiarkan null (label kustom tak terparse), dari ${reports.length} kandidat.`
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
