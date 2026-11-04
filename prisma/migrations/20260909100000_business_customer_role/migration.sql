INSERT INTO "Role" ("id", "code", "description", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'customer_business', 'Business customer', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "UserRole" ("userId", "roleId", "createdAt")
SELECT u."id", r."id", CURRENT_TIMESTAMP
FROM "User" u CROSS JOIN "Role" r
WHERE u."accountType" = 'BUSINESS' AND r."code" = 'customer_business'
ON CONFLICT ("userId", "roleId") DO NOTHING;

DELETE FROM "UserRole" ur
USING "User" u, "Role" r
WHERE ur."userId" = u."id" AND ur."roleId" = r."id"
  AND u."accountType" = 'BUSINESS' AND r."code" = 'customer_personal';
