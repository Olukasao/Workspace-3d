-- Office 3D — esquema inicial.
-- SQL portátil: roda sem alteração em MariaDB (produção) e SQLite (caminho local reproduzível).
-- Datas em milissegundos desde a época (BIGINT). JSON guardado como texto.

CREATE TABLE companies (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  name VARCHAR(160) NOT NULL
);

CREATE TABLE employees (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  department VARCHAR(80) NOT NULL,
  extension VARCHAR(20) NOT NULL,
  chat_ref VARCHAR(80),
  accepts_transfers INT NOT NULL DEFAULT 1,
  active INT NOT NULL DEFAULT 1
);
CREATE INDEX ix_employees_company ON employees (company_id);

CREATE TABLE users (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(160) NOT NULL,
  role VARCHAR(16) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  employee_id VARCHAR(40),
  active INT NOT NULL DEFAULT 1,
  CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE sessions (
  token_hash VARCHAR(64) NOT NULL PRIMARY KEY,
  user_id VARCHAR(40) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE buildings (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL
);

CREATE TABLE floors (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  building_id VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  level INT NOT NULL DEFAULT 0
);

-- Um mapa por andar. O rascunho fica aqui; cada publicação vira uma linha imutável em office_revisions.
CREATE TABLE offices (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  floor_id VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  draft_json LONGTEXT NOT NULL,
  draft_version INT NOT NULL DEFAULT 1,
  draft_updated_by VARCHAR(40),
  draft_updated_at BIGINT NOT NULL,
  published_revision_id VARCHAR(40),
  CONSTRAINT uq_offices_floor UNIQUE (floor_id)
);
CREATE INDEX ix_offices_company ON offices (company_id);

CREATE TABLE office_revisions (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  office_id VARCHAR(40) NOT NULL,
  rev_number INT NOT NULL,
  scene_json LONGTEXT NOT NULL,
  draft_version INT NOT NULL,
  note VARCHAR(255),
  published_by VARCHAR(40) NOT NULL,
  published_at BIGINT NOT NULL,
  CONSTRAINT uq_revisions_number UNIQUE (office_id, rev_number)
);

CREATE TABLE asset_definitions (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40),
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(60) NOT NULL,
  default_kind VARCHAR(20) NOT NULL,
  mount VARCHAR(12) NOT NULL,
  pivot VARCHAR(16) NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  thumb_url VARCHAR(255),
  file_hash VARCHAR(64) NOT NULL,
  file_bytes INT NOT NULL,
  width_m DOUBLE NOT NULL,
  depth_m DOUBLE NOT NULL,
  height_m DOUBLE NOT NULL,
  surface_height_m DOUBLE,
  triangles INT NOT NULL DEFAULT 0,
  license VARCHAR(60) NOT NULL,
  author VARCHAR(160) NOT NULL,
  source_url VARCHAR(400) NOT NULL,
  attribution VARCHAR(600) NOT NULL,
  origin VARCHAR(16) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'approved',
  created_by VARCHAR(40),
  created_at BIGINT NOT NULL
);
CREATE INDEX ix_assets_company ON asset_definitions (company_id);
CREATE INDEX ix_assets_hash ON asset_definitions (file_hash);

CREATE TABLE seat_assignments (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  office_id VARCHAR(40) NOT NULL,
  object_id VARCHAR(40) NOT NULL,
  employee_id VARCHAR(40) NOT NULL,
  updated_by VARCHAR(40),
  updated_at BIGINT NOT NULL,
  CONSTRAINT uq_seat_object UNIQUE (office_id, object_id)
);

CREATE TABLE managed_devices (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  location VARCHAR(160),
  remote_provider VARCHAR(20),
  remote_address VARCHAR(80),
  active INT NOT NULL DEFAULT 1
);
CREATE INDEX ix_devices_company ON managed_devices (company_id);

-- Vínculo de um objeto da cena (ID estável da instância) com um recurso de integração.
CREATE TABLE integration_bindings (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  office_id VARCHAR(40) NOT NULL,
  object_id VARCHAR(40) NOT NULL,
  binding_type VARCHAR(20) NOT NULL,
  device_id VARCHAR(40),
  config_json TEXT,
  updated_by VARCHAR(40),
  updated_at BIGINT NOT NULL,
  CONSTRAINT uq_binding UNIQUE (office_id, object_id, binding_type)
);

CREATE TABLE remote_access_grants (
  user_id VARCHAR(40) NOT NULL,
  device_id VARCHAR(40) NOT NULL,
  company_id VARCHAR(40) NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE remote_access_requests (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  device_id VARCHAR(40) NOT NULL,
  object_id VARCHAR(40) NOT NULL,
  requested_by VARCHAR(40) NOT NULL,
  provider VARCHAR(20) NOT NULL,
  mode VARCHAR(8) NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE action_audit (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  actor_user_id VARCHAR(40) NOT NULL,
  actor_role VARCHAR(16) NOT NULL,
  action VARCHAR(40) NOT NULL,
  target_type VARCHAR(30) NOT NULL,
  target_id VARCHAR(80) NOT NULL,
  object_id VARCHAR(40),
  result VARCHAR(24) NOT NULL,
  mode VARCHAR(8) NOT NULL,
  detail_json TEXT,
  correlation_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX ix_audit_company_time ON action_audit (company_id, created_at);

CREATE TABLE idempotency_keys (
  user_id VARCHAR(40) NOT NULL,
  scope VARCHAR(40) NOT NULL,
  idem_key VARCHAR(80) NOT NULL,
  company_id VARCHAR(40) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  status_code INT NOT NULL DEFAULT 0,
  response_json LONGTEXT,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, scope, idem_key)
);

-- Provedor de demonstração: chat
CREATE TABLE chat_conversations (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  pair_key VARCHAR(100) NOT NULL,
  created_by VARCHAR(40) NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT uq_chat_pair UNIQUE (company_id, pair_key)
);

CREATE TABLE chat_messages (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  conversation_id VARCHAR(40) NOT NULL,
  sender_ref VARCHAR(40) NOT NULL,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX ix_chat_messages_conv ON chat_messages (conversation_id, created_at);

-- Provedor de demonstração: atendimentos e transferências
CREATE TABLE service_tickets (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  protocol VARCHAR(40) NOT NULL,
  customer_name VARCHAR(160) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  queue_name VARCHAR(80) NOT NULL,
  assignee_employee_id VARCHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL
);

CREATE TABLE ticket_transfers (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  ticket_id VARCHAR(40) NOT NULL,
  from_employee_id VARCHAR(40) NOT NULL,
  to_employee_id VARCHAR(40) NOT NULL,
  queue_name VARCHAR(80) NOT NULL,
  actor_user_id VARCHAR(40) NOT NULL,
  created_at BIGINT NOT NULL
);

-- Fila de impressão (adaptador de demonstração ou servidor de impressão corporativo)
CREATE TABLE print_jobs (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  printer_device_id VARCHAR(40) NOT NULL,
  object_id VARCHAR(40) NOT NULL,
  user_id VARCHAR(40) NOT NULL,
  file_name VARCHAR(200) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  file_bytes INT NOT NULL,
  stored_path VARCHAR(255),
  mode VARCHAR(8) NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  purge_after BIGINT NOT NULL
);
CREATE INDEX ix_print_jobs_company ON print_jobs (company_id, created_at);
