/**
 * Ferramentas de desenho livre da estrutura (dentro do Canvas):
 *  - piso: arrastar um retângulo no chão;
 *  - parede: clicar ponto a ponto (encaixe em grade, 45° e pontas existentes); Enter, Esc ou duplo clique termina;
 *  - porta / janela / porta de vidro: clicar no ponto da parede;
 *  - puxadores nas pontas da parede selecionada (ferramenta de seleção).
 * A cena não reage a cliques nos objetos enquanto uma ferramenta de desenho está ativa: os raios são calculados aqui.
 */
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plane, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import { indexObjects, toLocal, worldTransform } from '../../shared/scene';
import type { FloorFinish, OpeningStyle, Transform } from '../../shared/types';
import { BLUE } from '../three/Scene3D';
import { toast } from '../ui';
import { addFloor, addOpeningAt, addWallSegment, fitOpening, isLocked, OPENING_PRESET, setWallEndpoints, snapDrawPoint, snapTargets, wallEndpoints, type Pt, type WallStyleOptions } from './ops';
import { useEditor } from './store';

export type Tool = 'select' | 'floor' | 'wall' | OpeningStyle;

export interface DrawOptions {
  floor: FloorFinish;
  withWalls: boolean;
  wall: WallStyleOptions;
  grid: number;
}

type Preview =
  | { kind: 'rect'; p: Pt; q: Pt }
  | { kind: 'seg'; a: Pt | null; b: Pt; snapped: string }
  | { kind: 'opening'; wt: Transform; x: number; y: number; w: number; h: number; T: number; ok: boolean }
  | null;

const fmt = (v: number) => v.toFixed(2).replace('.', ',');
const ground = new Plane(new Vector3(0, 1, 0), 0);

function useRay() {
  const gl = useThree((s) => s.gl);
  // lê câmera e cena na hora (a câmera muda ao trocar planta ↔ 3D)
  const get = useThree((s) => s.get);
  const ray = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const set = (ev: { clientX: number; clientY: number }) => {
    const { camera } = get();
    const r = gl.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray;
  };
  const groundAt = (ev: { clientX: number; clientY: number }): Pt | null => {
    const hit = new Vector3();
    return set(ev).ray.intersectPlane(ground, hit) ? { x: hit.x, z: hit.z } : null;
  };
  /** Parede sob o cursor (os grupos de parede se chamam "wall:<id>"). */
  const wallAt = (ev: { clientX: number; clientY: number }): { id: string; point: Vector3 } | null => {
    const hits = set(ev).intersectObjects(get().scene.children, true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o) {
        if (o.name.startsWith('wall:')) return { id: o.name.slice(5), point: h.point };
        o = o.parent;
      }
    }
    return null;
  };
  return { gl, groundAt, wallAt };
}

