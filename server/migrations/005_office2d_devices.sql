-- Dispositivo gerenciado (PC ou player da TV) ligado a um objeto do layout 2D, por exemplo uma TV pendurada na parede.
-- Só cria a tabela: não altera nem apaga dados existentes. Independente dos vínculos do 3D (integration_bindings).
CREATE TABLE object2d_devices (
  company_id VARCHAR(40) NOT NULL,
  office_id VARCHAR(40) NOT NULL,
  object_id VARCHAR(40) NOT NULL,
  device_id VARCHAR(40) NOT NULL,
  updated_by VARCHAR(40),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (company_id, office_id, object_id)
);
