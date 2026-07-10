-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '1F2937',
    "secondaryColor" TEXT NOT NULL DEFAULT '6B7280',
    "accentColor" TEXT NOT NULL DEFAULT '2563EB',
    "headingFont" TEXT NOT NULL DEFAULT 'Calibri',
    "bodyFont" TEXT NOT NULL DEFAULT 'Calibri',
    "logoKey" TEXT,
    "accentOverride" BOOLEAN NOT NULL DEFAULT false,
    "accentShopee" TEXT NOT NULL DEFAULT 'EE4D2D',
    "accentTiktok" TEXT NOT NULL DEFAULT '111827',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);