export function DrawController({ tool, options, onToolDone }: { tool: Tool; options: DrawOptions; onToolDone: () => void }) {
  const { gl, groundAt, wallAt } = useRay();
  const [preview, setPreview] = useState<Preview>(null);
  const chain = useRef<{ start: Pt | null; first: Pt | null; count: number }>({ start: null, first: null, count: 0 });
  const rect = useRef<{ p: Pt; pointerId: number } | null>(null);
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    chain.current = { start: null, first: null, count: 0 };
    rect.current = null;
    setPreview(null);
    if (tool === 'select') return;
    const el = gl.domElement;
    const objects = () => useEditor.getState().doc?.objects ?? [];
    const floorId = () => useEditor.getState().doc?.floorId ?? '';
    const snap = (raw: Pt, from: Pt | null, alt: boolean) => snapDrawPoint(raw, { grid: optsRef.current.grid, targets: snapTargets(objects()), from, angleSnap: !alt });

    const finishChain = () => {
      const c = chain.current;
      chain.current = { start: null, first: null, count: 0 };
      setPreview(null);
      if (c.count) toast(`${c.count} parede(s) desenhada(s). Ctrl+Z desfaz uma por vez.`);
    };

    const openingPreview = (ev: PointerEvent) => {
      const hit = wallAt(ev);
      const objs = objects();
      const wall = hit ? objs.find((o) => o.id === hit.id) : undefined;
      if (!hit || !wall?.wall) return setPreview(null);
      const wt = worldTransform(indexObjects({ schema: 1, units: 'm', floorId: '', objects: objs }), wall.id);
      const local = toLocal({ x: hit.point.x, y: 0, z: hit.point.z, rotY: 0 }, wt);
      const p = OPENING_PRESET[tool as OpeningStyle];
      const x = fitOpening(objs, wall.id, p.width, Math.round(local.x / 0.05) * 0.05);
      setPreview({ kind: 'opening', wt, x: x ?? local.x, y: p.sill, w: p.width, h: p.height, T: wall.wall.thickness, ok: x !== null });
      return { wallId: wall.id, x };
    };

    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      if (tool === 'floor') {
        const p = groundAt(ev);
        if (!p) return;
        const s = snap(p, null, ev.altKey).p;
        rect.current = { p: s, pointerId: ev.pointerId };
        setPreview({ kind: 'rect', p: s, q: s });
      }
    };
    const onMove = (ev: PointerEvent) => {
      if (tool === 'floor') {
        const p = groundAt(ev);
        if (!p) return;
        const s = snap(p, null, ev.altKey).p;
        setPreview(rect.current ? { kind: 'rect', p: rect.current.p, q: s } : { kind: 'seg', a: null, b: s, snapped: '' });
      } else if (tool === 'wall') {
        const p = groundAt(ev);
        if (!p) return;
        const s = snap(p, chain.current.start, ev.altKey);
        setPreview({ kind: 'seg', a: chain.current.start, b: s.p, snapped: s.snapped });
      } else {
        openingPreview(ev);
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      const st = useEditor.getState();
      if (tool === 'floor') {
        const r = rect.current;
        rect.current = null;
        setPreview(null);
        const p = groundAt(ev);
        if (!r || !p) return;
        const q = snap(p, null, ev.altKey).p;
        const out = st.doc && addFloor(st.doc.objects, floorId(), r.p, q, optsRef.current.floor, optsRef.current.withWalls, optsRef.current.wall);
        if (!out) return toast('Arraste para desenhar um piso de pelo menos 0,5 × 0,5 m.');
        st.apply(() => out[0], [out[1]]);
        toast(`${optsRef.current.withWalls ? 'Sala' : 'Piso'} de ${fmt(Math.abs(q.x - r.p.x))} × ${fmt(Math.abs(q.z - r.p.z))} m criado.`);
      } else if (tool === 'wall') {
        const p = groundAt(ev);
        if (!p) return;
        const c = chain.current;
        const s = snap(p, c.start, ev.altKey).p;
        if (!c.start) {
          chain.current = { start: s, first: s, count: 0 };
          return;
        }
        const out = st.doc && addWallSegment(st.doc.objects, floorId(), c.start, s, optsRef.current.wall);
        if (!out) return; // mesmo ponto: ignora (duplo clique)
        st.apply(() => out[0], [out[1]]);
        c.count++;
        // fechou o contorno no ponto inicial: termina
        if (c.first && Math.hypot(s.x - c.first.x, s.z - c.first.z) < 1e-6) return finishChain();
        c.start = s;
      } else {
        const target = openingPreview(ev);
        if (!target || target.x === null) return toast('Não há espaço livre para o vão nesse ponto da parede.');
        const out = st.doc && addOpeningAt(st.doc.objects, floorId(), target.wallId, tool as OpeningStyle, target.x);
        if (!out) return toast('Não há espaço livre para o vão nesse ponto da parede.');
        st.apply(() => out[0], [out[1]]);
      }
    };
    const onDbl = () => tool === 'wall' && finishChain();
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (ev.key === 'Enter' && tool === 'wall') {
        ev.preventDefault();
        finishChain();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        if (tool === 'wall' && chain.current.start) finishChain();
        else if (rect.current) {
          rect.current = null;
          setPreview(null);
        } else onToolDone();
      }
    };
    const onLeave = () => !rect.current && !chain.current.start && setPreview(null);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey, true);
    el.style.cursor = 'crosshair';
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey, true);
      el.style.cursor = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, gl]);

  return <PreviewMesh preview={preview} wallHeight={options.wall.height} />;
}

