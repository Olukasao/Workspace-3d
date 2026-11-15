/**
 * Cena 3D compartilhada pelo editor e pelo modo operacional.
 * Reaproveita do FigureBox Planner (commit f478167): a estrutura do Canvas com OrbitControls/Environment procedural
 * (ThreeDViewer.tsx), o contorno de seleção com <Edges> (RoomFurniture.tsx: FootprintRing), as paredes que baixam
 * quando ficam entre a câmera e o ambiente (Room3D.tsx: FadingWall) e o medidor de desempenho (ThreeDViewer.tsx: PerfProbe).
 */
import { Edges, Environment, Html, Lightformer, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { chairSwivel } from './avatar/lifeStore';
import { memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Box3, DoubleSide, InstancedMesh, MathUtils, Matrix4, Object3D, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3, type Group, type Texture } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { indexObjects, worldTransform } from '../../shared/scene';
import type { AssetDefinition, FloorFinish, SceneDoc, SceneObject, Transform } from '../../shared/types';
import { disposeAllAssets, meshParts, useAssetScene } from './assetCache';

export const BLUE = '#2f6fed';
const HOVER = '#7aa5ff';
const WARN = '#d69e2e';

export interface FocusRequest {
  x: number;
  z: number;
  radius: number;
  nonce: number;
}

export interface Scene3DProps {
  doc: SceneDoc;
  assets: Record<string, AssetDefinition>;
  view: 'iso' | 'plan';
  selected: ReadonlySet<string>;
  hovered: string | null;
  actionable?: ReadonlySet<string>;
  warnings?: ReadonlySet<string>;
  /** Objetos que respondem a ponteiro (os demais deixam o clique passar). */
  interactive: (o: SceneObject) => boolean;
  onPointerDownObject?: (id: string, e: ThreeEvent<PointerEvent>) => void;
  onClickObject?: (id: string) => void;
  onHover?: (id: string | null) => void;
  onMissed?: () => void;
  focus?: FocusRequest | null;
  /** Modo operacional: objetos repetidos e não acionáveis viram InstancedMesh. */
  instancing?: boolean;
  showGrid?: number;
  /** Assentos fixos a destacar (mesa selecionada): posição, direção do olhar e rótulo. */
  seatMarkers?: Array<{ x: number; z: number; rotY: number; label: string }>;
  /** Ferramenta de desenho ativa: o botão esquerdo desenha em vez de girar a câmera. */
  drawing?: boolean;
  children?: ReactNode;
}

const FLOOR_TEXTURE: Record<FloorFinish, string | null> = {
  wood: '/assets/textures/piso-madeira.webp',
  carpet: '/assets/textures/piso-carpete.webp',
  concrete: '/assets/textures/piso-concreto.webp',
  tile: '/assets/textures/piso-ceramica.webp',
  plain: null,
};
const FLOOR_TINT: Record<FloorFinish, string> = { wood: '#f3e7d8', carpet: '#e6e9ee', concrete: '#f1f1f1', tile: '#ffffff', plain: '#e9ecf0' };
const FLOOR_FALLBACK: Record<FloorFinish, string> = { wood: '#cdb393', carpet: '#9aa3ae', concrete: '#c4c6c8', tile: '#e2e4e6', plain: '#e9ecf0' };

// ---------- texturas de piso (compartilhadas; descartadas ao sair) ----------
const texLoader = new TextureLoader();
const texCache = new Map<string, Promise<Texture>>();
function useFloorTexture(url: string | null): Texture | null {
  const [tex, setTex] = useState<Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let p = texCache.get(url);
    if (!p) {
      p = texLoader.loadAsync(url).then((t) => {
        t.colorSpace = SRGBColorSpace;
        t.wrapS = t.wrapT = RepeatWrapping;
        t.anisotropy = 4;
        return t;
      });
      texCache.set(url, p);
    }
    p.then((t) => alive && setTex(t), () => alive && setTex(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return tex;
}

function RoomFloor({ o, wt, onPointer, hovered, selected }: { o: SceneObject; wt: Transform; onPointer: Handlers; hovered: boolean; selected: boolean }) {
  const r = o.room!;
  const base = useFloorTexture(FLOOR_TEXTURE[r.floor]);
  const map = useMemo(() => {
    if (!base) return null;
    const t = base.clone();
    t.repeat.set(r.w / 1.6, r.d / 1.6);
    t.needsUpdate = true;
    return t;
  }, [base, r.w, r.d]);
  useEffect(() => () => map?.dispose(), [map]);
  return (
    <group position={[wt.x, 0, wt.z]} rotation={[0, wt.rotY, 0]} {...onPointer}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} receiveShadow>
        <planeGeometry args={[r.w, r.d]} />
        <meshStandardMaterial key={map ? 'tex' : 'flat'} map={map} color={map ? FLOOR_TINT[r.floor] : FLOOR_FALLBACK[r.floor]} roughness={0.9} />
      </mesh>
      {(hovered || selected) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} raycast={() => null}>
          <planeGeometry args={[r.w, r.d]} />
          <meshBasicMaterial color={BLUE} transparent opacity={selected ? 0.14 : 0.07} depthWrite={false} />
          <Edges color={BLUE} />
        </mesh>
      )}
    </group>
  );
}

