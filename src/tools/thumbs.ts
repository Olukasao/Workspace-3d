/**
 * Página de apoio (só em desenvolvimento): renderiza a miniatura de um asset do catálogo.
 * tools/assets/thumbs.mjs abre esta página no navegador, chama window.renderThumb(url, debug) e grava a imagem.
 * No modo debug desenha a grade do piso e uma seta azul apontando para +Z (a frente esperada do modelo).
 */
import { ACESFilmicToneMapping, AmbientLight, ArrowHelper, Box3, Color, DirectionalLight, GridHelper, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const W = 320;
const H = 240;
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.setSize(W, H);
renderer.setPixelRatio(2);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const loader = new GLTFLoader();

async function renderThumb(url: string, debug = false): Promise<string> {
  const gltf = await loader.loadAsync(url);
  const scene = new Scene();
  scene.background = debug ? new Color('#ffffff') : null;
  scene.add(new AmbientLight('#ffffff', 0.9), new HemisphereLight('#ffffff', '#c9ced6', 0.9));
  const key = new DirectionalLight('#ffffff', 2.2);
  key.position.set(3, 6, 5);
  scene.add(key);
  scene.add(gltf.scene);
  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.length() / 2, 0.05);
  if (debug) {
    const cells = Math.max(2, Math.ceil(radius * 4));
    scene.add(new GridHelper(cells, cells * 4, '#9aa3af', '#dfe3e8'));
    scene.add(new ArrowHelper(new Vector3(0, 0, 1), new Vector3(0, 0.005, 0), radius * 1.6, '#2563eb', radius * 0.3, radius * 0.18));
    scene.add(new ArrowHelper(new Vector3(1, 0, 0), new Vector3(0, 0.005, 0), radius * 1.2, '#dc2626', radius * 0.2, radius * 0.12));
  }
  const camera = new PerspectiveCamera(30, W / H, 0.01, 200);
  const dist = (radius / Math.sin((15 * Math.PI) / 180)) * 1.02;
  // vista de frente-direita, de cima: a frente (+Z) do modelo fica voltada para o observador
  const dir = new Vector3(0.62, 0.55, 1).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);
  renderer.render(scene, camera);
  const data = renderer.domElement.toDataURL('image/png');
  scene.remove(gltf.scene);
  gltf.scene.traverse((o) => {
    const m = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } | Array<{ dispose(): void }> };
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) mat.dispose();
  });
  return data;
}

(window as unknown as { renderThumb: typeof renderThumb }).renderThumb = renderThumb;
