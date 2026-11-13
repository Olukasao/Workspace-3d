-- O que cada TV do escritório 2D mostra na tela do mapa: aviso do dia, equipe do atendimento (calculada da presença) ou um painel.
-- Só cria a tabela: não altera nem apaga dados existentes.
CREATE TABLE object2d_tv_content (
  company_id VARCHAR(40) NOT NULL,
  office_id VARCHAR(40) NOT NULL,
  object_id VARCHAR(40) NOT NULL,
  kind VARCHAR(12) NOT NULL,
  title VARCHAR(80) NOT NULL,
  body VARCHAR(500),
  url VARCHAR(300),
  updated_by VARCHAR(40),
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (company_id, office_id, object_id)
);