// ---------- paredes, portas e janelas ----------
const WALL_COLOR = '#f5f6f8';
const CAP_COLOR = '#5b626d';

interface Segment {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function wallSegments(length: number, height: number, openings: SceneObject[]): Segment[] {
  const half = length / 2;
  const holes = openings
    .map((o) => ({ a: Math.max(-half, o.t.x - o.opening!.width / 2), b: Math.min(half, o.t.x + o.opening!.width / 2), y0: Math.max(0, o.t.y), y1: Math.min(height, o.t.y + o.opening!.height) }))
    .filter((h) => h.b > h.a)
    .sort((p, q) => p.a - q.a);
  const segs: Segment[] = [];
  let cursor = -half;
  for (const h of holes) {
    if (h.a > cursor) segs.push({ x0: cursor, x1: h.a, y0: 0, y1: height });
    if (h.y0 > 0.001) segs.push({ x0: h.a, x1: h.b, y0: 0, y1: h.y0 });
    if (h.y1 < height - 0.001) segs.push({ x0: h.a, x1: h.b, y0: h.y1, y1: height });
    cursor = Math.max(cursor, h.b);
  }
  if (cursor < half) segs.push({ x0: cursor, x1: half, y0: 0, y1: height });
  return segs.filter((s) => s.x1 - s.x0 > 0.001 && s.y1 - s.y0 > 0.001);
}

function Opening({ o, thickness, handlers, highlight }: { o: SceneObject; thickness: number; handlers: Handlers; highlight: string | null }) {
  const p = o.opening!;
  const glass = p.style !== 'door';
  return (
    <group position={[o.t.x, o.t.y + p.height / 2, 0]} {...handlers}>
      {p.style === 'window' ? (
        <mesh>
          <boxGeometry args={[p.width, p.height, 0.02]} />
          <meshStandardMaterial color="#bcd7ef" transparent opacity={0.35} roughness={0.05} metalness={0.1} side={DoubleSide} depthWrite={false} />
        </mesh>
      ) : (
        <mesh position={[0, -0.01, 0]}>
          <boxGeometry args={[p.width - 0.06, p.height - 0.02, 0.04]} />
          <meshStandardMaterial color={glass ? '#bcd7ef' : '#c8a57a'} transparent={glass} opacity={glass ? 0.35 : 1} roughness={glass ? 0.05 : 0.6} depthWrite={!glass} />
        </mesh>
      )}
      {/* batente */}
      <mesh position={[0, p.height / 2 - 0.02, 0]}>
        <boxGeometry args={[p.width, 0.04, thickness + 0.01]} />
        <meshStandardMaterial color={CAP_COLOR} roughness={0.5} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (p.width / 2 - 0.02), 0, 0]}>
          <boxGeometry args={[0.04, p.height, thickness + 0.01]} />
          <meshStandardMaterial color={CAP_COLOR} roughness={0.5} />
        </mesh>
      ))}
      {highlight && (
        <mesh raycast={() => null}>
          <boxGeometry args={[p.width + 0.04, p.height + 0.04, thickness + 0.06]} />
          <meshBasicMaterial color={highlight} transparent opacity={0.12} depthWrite={false} />
          <Edges color={highlight} />
        </mesh>
      )}
    </group>
  );
}

