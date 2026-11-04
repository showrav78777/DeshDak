-- Google identity is optional. PostgreSQL unique indexes allow multiple NULLs,
-- while preventing one Google subject from being attached to more than one user.
ALTER TABLE "User"
  ADD COLUMN "googleSubject" TEXT,
  ADD COLUMN "googleLinkedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");
