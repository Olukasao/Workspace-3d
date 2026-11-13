/** Textos em português do editor de avatar (estilo Ara 3D Gen): controles do corpo, grupos e categorias. */

export const CATEGORY_PT: Record<string, string> = { Gender: 'Busto', Face: 'Rosto', Torso: 'Tronco', 'Arms and Legs': 'Braços e pernas' };

export const GROUP_PT: Record<string, string> = {
  Breast: 'Busto', 'head shape': 'Formato da cabeça', 'head size': 'Tamanho da cabeça', forehead: 'Testa', eyebrows: 'Sobrancelhas', neck: 'Pescoço',
  'right eye': 'Olho direito', 'left eye': 'Olho esquerdo', 'nose size': 'Nariz: tamanho', 'nose size details': 'Nariz: detalhes de tamanho', 'nose features': 'Nariz: características',
  'mouth size': 'Boca: tamanho', 'mouth size details': 'Boca: detalhes de tamanho', 'mouth features': 'Boca: características', 'right ear': 'Orelha direita', 'left ear': 'Orelha esquerda',
  'chin/jaw': 'Queixo e mandíbula', 'left cheek': 'Bochecha esquerda', 'right cheek': 'Bochecha direita', Torso: 'Tronco', Hip: 'Quadril', Stomach: 'Abdômen', Buttocks: 'Glúteos',
  'right hand': 'Mão direita', 'left hand': 'Mão esquerda', 'right foot': 'Pé direito', 'left foot': 'Pé esquerdo', 'left shoulder': 'Ombro esquerdo', 'right shoulder': 'Ombro direito',
  'right arm': 'Braço direito', 'left arm': 'Braço esquerdo', 'right leg': 'Perna direita', 'left leg': 'Perna esquerda', legs: 'Pernas',
};