function Wall({ o, wt, openings, plan, handlers, openingHandlers, highlight, openingHighlight }: {
  o: SceneObject; wt: Transform; openings: SceneObject[]; plan: boolean; handlers: Handlers; openingHandlers: (id: string) => Handlers; highlight: string | null; openingHighlight: (id: string) => string | null;
}) {
  const w = o.wall!;
  const group = useRef<Group>(null);
  const scaleY = useRef(1);
  const lowered = useRef(false);
  // Anti z-fighting: cada parede ganha uma folga fixa (derivada do ID) de poucos milímetros na espessura e na altura.
  // Nos cantos as pontas se sobrepõem (fecham sem fresta) e, sem a folga, as faces de duas paredes ficam no MESMO plano e
  // disputam o pixel — pisca ao afastar o zoom, onde a precisão de profundidade cai.
  const jitter = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < o.id.length; i++) h = Math.imul(h ^ o.id.charCodeAt(i), 16777619) >>> 0;
    const r1 = (h % 997) / 997;
    const r2 = ((h >>> 10) % 991) / 991;
    return { thick: 0.004 + r1 * 0.01, high: 0.003 + r2 * 0.009 };
  }, [o.id]);
  // as pontas avançam meia espessura: duas paredes que se encontram num ponto fecham o canto sem fresta
  const segs = useMemo(() => {
    const half = w.length / 2;
    const ext = w.style === 'glass' ? 0 : w.thickness / 2;
    return wallSegments(w.length, w.height, openings).map((s) => ({ ...s, x0: s.x0 <= -half + 1e-6 ? s.x0 - ext : s.x0, x1: s.x1 >= half - 1e-6 ? s.x1 + ext : s.x1 }));
  }, [w.length, w.height, w.thickness, w.style, openings]);
  const glass = w.style === 'glass';
  const tmp = useMemo(() => new Vector3(), []);
  const { invalidate } = useThree();
  // parede entre a câmera e o ambiente baixa para 25 cm (como o FadingWall do FigureBox, adaptado para escritório).
  // Histerese de 30 cm: perto de um canto a câmera cruza o plano de duas paredes e elas não ficam alternando de altura.
  useFrame(({ camera }, dt) => {
    const g = group.current;
    if (!g) return;
    let target = 1;
    if (!plan && !glass) {
      tmp.copy(camera.position);
      const side = (tmp.x - wt.x) * Math.sin(wt.rotY) + (tmp.z - wt.z) * Math.cos(wt.rotY);
      if (!lowered.current && side < -0.3) lowered.current = true;
      else if (lowered.current && side > 0.3) lowered.current = false;
      if (lowered.current) target = 0.25 / w.height;
    } else lowered.current = false;
    const next = MathUtils.damp(scaleY.current, target, 8, dt);
    scaleY.current = Math.abs(next - target) < 0.003 ? target : next;
    g.scale.y = scaleY.current;
    const showOpenings = scaleY.current > 0.9;
    for (const c of g.children) if (c.userData.opening) c.visible = showOpenings;
    if (scaleY.current !== target) invalidate();
  });
  const T = w.thickness;
  return (
    <group position={[wt.x, wt.y, wt.z]} rotation={[0, wt.rotY, 0]} name={`wall:${o.id}`}>
      <group ref={group} {...handlers}>
        {segs.map((s, i) => (
          <group key={i}>
            <mesh position={[(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, 0]} castShadow={!glass} receiveShadow>
              <boxGeometry args={[s.x1 - s.x0, s.y1 - s.y0, T + (glass ? 0 : jitter.thick / 2)]} />
              {glass ? <meshStandardMaterial color="#cfe3f5" transparent opacity={0.28} roughness={0.05} metalness={0.2} depthWrite={false} /> : <meshStandardMaterial color={WALL_COLOR} roughness={0.92} />}
            </mesh>
            {s.y1 >= w.height - 0.001 && (
              // a tampa fica acima do corpo (antes terminava no mesmo plano do topo e piscava em toda parede)
              <mesh position={[(s.x0 + s.x1) / 2, w.height - 0.004 + jitter.high, 0]}>
                <boxGeometry args={[s.x1 - s.x0, 0.016, T + jitter.thick]} />
                <meshStandardMaterial color={glass ? '#8a929d' : CAP_COLOR} roughness={0.6} />
              </mesh>
            )}
          </group>
        ))}
        {glass && (
          <mesh position={[0, 0.02, 0]}>
            <boxGeometry args={[w.length, 0.04, T + 0.01 + jitter.thick]} />
            <meshStandardMaterial color="#8a929d" roughness={0.5} />
          </mesh>
        )}
        {openings.map((op) => (
          <group key={op.id} userData={{ opening: true }}>
            <Opening o={op} thickness={T} handlers={openingHandlers(op.id)} highlight={openingHighlight(op.id)} />
          </group>
        ))}
        {highlight && (
          <mesh position={[0, w.height / 2, 0]} raycast={() => null}>
            <boxGeometry args={[w.length + 0.02, w.height + 0.02, T + 0.04]} />
            <meshBasicMaterial color={highlight} transparent opacity={0.1} depthWrite={false} />
            <Edges color={highlight} />
          </mesh>
        )}
      </group>
    </group>
  );
}

