-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "usesPeriodComparison" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN     "isPrimaryPeriod" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "periodMonth" TEXT;
