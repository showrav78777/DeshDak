-- Preserve original evidence. Existing case-only conflicts must be reviewed
-- before deployment; do not rename or delete packages automatically.
CREATE UNIQUE INDEX "Package_inboundTracking_casefold_key"
ON "Package" (lower("inboundTracking"))
WHERE "inboundTracking" IS NOT NULL;
