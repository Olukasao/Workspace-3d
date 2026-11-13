# Avatares: estilo Ara 3D Gen (padrão) e escolha do estilo pelo administrador

O Office 3D tem **dois estilos de avatar**. O administrador escolhe o da empresa em **Integrações → Estilo dos avatares**, e a troca vale ao vivo para quem está com o escritório aberto.

| Estilo | Como a pessoa personaliza | Situação |
|---|---|---|
| **Ara 3D Gen** (padrão) | Escolhe um personagem pronto numa galeria de 16 (8 masculinos e 8 femininos, formais e casuais) e marca se o headset fica sempre à mostra | **ativo** |
| **MakeHuman** | Editor de peças: corpo, pele, rosto, cabelo, barba, roupas, sapatos e óculos, com cores ([avatars.md](avatars.md)) | guardado no projeto, **desativado** por padrão |

Trocar de estilo **não apaga nada**: cada pessoa guarda a escolha que fez em cada estilo (tabela `avatar_choices`, uma linha por colaborador e estilo) e volta a ela quando o estilo é reativado. Quem nunca escolheu no estilo ativo recebe um personagem padrão, sorteado a partir do ID do colaborador. **O gênero não é deduzido do nome.**

## O que muda para quem usa

- **Meu avatar** (clique no seu nome, no topo): no estilo Ara aparece a galeria com miniaturas e a pré-visualização 3D girando (em pé ou sentado na estação, trabalhando, digitando ou em atendimento). Salvar e Cancelar funcionam como antes. Só você edita o seu avatar.
- **No escritório**, os avatares ocupam a cadeira da mesa vinculada, com as mesmas poses e a mesma presença ao vivo do outro estilo ([avatars.md](avatars.md#o-que-a-pessoa-vê), [integrations.md](integrations.md#presença-ao-vivo-e-avatares)).
- **Administrador:** Integrações → "Estilo dos avatares". O servidor manda um snapshot novo a todas as conexões abertas, sem recarregar a página.

## Origem e licenças

- **Gerador:** [Ara 3D Gen](https://github.com/olatunde85/3d-gen), código MIT. Os personagens exportados podem ser usados em projetos comerciais e não comerciais sem atribuição. Só foi usado na construção; não é distribuído com o produto.
- **Dados** (corpos, rostos, cabelos, roupas, sapatos): MakeHuman, pacote `makehuman_system_assets`, **CC0 1.0**. O Ara baixa o mesmo pacote que o estilo MakeHuman já usava, então o corpo base é o mesmo. A diferença está nas roupas procedurais do Ara (terno, tailleur, blusa de seda, camisa, jeans), nos sapatos, na pose e no gerador.
- **Animação:** procedural, do próprio Office 3D. Os clipes de captura de movimento da CMU que o Ara embute **não são distribuídos** (os GLB saem sem animações).
- **Headset:** geometria original do projeto, montada na medida da cabeça de cada personagem.
- Lista por arquivo: `public/assets/avatars-ara/CREDITS.md` e tela **Créditos**.

**Peças evitadas:** as camisetas do pacote de sistema do MakeHuman trazem o logotipo do projeto estampado (`male_casualsuit02/04/06`, `female_casualsuit01/02`, `female_sportsuit01`). A galeria usa só roupas sem logotipo; nos casuais, as peças procedurais do Ara.

## Pipeline

```
Ara 3D Gen (clone em .build-tools/ara3d)   npm run avatars-ara:build     tools/avatars-ara/build.mjs + gallery.ts → .build-tools/ara-raw/*.glb + gallery.json
pós-processamento                           npm run avatars-ara:process   tools/avatars-ara/process.ts → public/assets/avatars-ara/** (GLB, LOD1, manifest, CREDITS.md)
miniaturas                                  npm run avatars-ara:thumbs    tools/avatars-ara/thumbs.mjs → public/assets/avatars-ara/thumbs/*.webp
```

**Instalar o Ara 3D Gen** (só para regerar a galeria; exige Node 20+ e cerca de 1,2 GB):

```bash
git clone https://github.com/olatunde85/3d-gen.git .build-tools/ara3d
cd .build-tools/ara3d && npm install && npm run setup-assets   # baixa ~420 MB de dados CC0 do MakeHuman
```

`npm install` roda código de terceiros (dependências do Ara 3D Gen) no seu computador. A galeria já gerada está no repositório, então **o produto roda sem nada disso**.

**Galeria:** a fonte é `tools/avatars-ara/gallery.ts` (parâmetros reproduzíveis de cada personagem: corpo, etnia, cabelo, roupa, sapato). A lista de nomes que o servidor valida está em `shared/avatarAra.ts`; um teste confere que as duas batem com o manifesto distribuído.

**Pós-processamento:**

- **LOD0** (detalhe médio): texturas em WebP (pele, olhos e cabelo 1024 px; roupas 256 px) e só 5 morph targets (3 visemas e o piscar).
- **LOD1** (detalhe baixo, simplificado com meshoptimizer a 28%): sem morph targets, sem normal, rugosidade, oclusão nem emissivo; texturas de 512 px (pele, olhos e cabelo) e 128 px.
- Confere o esqueleto (nomes Mixamo) e grava manifesto (origem, licença, commit do Ara) e créditos.

**Por que só 5 morph targets:** o Ara exporta 34 (ARKit e visemas). Com 34, o shader da pele não compila nesta GPU (ANGLE/Direct3D 11: "Shader Error 1282"), e o rig só usa os visemas `aa`, `O`, `I`. O MakeHuman usa 6.

## Montagem e animação

`src/three/avatar/ara.ts` carrega o GLB e devolve o mesmo `BuiltAvatar` do outro estilo:

- os ossos Mixamo (`Hips`, `LeftArm`…) ganham também os nomes que o rig usa (`pelvis`, `upperarm_l`…), em um mapa. **O rig procedural (IK) não mudou:** ele calcula tudo no espaço do avatar e não depende dos eixos locais dos ossos;
- os visemas do rig apontam para `viseme_aa`, `viseme_O`, `viseme_I`;
- cabelo, cílios e sobrancelhas são recorte por alfa; a camada de detalhes da pele é translúcida, sem escrita de profundidade;
- headset original preso ao osso `Head`.

## Banco e API

- `server/migrations/003_avatar_styles.sql`: `avatar_choices` (PK colaborador + estilo; copia o que já estava salvo como `makehuman`) e `company_settings` (chave `avatar_style` por empresa). A tabela `avatar_profiles` da migração 002 fica só para histórico.
- `GET` e `PUT /api/admin/avatar-style` (administrador): lê e troca o estilo; valor fora de `ara3d` e `makehuman` → 400; outros perfis → 403. Cada troca vai para a trilha (`avatar.style`, de e para).
- `GET /api/avatar/catalog`: estilo ativo, galeria do Ara e catálogo do MakeHuman.
- `GET` e `PUT /api/avatar/me`: operam no estilo ativo. Uma configuração de outro estilo é recusada com 422. Os eventos `snapshot` da presença trazem `avatarStyle`.
- A troca é **por empresa**: o administrador de outra empresa não muda o estilo desta.

## Desempenho com 25 avatares (`npm run perf:avatars`)

Mesmo cenário e ambiente do [estilo MakeHuman](avatars.md#desempenho-com-25-avatares-npm-run-perfavatars) (GPU integrada, headless, 1440×900, cache vazio). O Ara é **mais pesado**, porque cada um dos 16 personagens tem cerca de 20 materiais próprios e quase nada é compartilhado entre eles.

| Medida | MakeHuman | Ara 3D Gen |
|---|---|---|
| FPS câmera próxima (mediana / mínimo) | 37 / 23 | 32 / 8 |
| FPS câmera afastada | 49 / 29 | 30 / 29 |
| Triângulos (próxima / afastada) | 653 mil / 616 mil | 501 mil / 432 mil |
| Draw calls (próxima / afastada) | 334 / 375 | 457 / 533 |
| Texturas na GPU (próxima / afastada) | 160 / 131 | 900 / 683 |
| Heap JS (próxima / afastada) | 79 / 69 MB | 367 / 162 MB |
| Download dos avatares, cache vazio | 12,6 / 9,1 MB | 23,0 / 15,6 MB |

**Como melhorar** (não feito): juntar os materiais de cada personagem num atlas (menos draw calls e texturas), compartilhar texturas de roupa entre personagens (hoje cada GLB embute as suas) e descartar do cache os GLB de LOD0 que não estão em uso.

## Lacunas

1. **Personalização limitada:** o estilo Ara é uma galeria de 16 personagens prontos, sem editar cor de roupa, cabelo ou rosto. O Ara permite muito mais (219 controles do corpo, 20 peles, padrões e cores por peça); expor isso exigiria gerar os personagens no navegador (o gerador roda lá, mas pesa cerca de 85 MB de dados).
2. **Desempenho:** ver a tabela acima. Em máquinas fracas, o administrador pode voltar ao estilo MakeHuman.
3. **LOD1 simplificado** a 28%: de perto o rosto fica grosseiro, mas o LOD1 só aparece a mais de 10 m da câmera.
4. **Mãos:** a pose usa a mesma IK do outro estilo; os dedos curvam de forma simples.