/** Rótulo em inglês (já sem o sufixo "(decr/incr)") → português. */
const SLIDER_PT: Record<string, string> = {
  'Vertical position': 'Posição vertical', 'Horizontal distance': 'Distância horizontal', Pointiness: 'Pontiagudo', 'Breast Volume': 'Volume do busto', Age: 'Idade aparente',
  'Head fat': 'Gordura da cabeça', Angle: 'Ângulo', Oval: 'Oval', Round: 'Redondo', Rectangular: 'Retangular', Square: 'Quadrado', Triangular: 'Triangular', Invertedtriangular: 'Triangular invertido',
  Diamond: 'Losango', 'Scale depth of parietal side': 'Profundidade da lateral', 'Scale depth': 'Profundidade', 'Scale horizontally': 'Largura', 'Scale vertically': 'Altura',
  'Move horizontally': 'Mover na horizontal', 'Move vertically': 'Mover na vertical', 'Move depth': 'Mover em profundidade', 'Forehead bulge': 'Testa saliente', 'Cranic shape': 'Formato do crânio',
  'Temple bulge': 'Têmporas salientes', 'Eyebrows bulge': 'Arcada saliente', 'Eyebrows angle': 'Ângulo das sobrancelhas', 'Move vert': 'Mover na vertical', 'Double neck': 'Papada',
  'Scale depth of nape': 'Profundidade da nuca', 'Eye bag volume': 'Volume das olheiras', 'Eye bag height': 'Altura das olheiras', 'Eyefold angle': 'Ângulo da pálpebra', 'Eye epicanthus': 'Epicanto',
  'Eyefold volume': 'Volume da pálpebra', 'Scale height 1': 'Altura do olho 1', 'Scale height 2': 'Altura do olho 2', 'Scale height 3': 'Altura do olho 3',
  'Move outer corner horiz': 'Canto externo (horizontal)', 'Move inner corner horiz': 'Canto interno (horizontal)', 'Move eye horizontally': 'Mover o olho na horizontal', 'Scale eye': 'Tamanho do olho',
  'Move outer corner vert': 'Canto externo (vertical)', 'Move inner corner vert': 'Canto interno (vertical)', 'Scale nostrils width': 'Largura das narinas', 'Scale tip width': 'Largura da ponta do nariz',
  'Move base vert': 'Mover a base na vertical', 'Scale width 1': 'Largura 1', 'Scale width 2': 'Largura 2', 'Scale width 3': 'Largura 3', Compression: 'Achatamento', Curve: 'Curvatura', Greek: 'Nariz grego',
  Hump: 'Calombo', Volume: 'Volume', 'Nostrils angle': 'Ângulo das narinas', 'Move tip vertically': 'Mover a ponta na vertical', 'Septum Angle': 'Ângulo do septo', 'Scale nostrils flaring': 'Abertura das narinas',
  'Scale lowerlip height': 'Altura do lábio inferior', 'Scale lowerlip width': 'Largura do lábio inferior', 'Scale upperlip height': 'Altura do lábio superior', 'Scale upperlip width': 'Largura do lábio superior',
  "Cupid's bow width": 'Largura do arco do cupido', Dimples: 'Covinhas', 'Laugh-lines': 'Linhas de expressão', 'Lowerlip curved shape': 'Curva do lábio inferior', 'Move corners vert': 'Cantos da boca na vertical',
  'Scale middle lowerlip': 'Meio do lábio inferior', 'Scale lowerlip volume': 'Volume do lábio inferior', 'Scale philtrum volume': 'Volume do filtro', 'Scale upperlip volume': 'Volume do lábio superior',
  'Upperlip curved shape': 'Curva do lábio superior', 'Scale middle upperlip': 'Meio do lábio superior', "Cupid's bow shape": 'Formato do arco do cupido', 'Scale ear': 'Tamanho da orelha', 'Scale height': 'Altura',
  'Scale lobe': 'Lóbulo', 'Ear shape (pointed-triangle)': 'Formato (pontuda a triangular)', 'Ear rotation': 'Rotação da orelha', 'Scale width': 'Largura', 'Ear wing-shaped': 'Orelha de abano', 'Ear flapped': 'Orelha dobrada',
  'Tone of side chin': 'Tônus lateral do queixo', 'Cleft chin': 'Queixo com fenda', 'Scale chin prominence': 'Projeção do queixo', 'Scale chin width': 'Largura do queixo', 'Scale chin height': 'Altura do queixo',
  'Scale chin angular': 'Queixo angular', 'Scale chin prognathism': 'Prognatismo', 'Cheek outer volume': 'Volume externo da bochecha', 'Scale cheek prominence': 'Maçã do rosto', 'Cheek inner volume': 'Volume interno da bochecha',
  'Scale cone-shape': 'Formato cônico', 'Dorsi muscle': 'Músculo dorsal', 'Pectoral muscle': 'Músculo peitoral', 'Waist vertical position': 'Posição da cintura', 'Muscular tone': 'Tônus muscular',
  'Pregnancy shape': 'Barriga proeminente', 'Navel bump': 'Umbigo saliente', 'Navel position': 'Posição do umbigo', 'Buttocks volume': 'Volume do glúteo', 'Fingers distance': 'Distância entre os dedos',
  'Fingers diameter': 'Espessura dos dedos', 'Fingers length': 'Comprimento dos dedos', 'Scale hand': 'Tamanho da mão', 'Hand position': 'Posição da mão', 'Scale foot': 'Tamanho do pé',
  'Shoulder muscle mass': 'Massa muscular do ombro', 'Lowerarm thickness 1': 'Espessura do antebraço 1', 'Lowerarm length': 'Comprimento do antebraço', 'Lowerarm thickness 2': 'Espessura do antebraço 2',
  'Lowerarm skinny-fat': 'Antebraço: magro a gordo', 'Lowerarm muscles': 'Músculos do antebraço', 'Upperarm thickness 1': 'Espessura do braço 1', 'Upperarm length': 'Comprimento do braço',
  'Upperarm thickness 2': 'Espessura do braço 2', 'Upperarm skinny-fat': 'Braço: magro a gordo', 'Upperarm muscles': 'Músculos do braço', 'Move knee horizontally': 'Joelho na horizontal',
  'Lowerleg scale depth': 'Profundidade da canela', 'Lowerleg scale horizontally': 'Largura da canela', 'Lowerleg skinny-fat': 'Canela: magra a gorda', 'Lowerleg muscle': 'Músculo da canela',
  'Upperleg scale depth': 'Profundidade da coxa', 'Upperleg scale horizontally': 'Largura da coxa', 'Move knee vertically': 'Joelho na vertical', 'Upperleg skinny-fat': 'Coxa: magra a gorda',
  'Upperleg muscle': 'Músculo da coxa', 'Upperlegs height': 'Altura das coxas', 'Lowerlegs height': 'Altura das canelas',
};

const clean = (l: string) => l.replace(/\s*\((?:[^()]*\/[^()]*)\)\s*$/, '').replace(/\.$/, '').trim();
/** Rótulo de um controle em português (cai no texto original se faltar tradução). */
export const sliderLabelPt = (en: string) => SLIDER_PT[clean(en)] ?? clean(en);
export const groupPt = (g: string) => GROUP_PT[g] ?? g;

// ---------- nomes das opções do editor (estilo Ara 3D Gen) ----------

