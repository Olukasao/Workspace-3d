/**
 * Geometria ORIGINAL simples (primitivas) para os itens sem modelo compatível nas fontes: mesa reta, mesa de reunião,
 * bancada de recepção, TV de parede, divisória baixa, placa e caixa. Medidas em metros, frente em +Z.
 * Paleta do produto: superfícies claras, madeira discreta, detalhes grafite e destaque azul.
 */
import { Document } from '@gltf-transform/core';
import { KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { BoxGeometry, CylinderGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Mat {
  color: string;
  rough?: number;
  metal?: number;
  emissive?: string;
  emissiveStrength?: number;
}

const MATS: Record<string, Mat> = {
  wood: { color: '#c8a57a', rough: 0.62 },
  graphite: { color: '#3b4048', rough: 0.55, metal: 0.25 },
  light: { color: '#eceef1', rough: 0.8 },
  fabric: { color: '#d5d9df', rough: 0.95 },
  blue: { color: '#2f6fed', rough: 0.5 },
  bezel: { color: '#17191d', rough: 0.4, metal: 0.3 },
  screen: { color: '#0b1524', rough: 0.25, emissive: '#16335f', emissiveStrength: 0.6 },
  white: { color: '#fbfbfc', rough: 0.7 },
};

type Part = { geom: BufferGeometry; mat: keyof typeof MATS };

const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: keyof typeof MATS): Part => ({ geom: new BoxGeometry(w, h, d).translate(x, y, z), mat });
const cyl = (r: number, h: number, x: number, y: number, z: number, mat: keyof typeof MATS, seg = 20): Part => ({ geom: new CylinderGeometry(r, r, h, seg).translate(x, y, z), mat });

export const BUILDERS: Record<string, () => Part[]> = {
  /** Mesa reta 1,40 × 0,70 × 0,75 m: tampo de madeira, pés em pórtico e painel traseiro grafite. */
  deskStraight: () => [
    box(1.4, 0.03, 0.7, 0, 0.735, 0, 'wood'),
    box(0.04, 0.72, 0.6, -0.66, 0.36, 0, 'graphite'),
    box(0.04, 0.72, 0.6, 0.66, 0.36, 0, 'graphite'),
    box(1.28, 0.3, 0.018, 0, 0.52, -0.29, 'graphite'),
    box(1.28, 0.04, 0.04, 0, 0.7, 0, 'graphite'),
  ],
  /** Mesa de reunião 2,40 × 1,10 × 0,75 m com dois pedestais. */
  meetingTable: () => [
    box(2.4, 0.04, 1.1, 0, 0.73, 0, 'wood'),
    box(0.1, 0.67, 0.6, -0.8, 0.375, 0, 'graphite'),
    box(0.1, 0.67, 0.6, 0.8, 0.375, 0, 'graphite'),
    box(0.5, 0.04, 0.8, -0.8, 0.02, 0, 'graphite'),
    box(0.5, 0.04, 0.8, 0.8, 0.02, 0, 'graphite'),
    box(1.6, 0.06, 0.06, 0, 0.66, 0, 'graphite'),
    box(0.5, 0.008, 0.16, 0, 0.754, 0, 'graphite'),
  ],
  /** Bancada de recepção 2,00 × 0,70 m: tampo de trabalho a 0,75 m e balcão de atendimento a 1,08 m voltado para +Z. */
  receptionCounter: () => [
    box(2.0, 0.03, 0.62, 0, 0.735, -0.04, 'wood'),
    box(2.0, 1.05, 0.05, 0, 0.525, 0.3, 'light'),
    box(2.04, 0.03, 0.28, 0, 1.065, 0.25, 'wood'),
    box(0.04, 1.05, 0.7, -0.98, 0.525, 0, 'graphite'),
    box(0.04, 1.05, 0.7, 0.98, 0.525, 0, 'graphite'),
    box(2.0, 0.05, 0.008, 0, 0.9, 0.329, 'blue'),
    box(2.0, 0.08, 0.05, 0, 0.04, 0.3, 'graphite'),
  ],
  /** TV de parede 55" (1,23 × 0,71 m): moldura fina, tela levemente emissiva. Âncora: centro da face traseira. */
  tvWall: () => [
    box(0.5, 0.3, 0.03, 0, 0, 0.015, 'graphite'),
    box(1.23, 0.71, 0.035, 0, 0, 0.0475, 'bezel'),
    box(1.2, 0.68, 0.004, 0, 0, 0.067, 'screen'),
  ],
  /** Divisória baixa de estação 1,40 × 1,10 m com pés. */
  lowPartition: () => [
    box(1.4, 0.95, 0.04, 0, 0.625, 0, 'fabric'),
    box(1.4, 0.03, 0.05, 0, 1.115, 0, 'graphite'),
    box(0.03, 1.1, 0.05, -0.7, 0.55, 0, 'graphite'),
    box(0.03, 1.1, 0.05, 0.7, 0.55, 0, 'graphite'),
    box(0.06, 0.02, 0.36, -0.7, 0.01, 0, 'graphite'),
    box(0.06, 0.02, 0.36, 0.7, 0.01, 0, 'graphite'),
  ],
  /** Placa de identificação de sala 0,32 × 0,11 m. */
  roomSign: () => [box(0.32, 0.11, 0.012, 0, 0, 0.006, 'white'), box(0.32, 0.022, 0.014, 0, -0.044, 0.007, 'blue'), cyl(0.006, 0.016, -0.14, 0.035, 0.008, 'graphite', 10)],
  /** Caixa organizadora 0,36 × 0,26 × 0,24 m com tampa. */
  storageBox: () => [box(0.36, 0.2, 0.26, 0, 0.1, 0, 'light'), box(0.38, 0.04, 0.28, 0, 0.22, 0, 'graphite'), box(0.1, 0.03, 0.006, 0, 0.12, 0.133, 'blue')],
};

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16);
  // sRGB -> linear (glTF guarda fatores de cor em espaço linear)
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
};

