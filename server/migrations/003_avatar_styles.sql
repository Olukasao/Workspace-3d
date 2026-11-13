-- Estilo de avatar por empresa e aparência por colaborador E por estilo.
-- Trocar o estilo (Ara 3D Gen <-> MakeHuman) não apaga nada: cada estilo guarda a sua própria escolha de cada pessoa.
-- avatar_profiles (migração 002) fica como está, só para histórico; a aplicação passa a ler e gravar em avatar_choices.
CREATE TABLE avatar_choices (
  employee_id VARCHAR(40) NOT NULL,
  style VARCHAR(20) NOT NULL,
  company_id VARCHAR(40) NOT NULL,
  config_json TEXT NOT NULL,
  catalog_version INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_by VARCHAR(40),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (employee_id, style)
);
CREATE INDEX ix_avatar_choices_company ON avatar_choices (company_id);

-- o que já estava salvo é do estilo MakeHuman (o único que existia)
INSERT INTO avatar_choices (employee_id, style, company_id, config_json, catalog_version, version, updated_by, updated_at)
  SELECT employee_id, 'makehuman', company_id, config_json, catalog_version, version, updated_by, updated_at FROM avatar_profiles;

-- ajustes por empresa (chave/valor). Hoje: avatar_style.
CREATE TABLE company_settings (
  company_id VARCHAR(40) NOT NULL,
  setting_key VARCHAR(60) NOT NULL,
  setting_value VARCHAR(200) NOT NULL,
  updated_by VARCHAR(40),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (company_id, setting_key)
);
