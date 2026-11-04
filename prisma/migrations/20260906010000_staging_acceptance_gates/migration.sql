WITH inserted AS (
  INSERT INTO "LaunchReadinessItem" (
    "id",
    "key",
    "category",
    "title",
    "requirement",
    "isRequired",
    "isBaseline",
    "updatedAt"
  ) VALUES
    (
      gen_random_uuid()::text,
      'staging-environment',
      'INFRASTRUCTURE',
      'Production-like staging environment',
      'HTTPS staging with an isolated database and secrets, production-like private storage, approved launch data, current migrations, observable logs and a passing complete release-candidate verification.',
      true,
      true,
      CURRENT_TIMESTAMP
    ),
    (
      gen_random_uuid()::text,
      'role-journey-acceptance',
      'OPERATIONS',
      'Role-by-role journey acceptance',
      'Separate least-privilege testers complete and evidence the launch journeys for anonymous visitor, customer, seller, Admin, Sourcing, Compliance, Warehouse, Inspector, Logistics, Customer Service and Finance.',
      true,
      true,
      CURRENT_TIMESTAMP
    ),
    (
      gen_random_uuid()::text,
      'device-accessibility-acceptance',
      'OTHER',
      'Device, PWA and accessibility acceptance',
      'Critical journeys pass on supported desktop browsers and real mobile devices, including PWA installation, keyboard use, accessible labels, responsive layouts, scanner or camera workflows and poor-network recovery.',
      true,
      true,
      CURRENT_TIMESTAMP
    ),
    (
      gen_random_uuid()::text,
      'release-freeze-approval',
      'SECURITY',
      'Release freeze and approval',
      'No open P0 or P1 defect; the exact release image, migration version, environment inventory, security evidence, accepted risks, rollback decision and named launch approver are recorded.',
      true,
      true,
      CURRENT_TIMESTAMP
    )
  ON CONFLICT ("key") DO NOTHING
  RETURNING "id", "status", "version", "ownerName", "dueAt", "evidenceReference", "evidenceNote", "blockerReason", "createdAt"
)
INSERT INTO "LaunchReadinessEvent" (
  "id",
  "itemId",
  "fromStatus",
  "toStatus",
  "itemVersion",
  "ownerNameSnapshot",
  "dueAtSnapshot",
  "evidenceReferenceSnapshot",
  "evidenceNoteSnapshot",
  "blockerReasonSnapshot",
  "occurredAt"
)
SELECT
  gen_random_uuid()::text,
  "id",
  NULL,
  "status",
  "version",
  "ownerName",
  "dueAt",
  "evidenceReference",
  "evidenceNote",
  "blockerReason",
  "createdAt"
FROM inserted;