const EYES_PT: Record<string, string> = { blue: 'Azul', bluegreen: 'Azul-esverdeado', brown: 'Castanho', darkbrown: 'Castanho-escuro', blackbrown: 'Preto-acastanhado', brownlight: 'Castanho-claro', deepblue: 'Azul-profundo', green: 'Verde', grey: 'Cinza', ice: 'Gelo', lightblue: 'Azul-claro' };
const HAIR_STYLE_PT: Record<string, string> = { afro: 'Afro', bob: 'Chanel', ponytail: 'Rabo de cavalo', long: 'Longo', braid: 'Trança', short: 'Curto', buzz: 'Raspado', mohawk: 'Moicano', cornrows: 'Tranças nagô', box_braids: 'Tranças box' };
const OUTFIT_PT: Record<string, string> = {
  none: 'Peças soltas (escolher cada uma)', set_suit_tie: 'Terno com gravata', set_pantsuit: 'Tailleur com blusa de seda', male_elegantsuit01: 'Terno masculino', female_elegantsuit01: 'Blusa e saia',
  male_casualsuit01: 'Camisa azul e jeans', male_casualsuit03: 'Camisa listrada e jeans', male_casualsuit05: 'Jaqueta e jeans',
};
const PIECE_PT: Record<string, string> = {
  none: 'Nenhuma', camp_shirt: 'Camisa de manga curta', silk_blouse: 'Blusa de seda', oversized_tee: 'Camiseta larga', suit_shirt_tie: 'Camisa com gravata', uniform_shirt: 'Camisa de uniforme (curta)', uniform_shirt_long: 'Camisa de uniforme (longa)',
  peplum_top: 'Blusa peplum', lace_top: 'Blusa de renda', ankara_gown: 'Vestido estampado', suit_jacket: 'Paletó', overcoat: 'Sobretudo', suit_trousers: 'Calça de terno', trousers: 'Calça solta', baggy_jeans: 'Calça jeans larga',
  uniform_trousers: 'Calça de uniforme', pencil_skirt_midi: 'Saia lápis (abaixo do joelho)', pencil_skirt_maxi: 'Saia lápis (longa)', heels: 'Salto alto', sneakers: 'Tênis', loafers: 'Mocassim', oxfords: 'Sapato social',
  shoes01: 'Sapato 1', shoes02: 'Sapato 2', shoes03: 'Sapato 3', shoes04: 'Sapato 4', shoes05: 'Sapato 5', shoes06: 'Sapato 6',
  watch: 'Relógio', watch_gold: 'Relógio dourado', watch_silver: 'Relógio prateado', fine_pendant: 'Colar fino com pingente', gold_necklace: 'Colar dourado', pearl_necklace: 'Colar de pérolas', gold_ring: 'Anel dourado', bangles: 'Pulseiras', belt: 'Cinto',
};
const PATTERN_PT: Record<string, string> = { solid: 'Liso', suiting: 'Tecido de terno', linen: 'Linho', tropical: 'Tropical', satin: 'Cetim', jersey: 'Malha', striped: 'Listrado', denim: 'Jeans', lace: 'Renda', damask: 'Damasco', ankara: 'Ankara', ankara_floral: 'Ankara floral', ankara_web: 'Ankara geométrico', nappa: 'Couro', patent: 'Verniz', leather: 'Couro natural', workwear: 'Lona' };
const FACIAL_PT: Record<string, string> = { none: 'Sem barba', stubble: 'Barba por fazer', mustache: 'Bigode', mustache_stubble: 'Bigode e barba por fazer', goatee: 'Cavanhaque', short_beard: 'Barba curta', full_beard: 'Barba cheia' };
const EARRING_PT: Record<string, string> = { none: 'Sem brincos', studs: 'Brincos pequenos', pearl_drops: 'Pérolas', small_hoops: 'Argolas pequenas', big_hoops: 'Argolas grandes' };

export const eyesPt = (id: string) => EYES_PT[id] ?? id;
export const hairPt = (id: string) => {
  const m = /^([a-z_]+?)(\d+)?$/.exec(id);
  const base = m ? HAIR_STYLE_PT[m[1]] : undefined;
  return base ? (m![2] ? `${base} ${Number(m![2])}` : base) : id;
};
export const outfitPt = (id: string) => OUTFIT_PT[id] ?? id;
export const piecePt = (id: string) => PIECE_PT[id] ?? id;
export const patternPt = (id: string) => PATTERN_PT[id] ?? id;
export const facialHairPt = (id: string) => FACIAL_PT[id] ?? id;
export const earringPt = (id: string) => EARRING_PT[id] ?? id;
export const browPt = (id: string) => `Sobrancelha ${Number(id.replace(/\D/g, ''))}`;
export const lashPt = (id: string) => `Cílios ${Number(id.replace(/\D/g, ''))}`;
/** "young_african_female" → "Jovem · africana" (a pele de cada opção do catálogo do Ara). */
export const skinPt = (id: string) => {
  const age = id.startsWith('young') ? 'Jovem' : id.startsWith('middleage') ? 'Meia-idade' : 'Idosa(o)';
  const eth = id.includes('african') ? 'africana' : id.includes('asian') ? 'asiática' : 'europeia';
  const g = id.includes('female') ? 'feminina' : 'masculina';
  const variant = id.endsWith('2') ? ' (variação)' : '';
  return `${age} · ${eth} · ${g}${variant}`;
};