// ---------- objetos com modelo 3D ----------
type Handlers = {
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
  raycast?: () => null;
};

function Model({ asset }: { asset: AssetDefinition }) {
  const load = useAssetScene(asset.url);
  const clone = useMemo(() => (load.state === 'ready' ? load.scene.clone(true) : null), [load]);
  if (clone) return <primitive object={clone} />;
  // substituto visual: caixa com as medidas do asset (carregando = cinza claro; falhou = listrado âmbar)
  const failed = load.state === 'failed';
  const y = asset.pivot === 'wall-back' ? 0 : asset.height / 2;
  const z = asset.pivot === 'wall-back' ? asset.depth / 2 : 0;
  return (
    <mesh position={[0, y, z]} userData={{ fallback: failed }}>
      <boxGeometry args={[Math.max(asset.width, 0.05), Math.max(asset.height, 0.02), Math.max(asset.depth, 0.02)]} />
      <meshStandardMaterial color={failed ? '#f6d58e' : '#d9dde3'} transparent opacity={failed ? 0.85 : 0.6} />
      {failed && <Edges color={WARN} />}
    </mesh>
  );
}

const MissingAsset = ({ size }: { size: { w: number; d: number; h: number } }) => (
  <mesh position={[0, size.h / 2, 0]} userData={{ fallback: true }}>
    <boxGeometry args={[size.w, size.h, size.d]} />
    <meshStandardMaterial color="#f6d58e" transparent opacity={0.85} />
    <Edges color={WARN} />
  </mesh>
);

