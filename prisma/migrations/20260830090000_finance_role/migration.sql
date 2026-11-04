INSERT INTO "Role" ("id", "code", "description", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'finance', 'Finance operations officer', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description", "updatedAt" = CURRENT_TIMESTAMP;