export function buildProcedural(builder: string): Document {
  const make = BUILDERS[builder];
  if (!make) throw new Error(`Construtor procedural desconhecido: ${builder}`);
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'Office 3D — geometria original procedural';
  const buffer = doc.createBuffer();
  const scene = doc.createScene('cena');
  doc.getRoot().setDefaultScene(scene);
  const mesh = doc.createMesh(builder);
  const byMat = new Map<string, BufferGeometry[]>();
  for (const p of make()) {
    const list = byMat.get(p.mat) ?? [];
    list.push(p.geom);
    byMat.set(p.mat, list);
  }
  for (const [key, geoms] of byMat) {
    const g = mergeGeometries(geoms, false);
    if (!g) throw new Error(`Falha ao unir a geometria de ${builder}/${key}`);
    const m = MATS[key];
    const [r, gr, b] = hex(m.color);
    const mat = doc.createMaterial(key).setBaseColorFactor([r, gr, b, 1]).setRoughnessFactor(m.rough ?? 0.7).setMetallicFactor(m.metal ?? 0);
    if (m.emissive) {
      mat.setEmissiveFactor(hex(m.emissive));
      if (m.emissiveStrength && m.emissiveStrength !== 1) {
        const ext = doc.createExtension(KHRMaterialsEmissiveStrength);
        mat.setExtension('KHR_materials_emissive_strength', ext.createEmissiveStrength().setEmissiveStrength(m.emissiveStrength));
      }
    }
    const prim = doc
      .createPrimitive()
      .setMaterial(mat)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.getAttribute('position').array)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.getAttribute('normal').array)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(g.getIndex()!.array)).setBuffer(buffer));
    mesh.addPrimitive(prim);
  }
  scene.addChild(doc.createNode(builder).setMesh(mesh));
  return doc;
}

/** Converte OBJ + MTL (cores Kd, sem texturas — formato do kit Kenney) em um Document glTF. */
export function objToDocument(obj: string, mtl: string, name: string): Document {
  const colors = new Map<string, { kd: [number, number, number]; d: number }>();
  let cur = '';
  for (const raw of mtl.split(/\r?\n/)) {
    const p = raw.trim().split(/\s+/);
    if (p[0] === 'newmtl') {
      cur = p[1];
      colors.set(cur, { kd: [0.8, 0.8, 0.8], d: 1 });
    } else if (p[0] === 'Kd' && colors.has(cur)) colors.get(cur)!.kd = [Number(p[1]), Number(p[2]), Number(p[3])];
    else if (p[0] === 'd' && colors.has(cur)) colors.get(cur)!.d = Number(p[1]);
  }
  const v: number[][] = [];
  const groups = new Map<string, number[]>();
  let mat = 'default';
  for (const raw of obj.split(/\r?\n/)) {
    const p = raw.trim().split(/\s+/);
    if (p[0] === 'v') v.push([Number(p[1]), Number(p[2]), Number(p[3])]);
    else if (p[0] === 'usemtl') mat = p[1];
    else if (p[0] === 'f') {
      const idx = p.slice(1).map((t) => {
        const i = parseInt(t.split('/')[0], 10);
        return i < 0 ? v.length + i : i - 1;
      });
      const out = groups.get(mat) ?? [];
      for (let i = 1; i < idx.length - 1; i++) {
        const [a, b, c] = [v[idx[0]], v[idx[i]], v[idx[i + 1]]];
        // triângulo degenerado (área ~0) não tem normal: fica de fora (o glTF Validator acusa normais não unitárias)
        const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
        const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.hypot(cx, cy, cz) < 1e-12) continue;
        out.push(...a, ...b, ...c);
      }
      groups.set(mat, out);
    }
  }
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'Office 3D — conversão OBJ para glTF';
  const buffer = doc.createBuffer();
  const scene = doc.createScene('cena');
  doc.getRoot().setDefaultScene(scene);
  const mesh = doc.createMesh(name);
  for (const [key, pos] of groups) {
    if (!pos.length) continue;
    // normais planas por face (estilo low poly do kit)
    const nrm = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
      const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (let k = 0; k < 3; k++) nrm.set([nx, ny, nz], i + k * 3);
    }
    const c = colors.get(key) ?? { kd: [0.8, 0.8, 0.8] as [number, number, number], d: 1 };
    const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
    const m = doc.createMaterial(key).setBaseColorFactor([lin(c.kd[0]), lin(c.kd[1]), lin(c.kd[2]), c.d]).setRoughnessFactor(0.8).setMetallicFactor(0);
    if (c.d < 1) m.setAlphaMode('BLEND');
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setMaterial(m)
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer)),
    );
  }
  scene.addChild(doc.createNode(name).setMesh(mesh));
  return doc;
}
