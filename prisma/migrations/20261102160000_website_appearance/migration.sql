CREATE TABLE "WebsiteAppearance" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebsiteAppearance_pkey" PRIMARY KEY ("id")
);
