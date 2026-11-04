-- A customer may have at most one active default delivery address.
-- Soft-deleted addresses are deliberately excluded.
CREATE UNIQUE INDEX "Address_one_active_default_per_user_key"
ON "Address"("userId")
WHERE "isDefault" = true AND "deletedAt" IS NULL;