const previewMat = <meshBasicMaterial color={BLUE} transparent opacity={0.28} depthWrite={false} depthTest={false} />;

function PreviewMesh({ preview, wallHeight }: { preview: Preview; wallHeight: number }) {
  if (!preview) return null;
  if (preview.kind === 'rect') {
    const w = Math.abs(preview.q.x - preview.p.x);
    const d = Math.abs(preview.q.z - preview.p.z);
    const cx = (preview.p.x + preview.q.x) / 2;
    const cz = (preview.p.z + preview.q.z) / 2;
    return (
      <group>
        <mesh position={[cx, 0.03, cz]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={30} raycast={() => null}>
          <planeGeometry args={[Math.max(w, 0.01), Math.max(d, 0.01)]} />
          {previewMat}
        </mesh>
        <Marker p={preview.p} />
        <Marker p={preview.q} />
        <Html position={[cx, 0.05, cz]} center style={{ pointerEvents: 'none' }} zIndexRange={[25, 0]}>
          <span className="drag-label">{fmt(w)} × {fmt(d)} m · {fmt(w * d)} m²</span>
        </Html>
      </group>
    );
  }
  if (preview.kind === 'seg') {
    const { a, b } = preview;
    if (!a) {
      return (
        <group>
          <Marker p={b} />
          <Html position={[b.x, 0.05, b.z]} style={{ pointerEvents: 'none', transform: 'translate(12px, 8px)' }} zIndexRange={[25, 0]}>
            <span className="drag-label">{fmt(b.x)}; {fmt(b.z)}</span>
          </Html>
        </group>
      );
    }
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ang = Math.atan2(-(b.z - a.z), b.x - a.x);
    const deg = Math.round(((((Math.atan2(-(b.z - a.z), b.x - a.x) * 180) / Math.PI) % 360) + 360) % 360);
    return (
      <group>
        <mesh position={[(a.x + b.x) / 2, wallHeight / 2, (a.z + b.z) / 2]} rotation={[0, ang, 0]} renderOrder={30} raycast={() => null}>
          <boxGeometry args={[Math.max(len, 0.01), wallHeight, 0.12]} />
          {previewMat}
        </mesh>
        <Marker p={a} />
        <Marker p={b} highlight={preview.snapped === 'point'} />
        <Html position={[(a.x + b.x) / 2, wallHeight + 0.2, (a.z + b.z) / 2]} center style={{ pointerEvents: 'none' }} zIndexRange={[25, 0]}>
          <span className="drag-label">{fmt(len)} m · {deg}°{preview.snapped === 'point' ? ' · encaixado' : ''}</span>
        </Html>
      </group>
    );
  }
  const { wt, x, y, w, h, T, ok } = preview;
  return (
    <group position={[wt.x, wt.y, wt.z]} rotation={[0, wt.rotY, 0]}>
      <mesh position={[x, y + h / 2, 0]} renderOrder={30} raycast={() => null}>
        <boxGeometry args={[w, h, T + 0.08]} />
        <meshBasicMaterial color={ok ? BLUE : '#c53030'} transparent opacity={0.35} depthWrite={false} depthTest={false} />
      </mesh>
      <Html position={[x, y + h + 0.15, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[25, 0]}>
        <span className="drag-label">{ok ? `${fmt(w)} m de largura · clique para inserir` : 'sem espaço livre aqui'}</span>
      </Html>
    </group>
  );
}

function Marker({ p, highlight }: { p: Pt; highlight?: boolean }) {
  return (
    <mesh position={[p.x, 0.04, p.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={31} raycast={() => null}>
      <ringGeometry args={[0.07, highlight ? 0.16 : 0.12, 24]} />
      <meshBasicMaterial color={highlight ? '#1f9d55' : BLUE} depthTest={false} transparent />
    </mesh>
  );
}

/** Puxadores nas pontas da parede selecionada: arrastar estica, encurta ou gira a parede (a outra ponta fica parada). */
export function WallHandles({ wallId, grid }: { wallId: string; grid: number }) {
  const doc = useEditor((s) => s.doc);
  const { gl, groundAt } = useRay();
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const [label, setLabel] = useState<{ p: Pt; text: string } | null>(null);
  const drag = useRef<{ end: 'a' | 'b'; fixed: Pt; pointerId: number } | null>(null);
  const ends = doc ? wallEndpoints(doc.objects, wallId) : null;
  const locked = doc ? isLocked(doc.objects, wallId) : true;

  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      const st = useEditor.getState();
      if (!d || ev.pointerId !== d.pointerId || !st.transientBase) return;
      const raw = groundAt(ev);
      if (!raw) return;
      const base = st.transientBase;
      const targets = snapTargets(base.filter((o) => o.id !== wallId));
      const s = snapDrawPoint(raw, { grid, targets, from: d.fixed, angleSnap: !ev.altKey }).p;
      const [a, b] = d.end === 'a' ? [s, d.fixed] : [d.fixed, s];
      st.setTransient(setWallEndpoints(base, wallId, a, b, d.end === 'a' ? 'b' : 'a'));
      setLabel({ p: s, text: `${fmt(Math.hypot(s.x - d.fixed.x, s.z - d.fixed.z))} m` });
    };
    const onUp = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      drag.current = null;
      if (controls) controls.enabled = true;
      setLabel(null);
      useEditor.getState().commitTransient();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [wallId, grid, controls, groundAt, gl]);

  if (!ends || locked) return null;
  const start = (end: 'a' | 'b') => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { end, fixed: end === 'a' ? ends.b : ends.a, pointerId: e.pointerId };
    useEditor.getState().beginTransient();
    if (controls) controls.enabled = false;
  };
  // o puxador fica ACIMA do topo da parede (o topo recebe o clique primeiro) e é ligado ao chão por uma haste fina
  const top = (doc?.objects.find((o) => o.id === wallId)?.wall?.height ?? 2.7) + 0.3;
  return (
    <group>
      {(['a', 'b'] as const).map((end) => (
        <group key={end}>
          <mesh position={[ends[end].x, top / 2, ends[end].z]} renderOrder={39} raycast={() => null}>
            <cylinderGeometry args={[0.012, 0.012, top, 6]} />
            <meshBasicMaterial color={BLUE} transparent opacity={0.7} depthTest={false} />
          </mesh>
          <mesh position={[ends[end].x, top, ends[end].z]} renderOrder={40} onPointerDown={start(end)} onPointerOver={() => (document.body.style.cursor = 'grab')} onPointerOut={() => (document.body.style.cursor = '')} name={`handle:${end}`}>
            <sphereGeometry args={[0.16, 20, 14]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent />
            <mesh scale={0.7} renderOrder={41}>
              <sphereGeometry args={[0.16, 20, 14]} />
              <meshBasicMaterial color={BLUE} depthTest={false} transparent />
            </mesh>
          </mesh>
        </group>
      ))}
      {label && (
        <Html position={[label.p.x, 0.3, label.p.z]} center style={{ pointerEvents: 'none' }} zIndexRange={[25, 0]}>
          <span className="drag-label">{label.text}</span>
        </Html>
      )}
    </group>
  );
}
