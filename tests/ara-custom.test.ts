import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARA_DEFAULT_PARAMS, ARA_EDITOR_SLIDERS, ARA_MIN_AGE, normalizeAraParams, type AraParams } from '../shared/araCustom';
import { ARA_PRESETS, ARA_SLIDERS } from '../shared/araCatalog.generated';
import { validateAraAvatar, type AraCustomConfig } from '../shared/avatarAra';
import { canonicalJson, modelId } from '../server/araGen';
import { ADMIN, Client, OPERATOR, OTHER_ADMIN, VIEWER, startServer, type TestServer } from './helpers';

const custom = (patch: Partial<AraParams> = {}): AraParams => ({ ...ARA_DEFAULT_PARAMS, ...patch });
const errorsOf = (raw: unknown) => normalizeAraParams(raw).errors.join(' | ');

describe('parâmetros do personagem personalizado (validação estrita)', () => {
  it('os parâmetros padrão e os 16 personagens prontos são válidos', () => {
    expect(normalizeAraParams(ARA_DEFAULT_PARAMS).errors).toEqual([]);
    for (const p of ARA_PRESETS) expect(normalizeAraParams(p.params).errors, p.id).toEqual([]);
  });

  it('recusa campos desconhecidos, números fora da faixa e menores de 18 anos', () => {
    expect(errorsOf({ ...ARA_DEFAULT_PARAMS, weapon: 'rifle' })).toMatch(/desconhecidos/);
    expect(errorsOf(custom({ weight: 1.5 }))).toMatch(/weight/);
    expect(errorsOf(custom({ height: Number.NaN }))).toMatch(/height/);
    expect(errorsOf(custom({ age: ARA_MIN_AGE - 0.01 }))).toMatch(/age/); // só adultos
    expect(normalizeAraParams(custom({ age: ARA_MIN_AGE })).errors).toEqual([]);
    expect(errorsOf(null)).toMatch(/ausentes/);
  });

  it('só aceita ids permitidos: sem armas, fantasias, biquíni, óculos escuros, tatuagens nem chapéus', () => {
    expect(errorsOf(custom({ outfit: 'set_gold_bikini' }))).toMatch(/Roupa/);
    expect(errorsOf(custom({ outfit: 'set_clergy' }))).toMatch(/Roupa/);
    expect(errorsOf(custom({ outfit: 'male_casualsuit04' }))).toMatch(/Roupa/); // traz o logotipo do MakeHuman
    expect(errorsOf(custom({ outfit: 'none', top: 'bikini_top', bottom: 'trousers' }))).toMatch(/Parte de cima/);
    expect(errorsOf(custom({ accessories: ['sunglasses'] }))).toMatch(/Acessórios/);
    expect(errorsOf(custom({ shoes: 'slides' }))).toMatch(/Calçado/);
    expect(errorsOf({ ...custom(), tattoos: ['chest'] })).toMatch(/desconhecidos/);
    expect(errorsOf({ ...custom(), hat: 'fedora01' })).toMatch(/desconhecidos/);
    expect(errorsOf(custom({ hair: '../../etc/passwd' }))).toMatch(/Cabelo/);
    expect(errorsOf(custom({ hairColor: 'red' }))).toMatch(/hairColor/);
    expect(errorsOf(custom({ hairColor: '#12345' }))).toMatch(/hairColor/);
  });

  it('sempre vestido: sem conjunto exige parte de cima e de baixo; com conjunto, as peças soltas ficam vazias', () => {
    expect(errorsOf(custom({ outfit: 'none', top: 'none', bottom: 'none' }))).toMatch(/Sem conjunto/);
    expect(errorsOf(custom({ outfit: 'none', top: 'silk_blouse', bottom: 'none' }))).toMatch(/Sem conjunto/);
    expect(errorsOf(custom({ outfit: 'none', top: 'silk_blouse', bottom: 'trousers' }))).toBe('');
    expect(errorsOf(custom({ outfit: 'set_pantsuit', top: 'silk_blouse' }))).toMatch(/Com conjunto/);
    expect(errorsOf(custom({ outfit: 'male_elegantsuit01', gender: 0 }))).toMatch(/não serve/);
    expect(errorsOf(custom({ outfit: 'female_elegantsuit01', gender: 1 }))).toMatch(/não serve/);
  });

  it('controles do corpo: só os do catálogo, dentro da faixa; os escondidos são recusados', () => {
    const bip = ARA_SLIDERS.find((s) => s.bipolar)!;
    const uni = ARA_SLIDERS.find((s) => !s.bipolar)!;
    expect(errorsOf(custom({ modifiers: { [bip.id]: -0.5 } }))).toBe('');
    expect(errorsOf(custom({ modifiers: { [uni.id]: 0.5 } }))).toBe('');
    expect(errorsOf(custom({ modifiers: { [uni.id]: -0.5 } }))).toMatch(/fora da faixa/);
    expect(errorsOf(custom({ modifiers: { [bip.id]: 2 } }))).toMatch(/fora da faixa/);
    expect(errorsOf(custom({ modifiers: { 'inexistente/x': 0.1 } }))).toMatch(/não existe/);
    expect(errorsOf(custom({ modifiers: [] as never }))).toMatch(/inválidos/);
    const hidden = ARA_SLIDERS.filter((s) => !ARA_EDITOR_SLIDERS.includes(s));
    expect(hidden.length).toBeGreaterThan(0);
    expect(errorsOf(custom({ modifiers: { [hidden[0].id]: 0.5 } }))).toMatch(/não existe/);
    // valores zero não ocupam espaço
    expect(normalizeAraParams(custom({ modifiers: { [bip.id]: 0 } })).params.modifiers).toEqual({});
  });

  it('estilos das peças: só peças permitidas, com padrões e cores válidos', () => {
    expect(errorsOf(custom({ outfit: 'set_pantsuit', garmentStyles: { suit_jacket: { pattern: 'suiting', color: '#26324a' } } }))).toBe('');
    expect(errorsOf(custom({ outfit: 'set_pantsuit', garmentStyles: { set_pantsuit: { pattern: 'suiting', color: '#26324a', color2: '#34425f' } } }))).toBe('');
    expect(errorsOf(custom({ garmentStyles: { suit_jacket: { pattern: 'camo' } } }))).toMatch(/Padrão/);
    expect(errorsOf(custom({ garmentStyles: { gold_chains: { color: '#ffffff' } } }))).toMatch(/fora da lista/);
    expect(errorsOf(custom({ garmentStyles: { suit_jacket: { color: 'azul' } } }))).toMatch(/Cor/);
    expect(errorsOf(custom({ garmentStyles: { suit_jacket: { script: 'x' } as never } }))).toMatch(/inválido/);
  });

  it('o identificador do modelo não depende da ordem dos campos e muda com qualquer parâmetro', () => {
    const a = custom({ hair: 'bob01', hairColor: '#112233' });
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as AraParams;
    expect(modelId(a)).toBe(modelId(reordered));
    expect(modelId(a)).toMatch(/^[a-f0-9]{16}$/);
    expect(modelId(custom({ hair: 'bob02', hairColor: '#112233' }))).not.toBe(modelId(a));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it('a configuração personalizada exige o formato certo e o modelo (se vier) precisa ser um hash', () => {
    const ok: AraCustomConfig = { v: 1, style: 'ara3d', custom: ARA_DEFAULT_PARAMS, headsetAlways: false };
    expect(validateAraAvatar(ok)).toEqual([]);
    expect(validateAraAvatar({ ...ok, model: '0123456789abcdef' })).toEqual([]);
    expect(validateAraAvatar({ ...ok, model: '../../x' }).join(' ')).toMatch(/modelo/);
    expect(validateAraAvatar({ ...ok, character: 'ara-m1' }).join(' ')).toMatch(/não os dois/);
    expect(validateAraAvatar({ ...ok, extra: 1 }).join(' ')).toMatch(/desconhecidos/);
  });
});

describe('personagem personalizado: o servidor gera o modelo 3D', () => {
  let s: TestServer;
  let admin: Client, operator: Client, viewer: Client, other: Client;
  beforeAll(async () => {
    s = await startServer();
    admin = await new Client(s.url).login(ADMIN);
    operator = await new Client(s.url).login(OPERATOR);
    viewer = await new Client(s.url).login(VIEWER);
    other = await new Client(s.url).login(OTHER_ADMIN);
  }, 30000);
  afterAll(async () => {
    s.ctx.ara.close();
    await s.close();
  });

  const cfg = (p: AraParams): AraCustomConfig => ({ v: 1, style: 'ara3d', custom: p, headsetAlways: false });
  const glbMagic = (b: Buffer) => b.subarray(0, 4).toString('latin1');
  const fetchModel = (c: Client, model: string, file = 'lod0.glb') => fetch(`${s.url}/api/avatar/model/${model}/${file}`, { headers: { Cookie: c.cookie } });
  let model = '';
  const mine = async () => (await operator.get<{ version: number }>('/api/avatar/me')).body.version;

  it('salvar gera LOD0 e LOD1 (GLB válido), devolve o identificador e persiste os parâmetros normalizados', async () => {
    const params = custom({ gender: 0, age: 0.6, height: 0.3, weight: 0.6, hair: 'bob01', hairColor: '#4a2f1d', outfit: 'set_pantsuit', shoes: 'heels', garmentStyles: { set_pantsuit: { pattern: 'suiting', color: '#26324a', color2: '#34425f' } }, modifiers: { 'head/head-fat': 0.3 } });
    const r = await operator.put<{ version: number; style: string; config: AraCustomConfig }>('/api/avatar/me', { config: { ...cfg(params), model: 'ffffffffffffffff' }, baseVersion: await mine() });
    expect(r.status).toBe(200);
    expect(r.body.config.model).toMatch(/^[a-f0-9]{16}$/);
    expect(r.body.config.model).not.toBe('ffffffffffffffff'); // o servidor ignora o modelo que o cliente mandou
    expect(r.body.config.model).toBe(modelId(normalizeAraParams(params).params));
    model = r.body.config.model!;
    const lod0 = await fetchModel(operator, model, 'lod0.glb');
    const lod1 = await fetchModel(operator, model, 'lod1.glb');
    expect(lod0.status).toBe(200);
    expect(lod0.headers.get('content-type')).toBe('model/gltf-binary');
    expect(lod0.headers.get('cache-control')).toMatch(/immutable/);
    const b0 = Buffer.from(await lod0.arrayBuffer());
    const b1 = Buffer.from(await lod1.arrayBuffer());
    expect(glbMagic(b0)).toBe('glTF');
    expect(glbMagic(b1)).toBe('glTF');
    expect(b0.length).toBeGreaterThan(200_000);
    expect(b1.length).toBeLessThan(b0.length);
    const back = (await operator.get<{ config: AraCustomConfig; saved: boolean }>('/api/avatar/me')).body;
    expect(back.saved).toBe(true);
    expect(back.config.model).toBe(model);
    expect(back.config.custom.hair).toBe('bob01');
  }, 120000);

  it('o modelo vai para os colegas da mesma empresa (e só para eles); arquivos inexistentes e ids malformados dão 404', async () => {
    expect((await fetchModel(admin, model)).status).toBe(200); // colega da mesma empresa
    expect((await fetchModel(viewer, model, 'lod1.glb')).status).toBe(200);
    expect((await fetchModel(other, model)).status).toBe(404); // outra empresa
    expect((await fetchModel(admin, '0123456789abcdef')).status).toBe(404);
    expect((await fetchModel(admin, model, 'lod2.glb')).status).toBe(404);
    expect((await fetchModel(admin, '..%2F..%2Fetc', 'lod0.glb')).status).toBe(404);
    expect((await fetch(`${s.url}/api/avatar/model/${model}/lod0.glb`)).status).toBe(401); // sem sessão
  });

  it('os colegas veem os parâmetros e o modelo na presença ao vivo', async () => {
    const snap = (await admin.get<{ people: Array<{ employeeId: string; appearance: { config: AraCustomConfig } | null }> }>('/api/live/snapshot')).body;
    const otavio = snap.people.find((p) => p.employeeId === 'emp_otavio');
    expect(otavio?.appearance?.config.model).toBe(model);
    expect(otavio?.appearance?.config.custom.outfit).toBe('set_pantsuit');
  });

  it('salvar os mesmos parâmetros de novo é instantâneo (o modelo já existe) e não cai no limite de uso', async () => {
    const t0 = Date.now();
    const params = (await operator.get<{ config: AraCustomConfig }>('/api/avatar/me')).body.config.custom;
    const r = await operator.put<{ config: AraCustomConfig }>('/api/avatar/me', { config: cfg(params), baseVersion: await mine() });
    expect(r.status).toBe(200);
    expect(r.body.config.model).toBe(model);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('gerar outro personagem logo em seguida é limitado (429); o administrador não edita o de outra pessoa; parâmetros inválidos dão 422', async () => {
    await new Promise((r) => setTimeout(r, 4200)); // passa o intervalo desde a primeira geração
    const first = custom({ hair: 'short03', hairColor: '#223344', outfit: 'set_suit_tie', shoes: 'loafers' });
    expect((await operator.put('/api/avatar/me', { config: cfg(first), baseVersion: await mine() })).status).toBe(200);
    const other1 = custom({ hair: 'short01', hairColor: '#112233' });
    const limited = await operator.put('/api/avatar/me', { config: cfg(other1), baseVersion: await mine() }); // logo em seguida
    expect(limited.status).toBe(429);
    expect((await admin.put('/api/avatar/employees/emp_otavio', { config: cfg(other1), baseVersion: 1 })).status).toBe(403);
    expect((await operator.put('/api/avatar/me', { config: cfg(custom({ outfit: 'set_gold_bikini' })), baseVersion: await mine() })).status).toBe(422);
    expect((await operator.put('/api/avatar/me', { config: { ...cfg(custom()), custom: { ...custom(), weapon: 'rifle' } }, baseVersion: await mine() })).status).toBe(422);
  });
});
