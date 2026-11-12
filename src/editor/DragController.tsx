/**
 * Arraste no editor (dentro do Canvas). Adaptado de FigureBox Planner (RoomFurniture.tsx: Item.down/move/end):
 * plano de arraste na altura do ponto agarrado, câmera travada durante o arraste, pouso sobre o tampo de móveis
 * e etiqueta de altura (HeightHint). Aqui em metros, com hierarquia: o que está sobre a mesa vai junto com ela.
 */
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { descendants, indexObjects, snapTo, toLocal, worldTransform } from '../../shared/scene';
import type { AssetDefinition, SceneObject, Transform } from '../../shared/types';
import { expandGroups, findSupport, isLocked, topLevel } from './ops';
import { useEditor } from './store';

export type DragStart = (id: string, e: ThreeEvent<PointerEvent>) => void;

interface DragState {
  primary: string;
  movers: string[];
  starts: Map<string, Transform>;
  plane: Plane;
  startHit: Vector3;
  mode: 'floor' | 'wall';
  wall?: { id: string; wt: Transform; length: number; height: number };
  surfaceItem: boolean;
  exclude: Set<string>;
  moved: boolean;
  pointerId: number;
  downAt: { x: number; y: number };
}

export function DragController({ assets, snap, register }: { assets: Record<string, AssetDefinition>; snap: number; register: (fn: DragStart) => void }) {
  const { camera, gl, controls } = useThree();
  const drag = useRef<DragState | null>(null);
  const [label, setLabel] = useState<{ pos: [number, number, number]; text: string } | null>(null);
  const ray = useRef(new Raycaster());

  useEffect(() => {
    register((id, e) => {
      if (e.button !== 0) return;
      const st = useEditor.getState();
      if (!st.doc) return;
      const objects = st.doc.objects;
      const byId = indexObjects(st.doc);
      const o = byId.get(id);
      if (!o) return;
      // seleção: Shift soma/retira; grupo seleciona todos os membros
      const additive = e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
      let sel = st.selected;
      if (additive) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
      else if (!sel.includes(id)) sel = [id];
      sel = expandGroups(objects, sel);
      st.select(sel);
      // sala só arrasta se já estava selecionada (clicar no piso não move a sala por acidente)
      if (additive || isLocked(objects, id) || (o.kind === 'room' && !st.selected.includes(id))) return;

      const parent = o.parentId ? byId.get(o.parentId) : undefined;
      const movers = topLevel(objects, sel.includes(id) ? sel : [id]).filter((m) => !isLocked(objects, m));
      if (!movers.length) return;
      const primary = movers.includes(id) ? id : movers[0];
      const starts = new Map(movers.map((m) => [m, worldTransform(byId, m)]));
      const exclude = new Set<string>();
      for (const m of movers) {
        exclude.add(m);
        for (const d of descendants(st.doc, m)) exclude.add(d.id);
      }
      const asset = o.assetId ? assets[o.assetId] : undefined;
      let plane: Plane;
      let mode: DragState['mode'] = 'floor';
      let wall: DragState['wall'];
      if ((o.kind === 'opening' || asset?.mount === 'wall') && parent?.kind === 'wall' && parent.wall) {
        const pw = worldTransform(byId, parent.id);
        const normal = new Vector3(Math.sin(pw.rotY), 0, Math.cos(pw.rotY));
        plane = new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3(pw.x, 0, pw.z));
        mode = 'wall';
        wall = { id: parent.id, wt: pw, length: parent.wall.length, height: parent.wall.height };
        // vão/objeto de parede só se move sozinho, ao longo da parede
        movers.splice(0, movers.length, o.id);
      } else {
        plane = new Plane(new Vector3(0, 1, 0), -Math.max(0, e.point.y));
      }
      const hit = new Vector3();
      if (!e.ray.intersectPlane(plane, hit)) return;
      drag.current = { primary: mode === 'wall' ? o.id : primary, movers, starts, plane, startHit: hit, mode, wall, surfaceItem: asset?.mount === 'surface', exclude, moved: false, pointerId: e.pointerId, downAt: { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } };
      if (mode === 'wall') drag.current.starts = new Map([[o.id, { ...o.t }]]);
      st.beginTransient();
      if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
      document.body.style.cursor = 'grabbing';
    });
  }, [register, assets, controls]);

  useEffect(() => {
    const ndc = new Vector2();
    const hitAt = (ev: PointerEvent): Vector3 | null => {
      const d = drag.current;
      if (!d) return null;
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.current.setFromCamera(ndc, camera);
      const p = new Vector3();
      return ray.current.ray.intersectPlane(d.plane, p);
    };

    const compute = (ev: PointerEvent): { objects: SceneObject[]; reparent?: { id: string; parentId: string | null; t: Transform } } | null => {
      const d = drag.current;
      const st = useEditor.getState();
      const base = st.transientBase;
      if (!d || !base) return null;
      const hit = hitAt(ev);
      if (!hit) return null;
      const byId = indexObjects({ schema: 1, units: 'm', floorId: '', objects: base });
      if (d.mode === 'wall' && d.wall) {
        const o = byId.get(d.primary)!;
        const w = d.wall;
        const local = toLocal({ x: hit.x, y: hit.y, z: hit.z, rotY: 0 }, w.wt);
        const width = o.opening?.width ?? (o.assetId ? assets[o.assetId]?.width ?? 0.5 : 0.5);
        const height = o.opening?.height ?? (o.assetId ? assets[o.assetId]?.height ?? 0.5 : 0.5);
        const s0 = d.starts.get(o.id)!;
        const dx = local.x - toLocal({ x: d.startHit.x, y: d.startHit.y, z: d.startHit.z, rotY: 0 }, w.wt).x;
        const dy = hit.y - d.startHit.y;
        const half = w.length / 2 - width / 2;
        const x = Math.max(-half, Math.min(half, snapTo(s0.x + dx, snap || 0.05)));
        const yMin = o.kind === 'opening' ? 0 : height / 2;
        const yMax = o.kind === 'opening' ? Math.max(0, w.height - height) : w.height - height / 2;
        const y = o.kind === 'opening' && o.opening?.style !== 'window' ? 0 : Math.max(yMin, Math.min(yMax, snapTo(s0.y + dy, snap || 0.05)));
        setLabel({ pos: [hit.x, hit.y + 0.4, hit.z], text: `${x.toFixed(2).replace('.', ',')} m na parede · ${y.toFixed(2).replace('.', ',')} m de altura` });
        return { objects: base.map((b) => (b.id === o.id ? { ...b, t: { ...b.t, x, y } } : b)) };
      }
      const p0 = d.starts.get(d.primary)!;
      let nx = p0.x + (hit.x - d.startHit.x);
      let nz = p0.z + (hit.z - d.startHit.z);
      if (snap) {
        nx = snapTo(nx, snap);
        nz = snapTo(nz, snap);
      }
      const dx = nx - p0.x;
      const dz = nz - p0.z;
      let reparent: { id: string; parentId: string | null; t: Transform } | undefined;
      let text = '';
      const objects = base.map((b) => {
        const s = d.starts.get(b.id);
        if (!s) return b;
        const world: Transform = { ...s, x: s.x + dx, z: s.z + dz };
        if (b.id === d.primary && d.surfaceItem) {
          // item de superfície: pousa no tampo mais alto sob ele (ou no piso)
          const sup = findSupport(base, assets, world.x, world.z, d.exclude);
          const supName = sup ? byId.get(sup.id)?.name : null;
          if (sup) {
            const pw = worldTransform(byId, sup.id);
            const local = toLocal({ ...world, y: sup.top }, pw);
            reparent = { id: b.id, parentId: sup.id, t: { x: round(local.x), y: round(sup.top - pw.y), z: round(local.z), rotY: local.rotY } };
            text = `${sup.top.toFixed(2).replace('.', ',')} m do chão · sobre ${supName}`;
            return { ...b, parentId: sup.id, t: reparent.t };
          }
          const local = { ...world, y: 0 };
          reparent = { id: b.id, parentId: null, t: { x: round(local.x), y: 0, z: round(local.z), rotY: local.rotY } };
          text = 'no piso';
          return { ...b, parentId: null, t: reparent.t };
        }
        const parent = b.parentId ? worldTransform(byId, b.parentId) : null;
        const local = toLocal(world, parent);
        if (b.id === d.primary) text = `${world.x.toFixed(2).replace('.', ',')}; ${world.z.toFixed(2).replace('.', ',')} m · ${world.y.toFixed(2).replace('.', ',')} m do chão`;
        return { ...b, t: { ...b.t, x: round(local.x), z: round(local.z) } };
      });
      const primary = d.starts.get(d.primary)!;
      setLabel({ pos: [primary.x + dx, (reparent ? reparent.t.y : primary.y) + 0.9, primary.z + dz], text });
      return { objects, reparent };
    };

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      if (!d.moved && Math.hypot(ev.clientX - d.downAt.x, ev.clientY - d.downAt.y) < 4) return;
      d.moved = true;
      const out = compute(ev);
      if (out) useEditor.getState().setTransient(out.objects);
    };
    const onUp = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      drag.current = null;
      if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
      document.body.style.cursor = '';
      setLabel(null);
      const st = useEditor.getState();
      if (!d.moved) {
        st.cancelTransient();
        return;
      }
      st.commitTransient();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && drag.current) {
        drag.current = null;
        if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
        setLabel(null);
        useEditor.getState().cancelTransient();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [camera, gl, controls, assets, snap]);

  return label ? (
    <Html position={label.pos} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <span className="drag-label">{label.text}</span>
    </Html>
  ) : null;
}

const round = (v: number) => Math.round(v * 1000) / 1000 || 0;
