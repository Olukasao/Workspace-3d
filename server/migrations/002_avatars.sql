-- Aparência persistida do avatar, por colaborador (a conta do usuário aponta para o colaborador em users.employee_id).
-- Estados temporários (online, digitando, em atendimento) NÃO ficam aqui: vivem só na memória do servidor (server/live.ts).
CREATE TABLE avatar_profiles (
  employee_id VARCHAR(40) NOT NULL PRIMARY KEY,
  company_id VARCHAR(40) NOT NULL,
  config_json TEXT NOT NULL,
  catalog_version INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_by VARCHAR(40),
  updated_at BIGINT NOT NULL
);
CREATE INDEX ix_avatar_company ON avatar_profiles (company_id);
