-- Editable permissions: each role's permissions, and extra permissions for
-- individual people. The System Administrator edits both in Roles & Audit.
--
--   * The System Administrator role is never stored: it always has everything.
--   * 'manage:users' is never stored for anyone else; the API refuses it.
--   * A role saved with no permissions keeps one marker row (permission '') so an
--     empty list is not mistaken for "never saved, use the defaults".
--   * The rows below are today's defaults, with Marketing Staff now able to
--     archive and restore (owner's request, 2026-09-14), and the old single
--     "admin areas" permission split into one permission per page.

CREATE TABLE role_permissions (
  role        VARCHAR(32)  NOT NULL,
  permission  VARCHAR(40)  NOT NULL,
  updated_by  VARCHAR(24)  NULL,
  updated_at  DATETIME(3)  NULL,
  PRIMARY KEY (role, permission),
  CONSTRAINT fk_role_permissions_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_permissions (
  user_id     VARCHAR(24)  NOT NULL,
  permission  VARCHAR(40)  NOT NULL,
  granted_by  VARCHAR(24)  NULL,
  granted_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (user_id, permission),
  CONSTRAINT fk_user_permissions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_permissions_granter FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO role_permissions (role, permission) VALUES
  ('Marketing Manager', 'view:contact-details'),
  ('Marketing Manager', 'edit:resources'),
  ('Marketing Manager', 'assign:resources'),
  ('Marketing Manager', 'import:records'),
  ('Marketing Manager', 'export:data'),
  ('Marketing Manager', 'request:credential-access'),
  ('Marketing Manager', 'archive:records'),
  ('Marketing Staff', 'view:contact-details'),
  ('Marketing Staff', 'edit:resources'),
  ('Marketing Staff', 'import:records'),
  ('Marketing Staff', 'request:credential-access'),
  ('Marketing Staff', 'archive:records'),
  ('Read-only Reviewer', '');
