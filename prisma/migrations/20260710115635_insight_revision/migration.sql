-- CreateTable
CREATE TABLE "InsightRevision" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "pointsBefore" TEXT[],
    "pointsAfter" TEXT[],
    "reason" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightRevision_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "InsightRevision" ADD CONSTRAINT "InsightRevision_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "Insight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
