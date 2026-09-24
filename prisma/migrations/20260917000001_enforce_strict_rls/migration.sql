-- Migration to enforce strict fail-closed RLS using a dedicated database role

-- 1. Create a dedicated non-superuser role for the Partner API
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_roles WHERE rolname = 'partner_api'
  ) THEN
    CREATE ROLE partner_api WITH LOGIN PASSWORD 'partner_api_password' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Grant necessary privileges
GRANT USAGE ON SCHEMA public TO partner_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO partner_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO partner_api;

-- Future tables should also have these privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO partner_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO partner_api;

-- 2. Drop the old insecure fail-open policies
DROP POLICY IF EXISTS tenant_isolation_policy ON "departments";
DROP POLICY IF EXISTS tenant_isolation_policy ON "users";
DROP POLICY IF EXISTS tenant_isolation_policy ON "roles";
DROP POLICY IF EXISTS tenant_isolation_policy ON "workflows";
DROP POLICY IF EXISTS tenant_isolation_policy ON "cases";
DROP POLICY IF EXISTS tenant_isolation_policy ON "case_history";
DROP POLICY IF EXISTS tenant_isolation_policy ON "case_sequences";
DROP POLICY IF EXISTS tenant_isolation_policy ON "case_attachments";
DROP POLICY IF EXISTS tenant_isolation_policy ON "audit_logs";
DROP POLICY IF EXISTS tenant_isolation_policy ON "webhooks";
DROP POLICY IF EXISTS tenant_isolation_policy ON "integrations";
DROP POLICY IF EXISTS tenant_isolation_policy ON "agency_chat_messages";
-- DROP POLICY IF EXISTS tenant_isolation_policy ON "api_keys";
DROP POLICY IF EXISTS tenant_isolation_policy ON "audit_outbox";
DROP POLICY IF EXISTS tenant_isolation_policy ON "case_referrals";
DROP POLICY IF EXISTS tenant_isolation_policy ON "assignments";

-- 3. Create strict fail-closed policies applied ONLY to partner_api
-- (For the postgres superuser used by internal services, these policies are ignored naturally)

CREATE POLICY tenant_isolation_policy ON "departments" FOR ALL TO partner_api USING (
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

CREATE POLICY tenant_isolation_policy ON "users" FOR ALL TO partner_api USING (
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- roles (has optional tenant_id, if null it's a system role)
CREATE POLICY tenant_isolation_policy ON "roles" FOR ALL TO partner_api USING (
  tenant_id IS NULL OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

CREATE POLICY tenant_isolation_policy ON "workflows" FOR ALL TO partner_api USING (
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

CREATE POLICY tenant_isolation_policy ON "cases" FOR ALL TO partner_api USING (
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

CREATE POLICY tenant_isolation_policy ON "case_history" FOR ALL TO partner_api USING (
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

CREATE POLICY tenant_isolation_policy ON "case_sequences" FOR ALL TO partner_api USING (
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

CREATE POLICY tenant_isolation_policy ON "case_attachments" FOR ALL TO partner_api USING (
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

CREATE POLICY tenant_isolation_policy ON "audit_logs" FOR ALL TO partner_api USING (
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- webhooks (tenant_id can be null)
CREATE POLICY tenant_isolation_policy ON "webhooks" FOR ALL TO partner_api USING (
  tenant_id IS NULL OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- integrations (tenant_id can be null)
CREATE POLICY tenant_isolation_policy ON "integrations" FOR ALL TO partner_api USING (
  tenant_id IS NULL OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

CREATE POLICY tenant_isolation_policy ON "agency_chat_messages" FOR ALL TO partner_api USING (
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- CREATE POLICY tenant_isolation_policy ON "api_keys" FOR ALL TO partner_api USING (
--   tenant_id = current_setting('app.current_tenant_id', true)::uuid
-- );

CREATE POLICY tenant_isolation_policy ON "audit_outbox" FOR ALL TO partner_api USING (
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- case_referrals (special case: from and to)
CREATE POLICY tenant_isolation_policy ON "case_referrals" FOR ALL TO partner_api USING (
  from_tenant_id = current_setting('app.current_tenant_id', true)::uuid OR
  to_tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- assignments (special case: join with cases)
CREATE POLICY tenant_isolation_policy ON "assignments" FOR ALL TO partner_api USING (
  case_id IN (SELECT id FROM "cases" WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)
);
