# Personagens e animação (substituído)

Este documento registrava as opções de personagens avaliadas quando o MVP não tinha avatares (Quaternius, Kenney, VRoid, Mixamo). **Ele foi substituído pela implementação dos avatares**, descrita em [avatars.md](avatars.md).

O que mudou em relação ao roteiro:

- **Fonte dos modelos:** em vez de personagens prontos de jogo, os avatares são gerados com o **MakeHuman (MPFB2 no Blender)**, com pacotes de recursos CC0. Isso permite trocar corpo, rosto, cabelo, roupas e cores, com rig padronizado (game_engine) em todas as peças.
- **Animação:** procedural (IK de dois ossos e pesos por estado), sem Mixamo. Não há arquivos de animação de terceiros para redistribuir.
- **Pipeline:** `tools/assets/process.ts` continua removendo skin e animação dos móveis, porque a cena é estática. Os avatares têm pipeline próprio (`tools/avatars/`), que preserva rig, morphs e atributos de máscara.
- **Cuidados de produto mantidos:**
  - o avatar é escolhido pela própria pessoa e nunca é deduzido do nome;
  - aparece só com os dados profissionais e a presença já autorizados;
  - nenhum conteúdo de conversa chega ao escritório 3D;
  - o perfil visualizador não recebe presença.
