INSERT INTO "UserRole" ("userId", "roleId", "createdAt")
SELECT u."id", r."id", CURRENT_TIMESTAMP
FROM "User" u CROSS JOIN "Role" r
WHERE u."accountType" = 'BUSINESS' AND r."code" = 'customer_personal'
ON CONFLICT ("userId", "roleId") DO NOTHING;