const AssetObject = memo(function AssetObject({ o, wt, asset, handlers, highlight, ring }: { o: SceneObject; wt: Transform; asset: AssetDefinition | undefined; handlers: Handlers; highlight: string | null; ring: boolean }) {
  const size = asset ? { w: asset.width, d: asset.depth, h: asset.height } : { w: 0.5, d: 0.5, h: 0.5 };
  const wallBack = asset?.pivot === 'wall-back';
  const boxPos: [number, number, number] = wallBack ? [0, 0, size.d / 2] : [0, size.h / 2, 0];
  return (
    <group position={[wt.x, wt.y, wt.z]} rotation={[0, wt.rotY, 0]} name={o.id}>
      <group {...handlers}>{asset ? <Model asset={asset} /> : <MissingAsset size={size} />}</group>
      {highlight && (
        <mesh position={boxPos} raycast={() => null}>
          <boxGeometry args={[size.w + 0.04, size.h + 0.04, size.d + 0.04]} />
          <meshBasicMaterial color={highlight} transparent opacity={0.1} depthWrite={false} />
          <Edges color={highlight} />
        </mesh>
      )}
      {ring && !highlight && !wallBack && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} raycast={() => null}>
          <ringGeometry args={[Math.max(size.w, size.d) * 0.55, Math.max(size.w, size.d) * 0.55 + 0.035, 40]} />
          <meshBasicMaterial color={BLUE} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
});

/** Instâncias repetidas de um mesmo GLB em um único draw call por malha. */
function InstancedAsset({ asset, items, onClick }: { asset: AssetDefinition; items: Array<{ id: string; wt: Transform }>; onClick?: (id: string) => void }) {
  const load = useAssetScene(asset.url);
  const parts = useMemo(() => (load.state === 'ready' ? meshParts(asset.url, load.scene) : []), [load, asset.url]);
  const refs = useRef<Array<InstancedMesh | null>>([]);
  useEffect(() => {
    const m = new Matrix4();
    const obj = new Object3D();
    parts.forEach((part, pi) => {
      const mesh = refs.current[pi];
      if (!mesh) return;
      items.forEach((it, i) => {
        obj.position.set(it.wt.x, it.wt.y, it.wt.z);
        obj.rotation.set(0, it.wt.rotY, 0);
        obj.updateMatrix();
        m.multiplyMatrices(obj.matrix, part.matrix);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [parts, items]);
  // cadeiras giratórias (vida autônoma): só reescreve a matriz das instâncias cujo giro mudou
  const applied = useRef(new Map<string, number>());
  useFrame(() => {
    if (!chairSwivel.size) return;
    const m = new Matrix4();
    const obj = new Object3D();
    let touched = false;
    items.forEach((it, i) => {
      const sw = chairSwivel.get(it.id);
      if (sw === undefined || (applied.current.get(it.id) ?? 0) === sw) return;
      applied.current.set(it.id, sw);
      touched = true;
      obj.position.set(it.wt.x, it.wt.y, it.wt.z);
      obj.rotation.set(0, it.wt.rotY + sw, 0);
      obj.updateMatrix();
      parts.forEach((part, pi) => {
        const mesh = refs.current[pi];
        if (!mesh) return;
        m.multiplyMatrices(obj.matrix, part.matrix);
        mesh.setMatrixAt(i, m);
      });
    });
    if (touched) for (const mesh of refs.current) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  });
  if (load.state !== 'ready') return null;
  return (
    <>
      {parts.map((part, pi) => (
        <instancedMesh
          key={`${pi}-${items.length}`}
          ref={(r) => {
            refs.current[pi] = r;
          }}
          args={[part.geometry, part.material, items.length]}
          castShadow
          receiveShadow
          onClick={(e) => {
            if (e.instanceId === undefined || !onClick) return;
            e.stopPropagation();
            onClick(items[e.instanceId].id);
          }}
        />
      ))}
    </>
  );
}

/** Assento fixo de uma mesa: disco no chão + seta para onde a pessoa olha (frente da mesa). */
function SeatMarker({ x, z, rotY, label }: { x: number; z: number; rotY: number; label: string }) {
  return (
    <group position={[x, 0.025, z]} rotation={[0, rotY, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={25} raycast={() => null}>
        <ringGeometry args={[0.2, 0.27, 40]} />
        <meshBasicMaterial color={BLUE} transparent opacity={0.9} depthTest={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={25} raycast={() => null}>
        <circleGeometry args={[0.2, 40]} />
        <meshBasicMaterial color={BLUE} transparent opacity={0.18} depthTest={false} />
      </mesh>
      {/* seta: frente local da pessoa = +Z */}
      <mesh position={[0, 0, 0.36]} rotation={[Math.PI / 2, 0, 0]} renderOrder={25} raycast={() => null}>
        <coneGeometry args={[0.08, 0.16, 3]} />
        <meshBasicMaterial color={BLUE} depthTest={false} transparent />
      </mesh>
      <Html position={[0, 0.05, -0.35]} center zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
        <span className="drag-label">{label}</span>
      </Html>
    </group>
  );
}

// ---------- câmera ----------
function CameraRig({ view, bounds, focus, controls }: { view: 'iso' | 'plan'; bounds: { cx: number; cz: number; size: number }; focus: FocusRequest | null | undefined; controls: React.RefObject<OrbitControlsImpl> }) {
  const { camera, size } = useThree();
  const goal = useRef<{ target: Vector3; pos: Vector3; zoom?: number } | null>(null);
  const frame = (cx: number, cz: number, radius: number) => {
    const target = new Vector3(cx, 0, cz);
    if (view === 'plan') {
      const zoom = Math.min(size.width, size.height) / (radius * 2.3);
      goal.current = { target, pos: new Vector3(cx, 60, cz + 0.001), zoom };
    } else {
      const d = radius * 2.6;
      goal.current = { target, pos: new Vector3(cx + d * 0.62, d * 0.78, cz + d * 0.78) };
    }
  };
  // enquadramento inicial / troca de vista: imediato
  useEffect(() => {
    frame(bounds.cx, bounds.cz, bounds.size / 2);
    const g = goal.current!;
    camera.position.copy(g.pos);
    if (g.zoom) {
      (camera as unknown as { zoom: number }).zoom = g.zoom;
      camera.updateProjectionMatrix();
    }
    controls.current?.target.copy(g.target);
    controls.current?.update();
    goal.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, bounds.cx, bounds.cz, bounds.size, camera]);
  // foco pedido (sala/objeto): animado
  useEffect(() => {
    if (focus) frame(focus.x, focus.z, Math.max(focus.radius, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);
  useFrame((_, dt) => {
    const g = goal.current;
    const c = controls.current;
    if (!g || !c) return;
    const k = 1 - Math.exp(-dt * 6);
    c.target.lerp(g.target, k);
    camera.position.lerp(g.pos, k);
    if (g.zoom) {
      const cam = camera as unknown as { zoom: number };
      cam.zoom = MathUtils.lerp(cam.zoom, g.zoom, k);
      camera.updateProjectionMatrix();
    }
    c.update();
    if (camera.position.distanceTo(g.pos) < 0.02) goal.current = null;
  });
  return null;
}

/** Contadores do renderizador e FPS em window.__office3d (usados pela medição de desempenho e pelos testes no navegador). */
function PerfProbe() {
  const frames = useRef(0);
  const last = useRef(performance.now());
  useFrame(({ gl }) => {
    frames.current++;
    const now = performance.now();
    if (now - last.current < 1000) return;
    const w = window as unknown as { __office3d?: Record<string, unknown> };
    w.__office3d = {
      ...(w.__office3d ?? {}),
      fps: Math.round((frames.current * 1000) / (now - last.current)),
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      heapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576) : null,
    };
    frames.current = 0;
    last.current = now;
  });
  return null;
}

/**
 * Ganchos de diagnóstico (usados pelos testes no navegador e pela medição): posição de um objeto na tela
 * e quantos substitutos visuais estão na cena (modelo ausente ou com falha de carregamento).
 */
function DiagnosticHooks() {
  const { scene, camera, size } = useThree();
  useEffect(() => {
    const w = window as unknown as { __office3d?: Record<string, unknown> };
    const v = new Vector3();
    w.__office3d = {
      ...(w.__office3d ?? {}),
      screenOf: (id: string) => {
        const o = scene.getObjectByName(id);
        if (!o) return null;
        // centro do topo do objeto (no tampo de uma mesa, por exemplo), sem contar os filhos
        const box = new Box3();
        o.children[0] ? box.setFromObject(o.children[0]) : box.setFromObject(o);
        box.getCenter(v);
        v.y = box.max.y - 0.01;
        v.project(camera);
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
      },
      /** diagnóstico: giro (rad) do objeto no eixo Y */
      rotYOf: (id: string) => chairSwivel.get(id) ?? null,
      worldToScreen: (x: number, y: number, z: number) => {
        v.set(x, y, z).project(camera);
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
      },
      avatars: () => {
        const out: Array<Record<string, unknown>> = [];
        scene.traverse((o) => {
          if (!o.name.startsWith('avatar:')) return;
          const meshes: string[] = [];
          o.traverse((m) => (m as { isMesh?: boolean }).isMesh && m.name && meshes.push(m.name));
          const p = new Vector3();
          o.getWorldPosition(p);
          // ossos principais no mundo (conferir pose: mãos no teclado, cabeça acima do encosto)
          const joints: Record<string, number[]> = {};
          const NAMES: Record<string, string[]> = { head: ['head', 'Head'], hand_l: ['hand_l', 'LeftHand'], hand_r: ['hand_r', 'RightHand'], pelvis: ['pelvis', 'Hips'] }; // MakeHuman | Mixamo (Ara 3D Gen)
          for (const [n, alts] of Object.entries(NAMES)) {
            const b = alts.map((x) => o.getObjectByName(x)).find(Boolean);
            if (b) joints[n] = b.getWorldPosition(new Vector3()).toArray().map((x) => Math.round(x * 100) / 100);
          }
          out.push({ employeeId: o.name.slice(7), x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, visible: o.visible, items: meshes, joints, ...(o.userData.avatar ?? {}) });
        });
        return out;
      },
      fallbacks: () => {
        let n = 0;
        scene.traverse((o) => {
          if (o.userData.fallback) n++;
        });
        return n;
      },
    };
  }, [scene, camera, size]);
  return null;
}

function Disposer() {
  const { gl } = useThree();
  useEffect(
    () => () => {
      disposeAllAssets();
      gl.renderLists.dispose();
    },
    [gl],
  );
  return null;
}

// ---------- cena ----------
/** Modo leve (?leve): sem sombras, sem antialias e dpr 1. Só para testes em renderização por software, onde a cena completa roda a ~1 quadro/s. */
const LEVE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('leve');

export function Scene3D(props: Scene3DProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const bounds = useMemo(() => {
    const rooms = props.doc.objects.filter((o) => o.kind === 'room' && o.room);
    if (!rooms.length) return { cx: 0, cz: 0, size: 12 };
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of rooms) {
      x0 = Math.min(x0, r.t.x - r.room!.w / 2);
      x1 = Math.max(x1, r.t.x + r.room!.w / 2);
      z0 = Math.min(z0, r.t.z - r.room!.d / 2);
      z1 = Math.max(z1, r.t.z + r.room!.d / 2);
    }
    return { cx: Math.round(((x0 + x1) / 2) * 10) / 10, cz: Math.round(((z0 + z1) / 2) * 10) / 10, size: Math.ceil(Math.max(x1 - x0, z1 - z0)) };
    // só reenquadra quando as salas mudam de lugar/tamanho
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(props.doc.objects.filter((o) => o.kind === 'room').map((o) => [o.t.x, o.t.z, o.room?.w, o.room?.d]))]);
  return (
    <Canvas shadows={!LEVE} dpr={LEVE ? 1 : [1, 2]} gl={{ antialias: !LEVE, powerPreference: 'high-performance' }} onPointerMissed={() => props.onMissed?.()} style={{ background: '#eef1f5' }}>
      {props.view === 'plan' ? <OrthographicCamera makeDefault near={0.1} far={400} position={[0, 60, 0.001]} zoom={30} /> : <PerspectiveCamera makeDefault fov={32} near={0.5} far={300} position={[18, 20, 22]} />}
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} enableRotate={props.view !== 'plan' && !props.drawing} maxPolarAngle={Math.PI / 2.15} minDistance={3} maxDistance={80} screenSpacePanning={props.view === 'plan'} />
      <CameraRig view={props.view} bounds={bounds} focus={props.focus} controls={controls} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#ffffff', '#d5dae2', 0.8]} />
      <directionalLight position={[bounds.cx + 12, 22, bounds.cz + 8]} intensity={1.6} castShadow={!LEVE} shadow-mapSize={[2048, 2048]} shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={18} shadow-camera-bottom={-18} shadow-bias={-0.0004} target-position={[bounds.cx, 0, bounds.cz]} />
      <Environment resolution={64}>
        <Lightformer form="rect" intensity={2} position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#dbe6ff" position={[-8, 3, 4]} scale={[6, 4, 1]} />
      </Environment>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[bounds.cx, -0.03, bounds.cz]} receiveShadow raycast={() => null}>
        <planeGeometry args={[bounds.size + 40, bounds.size + 40]} />
        <meshStandardMaterial color="#e2e6ec" roughness={1} />
      </mesh>
      {props.showGrid ? <gridHelper args={[bounds.size + 8, Math.round((bounds.size + 8) / Math.max(props.showGrid, 0.25)), '#c5ccd6', '#d9dee5']} position={[bounds.cx, 0.03, bounds.cz]} raycast={() => null} /> : null}
      <Suspense fallback={null}>
        <SceneObjects {...props} />
      </Suspense>
      {props.seatMarkers?.map((m, i) => <SeatMarker key={i} {...m} />)}
      {props.children}
      <PerfProbe />
      <DiagnosticHooks />
      <Disposer />
    </Canvas>
  );
}

function SceneObjects({ doc, assets, view, selected, hovered, actionable, warnings, interactive, onPointerDownObject, onClickObject, onHover, instancing }: Scene3DProps) {
  const byId = useMemo(() => indexObjects(doc), [doc]);
  const world = useMemo(() => {
    const m = new Map<string, Transform>();
    for (const o of doc.objects) m.set(o.id, worldTransform(byId, o.id));
    return m;
  }, [doc, byId]);
  const openingsByWall = useMemo(() => {
    const m = new Map<string, SceneObject[]>();
    for (const o of doc.objects) if (o.kind === 'opening' && o.parentId) m.set(o.parentId, [...(m.get(o.parentId) ?? []), o]);
    return m;
  }, [doc]);

  const handlersFor = (o: SceneObject): Handlers => {
    if (!interactive(o)) return { raycast: () => null };
    return {
      onPointerDown: (e) => {
        e.stopPropagation();
        onPointerDownObject?.(o.id, e);
      },
      onClick: (e) => {
        e.stopPropagation();
        onClickObject?.(o.id);
      },
      onPointerOver: (e) => {
        e.stopPropagation();
        onHover?.(o.id);
        document.body.style.cursor = 'pointer';
      },
      onPointerOut: () => {
        onHover?.(null);
        document.body.style.cursor = '';
      },
    };
  };
  const highlightOf = (id: string): string | null => (selected.has(id) ? BLUE : hovered === id ? HOVER : warnings?.has(id) ? WARN : null);

  // instanciamento: objetos repetidos (≥ 4) que não são acionáveis nem estão destacados
  const { instanced, instancedIds } = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; wt: Transform }>>();
    const ids = new Set<string>();
    if (instancing) {
      for (const o of doc.objects) {
        if (!o.assetId || !assets[o.assetId] || actionable?.has(o.id) || o.kind === 'room' || o.kind === 'wall' || o.kind === 'opening') continue;
        groups.set(o.assetId, [...(groups.get(o.assetId) ?? []), { id: o.id, wt: world.get(o.id)! }]);
      }
      for (const [k, list] of groups) if (list.length < 4) groups.delete(k);
      for (const list of groups.values()) for (const it of list) ids.add(it.id);
    }
    return { instanced: groups, instancedIds: ids };
  }, [doc, assets, actionable, world, instancing]);

  return (
    <>
      {doc.objects.map((o) => {
        const wt = world.get(o.id)!;
        if (o.kind === 'room')
          return (
            <group key={o.id}>
              <RoomFloor o={o} wt={wt} onPointer={handlersFor(o)} hovered={hovered === o.id} selected={selected.has(o.id)} />
              <Html position={[wt.x, 0.05, wt.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
                <span className="scene-label">{o.name}</span>
              </Html>
            </group>
          );
        if (o.kind === 'wall')
          return (
            <Wall key={o.id} o={o} wt={wt} openings={openingsByWall.get(o.id) ?? []} plan={view === 'plan'} handlers={handlersFor(o)} openingHandlers={(id) => handlersFor(byId.get(id)!)} highlight={highlightOf(o.id)} openingHighlight={highlightOf} />
          );
        if (o.kind === 'opening') return null;
        if (instancedIds.has(o.id) && !selected.has(o.id) && hovered !== o.id) return null;
        return <AssetObject key={o.id} o={o} wt={wt} asset={o.assetId ? assets[o.assetId] : undefined} handlers={handlersFor(o)} highlight={highlightOf(o.id)} ring={!!actionable?.has(o.id)} />;
      })}
      {[...instanced.entries()].map(([assetId, items]) => {
        const visible = items.filter((it) => !selected.has(it.id) && hovered !== it.id);
        return visible.length ? <InstancedAsset key={assetId} asset={assets[assetId]} items={visible} onClick={onClickObject} /> : null;
      })}
    </>
  );
}
