-- Enable RLS and Force it for all multi-tenant tables

-- departments
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "departments" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- users
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "users" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- roles (has optional tenant_id, if null it's a system role)
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "roles" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id IS NULL OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- workflows
ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflows" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "workflows" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- cases
ALTER TABLE "cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cases" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "cases" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- case_history
ALTER TABLE "case_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "case_history" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- case_sequences
ALTER TABLE "case_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_sequences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "case_sequences" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- case_attachments
ALTER TABLE "case_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "case_attachments" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- audit_logs
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "audit_logs" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- webhooks (tenant_id can be null)
ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhooks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "webhooks" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id IS NULL OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- integrations (tenant_id can be null)
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "integrations" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id IS NULL OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- agency_chat_messages
ALTER TABLE "agency_chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agency_chat_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "agency_chat_messages" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- api_keys (temporarily commented out because the table doesn't exist in previous migrations)
-- ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation_policy ON "api_keys" FOR ALL USING (

  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- audit_outbox
ALTER TABLE "audit_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_outbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "audit_outbox" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- case_referrals (special case: from and to)
ALTER TABLE "case_referrals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_referrals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "case_referrals" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  from_tenant_id = current_setting('app.current_tenant_id', true)::uuid OR
  to_tenant_id = current_setting('app.current_tenant_id', true)::uuid
);

-- assignments (special case: join with cases)
ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON "assignments" FOR ALL USING (
  current_setting('app.current_tenant_id', true) IS NULL OR
  current_setting('app.current_tenant_id', true) = '' OR
  case_id IN (SELECT id FROM "cases" WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid)
);
