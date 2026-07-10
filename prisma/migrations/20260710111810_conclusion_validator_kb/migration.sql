-- CreateTable
CREATE TABLE "Conclusion" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "points" TEXT[],
    "numbers" TEXT[],
    "generator" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidatorKb" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "kbGeneral" TEXT NOT NULL DEFAULT '',
    "kbConclusion" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidatorKb_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conclusion_reportId_platform_key" ON "Conclusion"("reportId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "ValidatorKb_platform_key" ON "ValidatorKb"("platform");

-- AddForeignKey
ALTER TABLE "Conclusion" ADD CONSTRAINT "Conclusion_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
