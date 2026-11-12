/**
 * Avatares na cena: cada colaborador conectado aparece sentado no assento fixo da sua mesa.
 * - estado ao vivo → pose: online (trabalho), digitando (mãos no teclado), atendimento (headset + balão);
 * - LOD: malhas reduzidas para personagens distantes; animação a cada 3 quadros longe e suspensa fora da câmera;
 * - se o modelo não carregar, aparece um substituto explícito ("avatar indisponível") no lugar.
 */
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Frustum, Matrix4, OrthographicCamera, Sphere, Vector3, type Group } from 'three';
import { defaultAvatar, type AvatarConfig } from '../../../shared/avatarCatalog';
import type { LivePerson } from '../../live';
import { buildAvatar, type BuiltAvatar } from './assets';
import { AvatarRig, type PoseState } from './rig';

export interface Seat {
  x: number;
  z: number;
  rotY: number;
}

const _m = new Matrix4();
const _f = new Frustum();
const _s = new Sphere(new Vector3(), 1.1);
const _w = new Vector3();

export function poseFor(p: Pick<LivePerson, 'status' | 'call'>): PoseState {
  return { mode: 'sit', activity: p.status === 'in_call' ? 'call' : p.status === 'typing' ? 'typing' : 'idle', speaking: p.call?.speaking ?? null };
}

export const Avatar = memo(function Avatar({ person, seat, config: forced, pose: forcedPose, label, fixedLod }: { person?: LivePerson; seat: Seat; config?: AvatarConfig; pose?: PoseState; label?: string; fixedLod?: 0 | 1 }) {
  const config = forced ?? person?.appearance?.config ?? defaultAvatar(person?.employeeId ?? 'demo');
  const key = JSON.stringify(config);
  const pose = forcedPose ?? (person ? poseFor(person) : { mode: 'sit' as const, activity: 'idle' as const, speaking: null });
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const [lodState, setLod] = useState<0 | 1>(fixedLod ?? 1);
  const lod = fixedLod ?? lodState;
  const [built, setBuilt] = useState<{ av: BuiltAvatar; rig: AvatarRig; key: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const group = useRef<Group>(null);
  const balloon = useRef<HTMLSpanElement>(null);
  const frame = useRef(0);
  const seed = useMemo(() => Math.random() * 100, []);

  useEffect(() => {
    let alive = true;
    buildAvatar(config, lod).then(
      (av) => {
        if (!alive) return av.dispose();
        setFailed(null);
        setBuilt((prev) => {
          prev?.av.dispose();
          return { av, rig: new AvatarRig(av, poseRef.current), key };
        });
      },
      (e: Error) => alive && setFailed(e.message || 'falha ao carregar'),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, lod]);
  useEffect(() => () => setBuilt((prev) => (prev?.av.dispose(), null)), []);

  useFrame(({ camera, clock }, dt) => {
    const g = group.current;
    if (!g || !built) return;
    // fora da câmera: não desenha nem anima
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _f.setFromProjectionMatrix(_m);
    g.getWorldPosition(_w);
    _s.center.copy(_w).setY(_w.y + 0.8);
    const visible = _f.intersectsSphere(_s);
    g.visible = visible;
    if (!visible) return;
    // nível de detalhe com histerese (perspectiva: distância; planta: zoom)
    const ortho = (camera as OrthographicCamera).isOrthographicCamera;
    const near = ortho ? (camera as OrthographicCamera).zoom > 70 : camera.position.distanceTo(_w) < 8;
    const far = ortho ? (camera as OrthographicCamera).zoom < 55 : camera.position.distanceTo(_w) > 10;
    if (fixedLod === undefined) {
      if (lod === 1 && near) setLod(0);
      else if (lod === 0 && far) setLod(1);
    }
    const p = poseRef.current;
    if (built.av.headset) built.av.headset.visible = p.activity === 'call' || config.headsetAlways;
    // diagnóstico (testes no navegador): o que este avatar está mostrando
    g.userData.avatar = { activity: p.activity, speaking: p.speaking, headset: !!built.av.headset?.visible, lod, appearance: built.key, missing: built.av.missing };
    frame.current++;
    const step = lod === 1 ? 3 : 1;
    if (frame.current % step !== 0) return;
    const t = clock.elapsedTime;
    built.rig.update(p, t, Math.min(0.1, dt * step), lod);
    if (balloon.current) {
      const talking = p.speaking === true || (p.speaking === null && Math.sin(t * 0.9 + seed) > -0.2);
      balloon.current.textContent = talking ? '•••' : 'Em atendimento';
    }
  });

  const headY = (built?.av.height ?? 1.7) - 0.48 + 0.42;
  return (
    <group ref={group} position={[seat.x, 0, seat.z]} rotation={[0, seat.rotY, 0]} name={person ? `avatar:${person.employeeId}` : 'avatar'}>
      {built && <primitive object={built.av.root} />}
      {failed && <FallbackAvatar label={label ?? person?.name ?? ''} reason={failed} />}
      {pose.activity === 'call' && (built || failed) && (
        <Html position={[0, headY, 0.05]} center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
          <span ref={balloon} className="speech-balloon">Em atendimento</span>
        </Html>
      )}
    </group>
  );
});

/** Substituto explícito quando o modelo do avatar não carrega (arquivo ausente, rede, etc.). */
function FallbackAvatar({ label, reason }: { label: string; reason: string }) {
  return (
    <group userData={{ fallback: true }}>
      <mesh position={[0, 0.78, -0.02]} userData={{ fallback: true }}>
        <capsuleGeometry args={[0.18, 0.5, 6, 12]} />
        <meshStandardMaterial color="#c7ccd4" transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 1.28, 0]}>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial color="#c7ccd4" transparent opacity={0.85} />
      </mesh>
      <Html position={[0, 1.55, 0]} center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
        <span className="drag-label" title={reason}>{label ? `${label} · ` : ''}avatar indisponível</span>
      </Html>
    </group>
  );
}

/** Camada de avatares: pessoas conectadas com mesa → avatar no assento fixo; sem mesa → só no diretório. */
export function OfficeAvatars({ people, seats }: { people: Record<string, LivePerson>; seats: Record<string, Seat> }) {
  return (
    <>
      {Object.values(people)
        .filter((p) => p.status !== 'offline' && seats[p.employeeId])
        .map((p) => (
          <Avatar key={p.employeeId} person={p} seat={seats[p.employeeId]} />
        ))}
    </>
  );
}
