/**
 * Página de diagnóstico (desenvolvimento): monta um avatar com o MESMO código da cena (assets.ts + rig.ts) e
 * renderiza poses para conferência visual de peças e de clipping. Usada por tools/avatars/sheet.mjs.
 * window.renderAvatar({ config, mode, activity, speaking, view, t, zoom }) → data URL PNG.
 */
import { ACESFilmicToneMapping, AmbientLight, BoxGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import type { AvatarConfig } from '../../shared/avatarCatalog';
import { buildAvatar, type BuiltAvatar } from '../three/avatar/assets';
import { AvatarRig, STATION, type PoseState } from '../three/avatar/rig';

const W = 480;
const H = 640;
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color('#eef1f5');
scene.add(new AmbientLight('#ffffff', 0.5), new HemisphereLight('#ffffff', '#cfd5dd', 0.9));
const sun = new DirectionalLight('#ffffff', 2.2);
sun.position.set(2, 4, 3);
sun.castShadow = true;
scene.add(sun);
const floor = new Mesh(new PlaneGeometry(6, 6), new MeshStandardMaterial({ color: '#dfe3e9' }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
// estação simples: mesa à frente (+Z), cadeira, teclado e monitor
const station = new Group();
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: string) => {
  const m = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color: c, roughness: 0.7 }));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  station.add(m);
};
box(1.4, 0.03, 0.7, 0, STATION.deskHeight - 0.015, 0.72, '#c8a57a');
box(0.44, 0.02, 0.15, 0, STATION.deskHeight + 0.01, STATION.keyboardZ + 0.04, '#e6e8eb');
box(0.6, 0.36, 0.03, 0, STATION.deskHeight + 0.22, STATION.monitorZ + 0.1, '#16181c');
box(0.48, 0.06, 0.46, 0, STATION.seatHeight - 0.03, -0.04, '#2b4f8f');
box(0.46, 0.5, 0.05, 0, STATION.seatHeight + 0.3, -0.29, '#2b4f8f');
box(0.05, STATION.seatHeight - 0.06, 0.05, 0, (STATION.seatHeight - 0.06) / 2, -0.04, '#30343a');
const holder = new Group();
scene.add(holder);
holder.add(station);

const camera = new PerspectiveCamera(28, W / H, 0.05, 50);
let current: { key: string; av: BuiltAvatar; rig: AvatarRig } | null = null;

interface Req {
  config: AvatarConfig;
  mode?: PoseState['mode'];
  activity?: PoseState['activity'];
  speaking?: boolean | null;
  view?: 'front' | 'side' | 'back' | 'three' | 'top';
  t?: number;
  zoom?: 'full' | 'upper' | 'head' | 'hands' | 'legs';
  headset?: boolean;
  station?: boolean;
  lod?: 0 | 1;
  /** gira e desloca o conjunto (avatar + mesa) no mundo, como na cena: confere que a pose não depende da orientação */
  worldRotY?: number;
}

async function renderAvatar(req: Req): Promise<{ png: string; missing: string[] }> {
  const key = JSON.stringify(req.config) + (req.lod ?? 0);
  const state: PoseState = { mode: req.mode ?? 'stand', activity: req.activity ?? 'idle', speaking: req.speaking ?? null };
  if (!current || current.key !== key) {
    current?.av.dispose();
    const av = await buildAvatar(req.config, req.lod ?? 0);
    holder.add(av.root);
    current = { key, av, rig: new AvatarRig(av, state) };
  }
  const { av, rig } = current;
  holder.rotation.y = req.worldRotY ?? 0;
  holder.position.set(req.worldRotY ? -6.2 : 0, 0, req.worldRotY ? -2.98 : 0);
  holder.updateMatrixWorld(true);
  station.visible = req.station ?? state.mode === 'sit';
  if (av.headset) av.headset.visible = req.headset ?? state.activity === 'call';
  // várias atualizações para as transições assentarem
  const t = req.t ?? 1.3;
  for (let i = 0; i < 40; i++) rig.update(state, t - (40 - i) * 0.05, 0.05, req.lod ?? 0);
  rig.update(state, t, 0.016, req.lod ?? 0);
  const sitting = state.mode === 'sit';
  const focus = {
    full: new Vector3(0, sitting ? 0.7 : av.height / 2, sitting ? 0.15 : 0),
    upper: new Vector3(0, sitting ? 1.0 : av.height * 0.72, sitting ? 0.15 : 0),
    head: new Vector3(0, av.height - (sitting ? 0.48 : 0.1), sitting ? 0.06 : 0),
    hands: new Vector3(0, STATION.deskHeight + 0.05, STATION.keyboardZ - 0.05),
    legs: new Vector3(0, 0.3, 0.3),
  }[req.zoom ?? 'full'];
  const dist = { full: sitting ? 2.6 : 3.6, upper: 1.7, head: 0.75, hands: 0.9, legs: 2.1 }[req.zoom ?? 'full'];
  const dirs = { front: new Vector3(0, 0.12, 1), side: new Vector3(1, 0.1, 0.02), back: new Vector3(0, 0.15, -1), three: new Vector3(0.75, 0.35, 0.85), top: new Vector3(0.2, 1.6, 0.6) };
  focus.applyMatrix4(holder.matrixWorld);
  camera.position.copy(focus).addScaledVector(dirs[req.view ?? 'front'].normalize().applyAxisAngle(new Vector3(0, 1, 0), req.worldRotY ?? 0), dist);
  camera.lookAt(focus);
  renderer.render(scene, camera);
  return { png: renderer.domElement.toDataURL('image/png'), missing: av.missing };
}

(window as unknown as { renderAvatar: typeof renderAvatar }).renderAvatar = renderAvatar;
(window as unknown as { avatarReady: boolean }).avatarReady = true;
