-- AlterTable
ALTER TABLE "Theme" ADD COLUMN     "contactEmail" TEXT NOT NULL DEFAULT 'officialgrowlab.id@gmail.com',
ADD COLUMN     "contactInstagram" TEXT NOT NULL DEFAULT '@growlab.id',
ADD COLUMN     "contactWebsite" TEXT NOT NULL DEFAULT 'www.growlab.id';

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "content" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_reportId_platform_key" ON "Recommendation"("reportId", "platform");

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

