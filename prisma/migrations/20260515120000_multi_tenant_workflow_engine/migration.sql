-- Sprint 0: multi_tenant_workflow_engine
-- Locks workflow-definition tables, CaseHistory (from workflow_states),
-- referral-aware tenant columns, AuditLog.relatedTenantId, case numbering.

DO $$ BEGIN
  CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── Workflows: key, lifecycle, optional definition ─────────────────────────
ALTER TABLE "workflows"
  ADD COLUMN IF NOT EXISTS "key" TEXT,
  ADD COLUMN IF NOT EXISTS "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3);

ALTER TABLE "workflows" ALTER COLUMN "definition" DROP NOT NULL;

UPDATE "workflows"
SET "key" = 'wf-' || REPLACE(CAST(id AS TEXT), '-', ''),
    "status" = 'PUBLISHED',
    "published_at" = COALESCE("published_at", "created_at")
WHERE "key" IS NULL AND "definition" IS NOT NULL;

UPDATE "workflows"
SET "key" = 'wf-' || REPLACE(CAST(id AS TEXT), '-', '')
WHERE "key" IS NULL;

ALTER TABLE "workflows" ALTER COLUMN "key" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "workflows_tenant_id_key_version_key"
  ON "workflows"("tenant_id", "key", "version");

CREATE INDEX IF NOT EXISTS "workflows_tenant_id_key_status_idx"
  ON "workflows"("tenant_id", "key", "status");

