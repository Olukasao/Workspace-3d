-- Escritório 2D (modo pixel art). O modo do ambiente (3d ou 2d) fica em company_settings (chave workspace_mode, migração 003).
-- Layout por empresa e andar, com rascunho e publicado (mesmo fluxo do editor 3D). Os desenhos do 3D não são tocados.
CREATE TABLE office2d_layouts (
  company_id VARCHAR(40) NOT NULL,
  office_id VARCHAR(40) NOT NULL,
  status VARCHAR(12) NOT NULL,
  version INT NOT NULL,
  layout_json LONGTEXT NOT NULL,
  updated_by VARCHAR(40),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (company_id, office_id, status)
);

-- Quem senta em cada estação (mesa) do layout 2D. Independente dos vínculos de mesa do 3D: cada ambiente tem o seu.
CREATE TABLE seat2d_assignments (
  company_id VARCHAR(40) NOT NULL,
  office_id VARCHAR(40) NOT NULL,
  station_id VARCHAR(40) NOT NULL,
  employee_id VARCHAR(40) NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (company_id, office_id, station_id)
);
CREATE UNIQUE INDEX ux_seat2d_employee ON seat2d_assignments (company_id, office_id, employee_id);
