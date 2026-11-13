# Ara 3D Gen (código incorporado)

Cópia **sem alterações** de `src/core`, `src/export` e `scripts/node-assets.ts` do projeto [Ara 3D Gen](https://github.com/olatunde85/3d-gen) (commit `8db7a6adf61d4de4b2d4b152853d8ac78ed6b761`), licença **MIT** (arquivo `LICENSE` ao lado, Copyright (c) 2026 Josh Ola and Ara 3D Gen contributors).

Usado pelo Office 3D para gerar personagens a partir de parâmetros: no servidor (ao salvar o avatar) e no navegador (pré-visualização do "Meu avatar"). Os dados dos personagens (`public/assets/ara-data/`) são do MakeHuman, **CC0 1.0** (ver `public/assets/ara-data/LICENSE.txt`).

Para atualizar: `git -C .build-tools/ara3d pull`, copiar de novo as três pastas e atualizar o commit acima. Os dados `public/assets/ara-data` vêm de `npm run setup-assets` do Ara (o script do Ara tem um defeito no Windows: as chaves dos "targets" usam barras invertidas, o que deixa 0 controles de corpo. Corrija `scripts/build-assets.ts` trocando `relative(...)` por `relative(...).replace(/\\/g, '/')` nas duas linhas que montam as chaves, ou use o Linux/macOS).