-- ─── Workflow steps / transitions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "workflow_steps" (
  "id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_initial" BOOLEAN NOT NULL DEFAULT false,
  "is_final" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL DEFAULT 0,
  "allowed_role_ids" UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_steps_workflow_id_key_key"
  ON "workflow_steps"("workflow_id", "key");

CREATE INDEX IF NOT EXISTS "workflow_steps_workflow_id_idx"
  ON "workflow_steps"("workflow_id");

DO $$ BEGIN
  ALTER TABLE "workflow_steps"
    ADD CONSTRAINT "workflow_steps_workflow_id_fkey"
    FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "workflow_transitions" (
  "id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "from_step_id" UUID NOT NULL,
  "to_step_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "allowed_role_ids" UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  "requires_comment" BOOLEAN NOT NULL DEFAULT false,
  "requires_attachment" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- If previous migrations already created the table, ensure columns exist.
ALTER TABLE "workflow_transitions" ADD COLUMN IF NOT EXISTS "allowed_role_ids" UUID[] NOT NULL DEFAULT ARRAY[]::uuid[];
ALTER TABLE "workflow_transitions" ADD COLUMN IF NOT EXISTS "requires_comment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "workflow_transitions" ADD COLUMN IF NOT EXISTS "requires_attachment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "workflow_transitions" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "workflow_transitions" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_transitions_workflow_id_from_step_id_name_key"
  ON "workflow_transitions"("workflow_id", "from_step_id", "name");

CREATE INDEX IF NOT EXISTS "workflow_transitions_workflow_id_idx"
  ON "workflow_transitions"("workflow_id");

DO $$ BEGIN
  ALTER TABLE "workflow_transitions"
    ADD CONSTRAINT "workflow_transitions_workflow_id_fkey"
    FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "workflow_transitions"
    ADD CONSTRAINT "workflow_transitions_from_step_id_fkey"
    FOREIGN KEY ("from_step_id") REFERENCES "workflow_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "workflow_transitions"
    ADD CONSTRAINT "workflow_transitions_to_step_id_fkey"
    FOREIGN KEY ("to_step_id") REFERENCES "workflow_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Populate steps from legacy JSON definition (states + initialState)
INSERT INTO "workflow_steps" (
  "id", "workflow_id", "key", "name", "description",
  "is_initial", "is_final", "position", "allowed_role_ids", "created_at", "updated_at"
)
SELECT gen_random_uuid(),
       w."id",
       LOWER(REGEXP_REPLACE(TRIM(st."value"), '[^a-zA-Z0-9]+', '-', 'g')),
       TRIM(st."value"),
       NULL,
       (TRIM(st."value") = TRIM(COALESCE(w."definition"->>'initialState', ''))),
       (st."ord" = jsonb_array_length(w."definition"->'states')),
       st."ord" - 1,
       ARRAY[]::uuid[],
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "workflows" w
CROSS JOIN LATERAL jsonb_array_elements_text(w."definition"->'states')
  WITH ORDINALITY AS st("value", "ord")
WHERE w."definition" IS NOT NULL
  AND w."definition" ? 'states'
  AND jsonb_typeof(w."definition"->'states') = 'array'
  AND jsonb_array_length(w."definition"->'states') > 0;

-- Fallback: one open + one closed step for workflows still without rows
INSERT INTO "workflow_steps" (
  "id", "workflow_id", "key", "name", "description",
  "is_initial", "is_final", "position", "allowed_role_ids", "created_at", "updated_at"
)
SELECT gen_random_uuid(), w."id", 'open', 'Open', NULL, true, false, 0,
       ARRAY[]::uuid[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "workflows" w
WHERE NOT EXISTS (SELECT 1 FROM "workflow_steps" s WHERE s."workflow_id" = w."id");

INSERT INTO "workflow_steps" (
  "id", "workflow_id", "key", "name", "description",
  "is_initial", "is_final", "position", "allowed_role_ids", "created_at", "updated_at"
)
SELECT gen_random_uuid(), w."id", 'closed', 'Closed', NULL, false, true, 999,
       ARRAY[]::uuid[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "workflows" w
WHERE NOT EXISTS (
  SELECT 1 FROM "workflow_steps" s
  WHERE s."workflow_id" = w."id" AND s."is_final" = true
);

-- Transitions from JSON
INSERT INTO "workflow_transitions" (
  "id", "workflow_id", "from_step_id", "to_step_id", "name", "description",
  "allowed_role_ids", "requires_comment", "requires_attachment", "created_at", "updated_at"
)
SELECT gen_random_uuid(),
       d."workflow_id",
       d."from_step_id",
       d."to_step_id",
       d."name",
       NULL,
       ARRAY[]::uuid[],
       false,
       false,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (w."id", fs."id", COALESCE(TRIM(tr."t"->>'name'), 'transition'))
    w."id" AS "workflow_id",
    fs."id" AS "from_step_id",
    ts."id" AS "to_step_id",
    COALESCE(NULLIF(TRIM(tr."t"->>'name'), ''), 'transition') AS "name"
  FROM "workflows" w
  CROSS JOIN LATERAL jsonb_array_elements(w."definition"->'transitions') AS tr("t")
  JOIN "workflow_steps" fs
    ON fs."workflow_id" = w."id"
   AND fs."key" = LOWER(REGEXP_REPLACE(TRIM(tr."t"->>'from'), '[^a-zA-Z0-9]+', '-', 'g'))
  JOIN "workflow_steps" ts
    ON ts."workflow_id" = w."id"
   AND ts."key" = LOWER(REGEXP_REPLACE(TRIM(tr."t"->>'to'), '[^a-zA-Z0-9]+', '-', 'g'))
  WHERE w."definition" IS NOT NULL
    AND w."definition" ? 'transitions'
    AND jsonb_typeof(w."definition"->'transitions') = 'array'
  ORDER BY w."id", fs."id", COALESCE(TRIM(tr."t"->>'name'), 'transition'), ts."id"
) AS d;

-- ─── Case history (replace workflow_states) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "case_history" (
  "id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "transition_id" UUID,
  "from_step_id" UUID,
  "to_step_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "comment" TEXT,
  "transitioned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "case_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "case_history_case_id_transitioned_at_idx"
  ON "case_history"("case_id", "transitioned_at");

DO $$ BEGIN
  ALTER TABLE "case_history"
    ADD CONSTRAINT "case_history_case_id_fkey"
    FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "case_history"
    ADD CONSTRAINT "case_history_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "case_history"
    ADD CONSTRAINT "case_history_transition_id_fkey"
    FOREIGN KEY ("transition_id") REFERENCES "workflow_transitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "case_history"
    ADD CONSTRAINT "case_history_to_step_id_fkey"
    FOREIGN KEY ("to_step_id") REFERENCES "workflow_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF to_regclass('public.workflow_states') IS NOT NULL THEN
    INSERT INTO "case_history" (
      "id", "case_id", "tenant_id", "transition_id", "from_step_id", "to_step_id",
      "actor_id", "comment", "transitioned_at"
    )
    SELECT gen_random_uuid(),
           ws."case_id",
           c."tenant_id",
           NULL,
           prev."id",
           COALESCE(
             cur."id",
             (SELECT s."id" FROM "workflow_steps" s
              WHERE s."workflow_id" = ws."workflow_id" AND s."is_initial" = true
              ORDER BY s."position" ASC LIMIT 1)
           ),
           COALESCE(ws."transitioned_by", c."created_by"),
           ws."transition_notes",
           ws."transitioned_at"
    FROM "workflow_states" ws
    JOIN "cases" c ON c."id" = ws."case_id"
    LEFT JOIN "workflow_steps" prev
      ON prev."workflow_id" = ws."workflow_id"
     AND (prev."name" = ws."previous_state" OR prev."key" = LOWER(REGEXP_REPLACE(TRIM(ws."previous_state"), '[^a-zA-Z0-9]+', '-', 'g')))
    LEFT JOIN "workflow_steps" cur
      ON cur."workflow_id" = ws."workflow_id"
     AND (cur."name" = ws."current_state" OR cur."key" = LOWER(REGEXP_REPLACE(TRIM(ws."current_state"), '[^a-zA-Z0-9]+', '-', 'g')));

    DROP TABLE "workflow_states";
  END IF;
END $$;

-- ─── Cases: workflow binding, step pointer, sequences ───────────────────────
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "workflow_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "current_step_id" UUID;
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3);
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "data" JSONB;

UPDATE "cases" c
SET "workflow_version" = w."version"
FROM "workflows" w
WHERE w."id" = c."workflow_id";

UPDATE "cases"
SET "workflow_id" = (
  SELECT w."id" FROM "workflows" w
  WHERE w."tenant_id" = "cases"."tenant_id"
  ORDER BY w."created_at" ASC
  LIMIT 1
)
WHERE "workflow_id" IS NULL;

UPDATE "cases"
SET "originating_tenant_id" = COALESCE("originating_tenant_id", "tenant_id"),
    "current_tenant_id"     = COALESCE("current_tenant_id", "tenant_id");

UPDATE "cases" c
SET "current_step_id" = (
  SELECT s."id" FROM "workflow_steps" s
  WHERE s."workflow_id" = c."workflow_id" AND s."is_initial" = true
  ORDER BY s."position" ASC
  LIMIT 1
)
WHERE c."current_step_id" IS NULL;

ALTER TABLE "cases" ALTER COLUMN "workflow_id" SET NOT NULL;

ALTER TABLE "cases" DROP CONSTRAINT IF EXISTS "cases_case_number_key";

CREATE UNIQUE INDEX IF NOT EXISTS "cases_tenant_id_case_number_key"
  ON "cases"("tenant_id", "case_number");

CREATE INDEX IF NOT EXISTS "cases_tenant_id_current_step_id_idx"
  ON "cases"("tenant_id", "current_step_id");

CREATE INDEX IF NOT EXISTS "cases_tenant_id_workflow_id_closed_at_idx"
  ON "cases"("tenant_id", "workflow_id", "closed_at");

CREATE INDEX IF NOT EXISTS "cases_originating_tenant_id_referral_status_idx"
  ON "cases"("originating_tenant_id", "referral_status");

DO $$ BEGIN
  ALTER TABLE "cases"
    ADD CONSTRAINT "cases_current_step_id_fkey"
    FOREIGN KEY ("current_step_id") REFERENCES "workflow_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "case_sequences" (
  "tenant_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "last_seq" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "case_sequences_pkey" PRIMARY KEY ("tenant_id","year")
);

DO $$ BEGIN
  ALTER TABLE "case_sequences"
    ADD CONSTRAINT "case_sequences_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── Audit: related tenant (cross-agency trail) ────────────────────────────
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "related_tenant_id" UUID;

DO $$ BEGIN
  ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_related_tenant_id_fkey"
    FOREIGN KEY ("related_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "audit_logs_related_tenant_id_idx" ON "audit_logs"("related_tenant_id");
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_entity_type_entity_id_created_at_idx"
  ON "audit_logs"("tenant_id", "entity_type", "entity_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_related_tenant_id_entity_type_entity_id_created_at_idx"
  ON "audit_logs"("related_tenant_id", "entity_type", "entity_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_user_id_created_at_idx"
  ON "audit_logs"("tenant_id", "user_id", "created_at");

-- ─── Referrals: partial unique active referral per case ────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "case_referrals_one_active_per_case"
  ON "case_referrals" ("case_id")
  WHERE "status" IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS "case_referrals_case_id_status_idx"
  ON "case_referrals"("case_id", "status");
CREATE INDEX IF NOT EXISTS "case_referrals_to_tenant_status_referred_idx"
  ON "case_referrals"("to_tenant_id", "status", "referred_at" DESC);
CREATE INDEX IF NOT EXISTS "case_referrals_from_tenant_status_referred_idx"
  ON "case_referrals"("from_tenant_id", "status", "referred_at" DESC);
