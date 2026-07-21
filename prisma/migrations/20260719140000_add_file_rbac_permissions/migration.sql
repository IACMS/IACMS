-- Add File Management Service RBAC permissions and assign them to existing roles.
-- Safe to re-run: uses ON CONFLICT / NOT EXISTS guards.

-- 1) Permissions
INSERT INTO permissions (id, resource, action, description, created_at)
SELECT gen_random_uuid(), v.resource, v.action, v.description, CURRENT_TIMESTAMP
FROM (VALUES
  ('file', 'read',   'View and download files'),
  ('file', 'upload', 'Upload files (single, batch, chunked)'),
  ('file', 'delete', 'Soft-delete files'),
  ('file', 'admin',  'Cross-service file admin (list all services)')
) AS v(resource, action, description)
WHERE NOT EXISTS (
  SELECT 1 FROM permissions p
  WHERE p.resource = v.resource AND p.action = v.action
);

-- 2) system_admin — all file permissions (known seed id)
INSERT INTO role_permissions (id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), '99999999-9999-9999-9999-999999999991', p.id, CURRENT_TIMESTAMP
FROM permissions p
WHERE p.resource = 'file'
  AND EXISTS (SELECT 1 FROM roles r WHERE r.id = '99999999-9999-9999-9999-999999999991')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = '99999999-9999-9999-9999-999999999991' AND rp.permission_id = p.id
  );

-- 3) tenant_admin — file read/upload/delete (not admin)
INSERT INTO role_permissions (id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), '55555555-5555-5555-5555-555555555555', p.id, CURRENT_TIMESTAMP
FROM permissions p
WHERE p.resource = 'file' AND p.action IN ('read', 'upload', 'delete')
  AND EXISTS (SELECT 1 FROM roles r WHERE r.id = '55555555-5555-5555-5555-555555555555')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = '55555555-5555-5555-5555-555555555555' AND rp.permission_id = p.id
  );

-- 4) case_manager — file read/upload/delete
INSERT INTO role_permissions (id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), '66666666-6666-6666-6666-666666666666', p.id, CURRENT_TIMESTAMP
FROM permissions p
WHERE p.resource = 'file' AND p.action IN ('read', 'upload', 'delete')
  AND EXISTS (SELECT 1 FROM roles r WHERE r.id = '66666666-6666-6666-6666-666666666666')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = '66666666-6666-6666-6666-666666666666' AND rp.permission_id = p.id
  );

-- 5) viewer — file read only
INSERT INTO role_permissions (id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), '77777777-7777-7777-7777-777777777777', p.id, CURRENT_TIMESTAMP
FROM permissions p
WHERE p.resource = 'file' AND p.action = 'read'
  AND EXISTS (SELECT 1 FROM roles r WHERE r.id = '77777777-7777-7777-7777-777777777777')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = '77777777-7777-7777-7777-777777777777' AND rp.permission_id = p.id
  );

-- 6) All intake_specialist roles (per-tenant) — file read/upload/delete
INSERT INTO role_permissions (id, role_id, permission_id, created_at)
SELECT gen_random_uuid(), r.id, p.id, CURRENT_TIMESTAMP
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'intake_specialist'
  AND p.resource = 'file' AND p.action IN ('read', 'upload', 'delete')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
