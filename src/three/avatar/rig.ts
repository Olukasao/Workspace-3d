/**
 * Poses e animação procedurais do avatar (rig game_engine do MPFB2), em cima de IK de dois ossos:
 *  - sentado: quadril apoiado no assento, pés no chão à frente (IK das pernas), mãos no teclado/mouse (IK dos braços);
 *  - online: trabalho com pequenos movimentos (respiração, mouse, olhar para a tela);
 *  - digitando: mãos no teclado com digitação evidente (pulsos e dedos);
 *  - atendimento: postura mais ereta, headset, gesto e fala (visemas) — balão é desenhado pelo componente;
 *  - em pé (preview): braços ao longo do corpo.
 * Cada quadro parte da pose de repouso e aplica tudo com pesos suavizados: as transições são contínuas.
 * Tudo é calculado no espaço do avatar (frente = +Z, cima = +Y), então não depende dos eixos locais dos ossos.
 */
import { MathUtils, Quaternion, Vector3, type Bone, type Object3D } from 'three';
import { setMorph, type BuiltAvatar } from './assets';

export type AvatarActivity = 'idle' | 'typing' | 'call';
export interface PoseState {
  mode: 'stand' | 'sit';
  activity: AvatarActivity;
  /** true/false = indicador autorizado de fala; null = sem indicador (animação ilustrativa durante a chamada) */
  speaking: boolean | null;
}

/** Medidas da estação (metros, espaço do avatar, chão = 0). */
export const STATION = { seatHeight: 0.48, deskHeight: 0.75, keyboardZ: 0.36, monitorZ: 0.78, monitorY: 1.02 };

const v = () => new Vector3();
const _a = v(), _b = v(), _c = v(), _d = v(), _e = v(), _t = v(), _p = v(), _ax = v(), _tmp = v();
const _q = new Quaternion(), _pq = new Quaternion(), _inv = new Quaternion(), _bq = new Quaternion();

function rotateWorld(bone: Object3D, axisWorld: Vector3, angle: number) {
  if (!angle || !bone.parent) return;
  bone.parent.getWorldQuaternion(_pq);
  _q.setFromAxisAngle(axisWorld, angle);
  _inv.copy(_pq).invert();
  bone.quaternion.premultiply(_inv.multiply(_q).multiply(_pq));
  bone.updateMatrixWorld(true);
}

/** Gira o osso para que o vetor osso→`childWorld` passe a apontar para `targetWorld`. */
function aim(bone: Object3D, childWorld: Vector3, targetWorld: Vector3, weight = 1) {
  if (!bone.parent) return;
  bone.getWorldPosition(_a);
  _b.copy(childWorld).sub(_a).normalize();
  _c.copy(targetWorld).sub(_a).normalize();
  if (_b.lengthSq() < 1e-8 || _c.lengthSq() < 1e-8) return;
  _q.setFromUnitVectors(_b, _c);
  if (weight < 1) _q.slerp(_bq.identity(), 1 - weight);
  bone.parent.getWorldQuaternion(_pq);
  _inv.copy(_pq).invert();
  bone.quaternion.premultiply(_inv.multiply(_q).multiply(_pq));
  bone.updateMatrixWorld(true);
}

interface Chain {
  a: Bone;
  b: Bone;
  c: Bone;
  lab: number;
  lbc: number;
  side: number;
}

export class AvatarRig {
  private rest = new Map<Bone, { q: Quaternion; p: Vector3 }>();
  private w = { sit: 0, typing: 0, call: 0, talk: 0 };
  private chains: { armL?: Chain; armR?: Chain; legL?: Chain; legR?: Chain } = {};
  private restLocal: Record<string, Vector3> = {};
  private seed: number;

  constructor(
    private av: BuiltAvatar,
    initial: PoseState,
  ) {
    for (const b of Object.values(av.bones)) this.rest.set(b, { q: b.quaternion.clone(), p: b.position.clone() });
    av.root.updateMatrixWorld(true);
    const local = (name: string) => {
      const bone = av.bones[name];
      if (!bone) return null;
      const p = bone.getWorldPosition(v());
      return av.root.worldToLocal(p);
    };
    for (const n of ['pelvis', 'head', 'neck_01', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'upperarm_l', 'upperarm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r']) {
      const p = local(n);
      if (p) this.restLocal[n] = p;
    }
    const chain = (a: string, b: string, c: string): Chain | undefined => {
      const A = av.bones[a], B = av.bones[b], C = av.bones[c];
      if (!A || !B || !C) return undefined;
      const pa = A.getWorldPosition(v()), pb = B.getWorldPosition(v()), pc = C.getWorldPosition(v());
      return { a: A, b: B, c: C, lab: pa.distanceTo(pb), lbc: pb.distanceTo(pc), side: Math.sign(av.root.worldToLocal(pa.clone()).x) || 1 };
    };
    this.chains = { armL: chain('upperarm_l', 'lowerarm_l', 'hand_l'), armR: chain('upperarm_r', 'lowerarm_r', 'hand_r'), legL: chain('thigh_l', 'calf_l', 'foot_l'), legR: chain('thigh_r', 'calf_r', 'foot_r') };
    this.seed = Math.random() * 100;
    // nasce já na pose certa (sem transição ao aparecer)
    this.w.sit = initial.mode === 'sit' ? 1 : 0;
    this.w.typing = initial.activity === 'typing' ? 1 : 0;
    this.w.call = initial.activity === 'call' ? 1 : 0;
  }

  private local(p: Vector3, out: Vector3) {
    return this.av.root.localToWorld(out.copy(p));
  }

  private dir(x: number, y: number, z: number, out: Vector3) {
    return out.set(x, y, z).transformDirection(this.av.root.matrixWorld);
  }

  /** IK de dois ossos: põe a ponta `c` em `target` (mundo), com o joelho/cotovelo para o lado de `pole` (mundo). */
  private solve(ch: Chain, target: Vector3, pole: Vector3) {
    ch.a.getWorldPosition(_a);
    const reach = ch.lab + ch.lbc;
    _t.copy(target).sub(_a);
    const dist = MathUtils.clamp(_t.length(), Math.abs(ch.lab - ch.lbc) + 1e-3, reach - 1e-3);
    _t.normalize();
    const cosA = MathUtils.clamp((ch.lab * ch.lab + dist * dist - ch.lbc * ch.lbc) / (2 * ch.lab * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _p.copy(pole).sub(_a);
    _p.addScaledVector(_t, -_p.dot(_t)).normalize();
    _e.copy(_a).addScaledVector(_t, cosA * ch.lab).addScaledVector(_p, sinA * ch.lab); // posição do cotovelo/joelho
    ch.b.getWorldPosition(_b);
    aim(ch.a, _b, _e);
    ch.c.getWorldPosition(_c);
    _d.copy(_a).addScaledVector(_t, dist);
    aim(ch.b, _c, _d);
  }

  /** Mão alinhada para a frente e com a palma para baixo (teclado/mesa). */
  private orientHand(side: 'l' | 'r', pitch: number) {
    const B = this.av.bones;
    const hand = B[`hand_${side}`], mid = B[`middle_01_${side}`], idx = B[`index_01_${side}`], pnk = B[`pinky_01_${side}`];
    if (!hand || !mid) return;
    hand.getWorldPosition(_a);
    mid.getWorldPosition(_b);
    this.dir(0, -pitch, 1, _c).normalize();
    _d.copy(_a).addScaledVector(_c, _b.distanceTo(_a));
    aim(hand, _b, _d);
    if (!idx || !pnk) return;
    // giro em torno do eixo da mão: indicador para dentro, mínimo para fora (palma para baixo)
    hand.getWorldPosition(_a);
    mid.getWorldPosition(_b);
    _ax.copy(_b).sub(_a).normalize();
    idx.getWorldPosition(_c);
    pnk.getWorldPosition(_d);
    _tmp.copy(_c).sub(_d);
    _tmp.addScaledVector(_ax, -_tmp.dot(_ax)).normalize();
    const inward = this.dir(side === 'l' ? -1 : 1, 0, 0, _e).normalize();
    inward.addScaledVector(_ax, -inward.dot(_ax)).normalize();
    let ang = Math.acos(MathUtils.clamp(_tmp.dot(inward), -1, 1));
    if (_p.crossVectors(_tmp, inward).dot(_ax) < 0) ang = -ang;
    rotateWorld(hand, _ax, ang);
  }

  /** Curva os dedos em direção à palma (`amount` em radianos por falange). */
  private curl(side: 'l' | 'r', amounts: number[]) {
    const B = this.av.bones;
    const idx = B[`index_01_${side}`], pnk = B[`pinky_01_${side}`];
    if (!idx || !pnk) return;
    idx.getWorldPosition(_a);
    pnk.getWorldPosition(_b);
    _ax.copy(_a).sub(_b).normalize();
    const down = this.dir(0, -1, 0, _e);
    ['index', 'middle', 'ring', 'pinky'].forEach((f, i) => {
      for (let k = 1; k <= 3; k++) {
        const bone = B[`${f}_0${k}_${side}`];
        const child = B[`${f}_0${k + 1}_${side}`];
        if (!bone) continue;
        bone.getWorldPosition(_c);
        if (child) child.getWorldPosition(_d);
        else _d.copy(_c).addScaledVector(this.dir(0, 0, 1, _tmp), 0.02);
        const tip = _d.sub(_c).normalize();
        const s = Math.sign(_p.crossVectors(_ax, tip).dot(down)) || 1;
        rotateWorld(bone, _ax, s * amounts[i] * (k === 1 ? 0.7 : 1));
      }
    });
  }

  update(state: PoseState, t: number, dt: number, detail: 0 | 1) {
    const av = this.av;
    const B = av.bones;
    const k = 1 - Math.exp(-dt * 5);
    const talkingNow = state.activity === 'call' && (state.speaking === true || (state.speaking === null && Math.sin(t * 0.9 + this.seed) > -0.2));
    this.w.sit += ((state.mode === 'sit' ? 1 : 0) - this.w.sit) * k;
    this.w.typing += ((state.activity === 'typing' ? 1 : 0) - this.w.typing) * k;
    this.w.call += ((state.activity === 'call' ? 1 : 0) - this.w.call) * k;
    this.w.talk += ((talkingNow ? 1 : 0) - this.w.talk) * (1 - Math.exp(-dt * 10));
    const { sit, typing, call, talk } = this.w;
    const idle = Math.max(0, 1 - typing - call);

    // 1) pose de repouso
    for (const [bone, r] of this.rest) {
      bone.quaternion.copy(r.q);
      bone.position.copy(r.p);
    }
    av.root.updateMatrixWorld(true);
    const R = this.restLocal;
    const right = this.dir(1, 0, 0, v()).normalize(); // eixo lateral do avatar (inclinar para frente = ângulo positivo)

    // 2) quadril: desce até o assento e recua um pouco (sentado)
    const pelvis = B.pelvis;
    if (pelvis && R.pelvis && pelvis.parent) {
      const target = _tmp.set(R.pelvis.x, MathUtils.lerp(R.pelvis.y, STATION.seatHeight + 0.09, sit), MathUtils.lerp(R.pelvis.z, -0.05, sit));
      const world = this.local(target, v());
      pelvis.parent.updateMatrixWorld(true);
      pelvis.position.copy(pelvis.parent.worldToLocal(world));
      pelvis.updateMatrixWorld(true);
    }

    // 3) pernas: pés apoiados no chão à frente do assento
    for (const [ch, s] of [[this.chains.legL, 'l'], [this.chains.legR, 'r']] as const) {
      if (!ch) continue;
      const foot = R[`foot_${s}`];
      if (!foot) continue;
      const ankle = this.local(_tmp.set(MathUtils.lerp(foot.x, ch.side * 0.12, sit), foot.y, MathUtils.lerp(foot.z, 0.42, sit)), v());
      const pole = this.local(_tmp.set(ch.side * 0.08, 0.6, 2.0), v());
      if (sit > 0.02) this.solve(ch, ankle, pole);
      // pé plano, apontando para a frente (mesma relação tornozelo→ponta do repouso)
      const ball = B[`ball_${s}`];
      const footBone = B[`foot_${s}`];
      if (ball && footBone && R[`ball_${s}`]) {
        footBone.getWorldPosition(_a);
        const rel = _tmp.copy(R[`ball_${s}`]).sub(foot);
        const want = this.dir(rel.x, rel.y, rel.z, v()).add(_a);
        ball.getWorldPosition(_b);
        aim(footBone, _b.clone(), want, sit);
      }
    }

    // 4) tronco: respiração, inclinação conforme a atividade
    const breathe = Math.sin(t * 1.7 + this.seed) * 0.012;
    const lean = sit * (0.06 * idle + 0.12 * typing - 0.05 * call);
    if (B.spine_01) rotateWorld(B.spine_01, right, lean * 0.5);
    if (B.spine_02) rotateWorld(B.spine_02, right, lean * 0.3 + breathe);
    if (B.spine_03) rotateWorld(B.spine_03, right, lean * 0.2);

    // 5) cabeça: olha para a tela (sentado); fala balança levemente
    const head = B.head;
    if (head) {
      head.getWorldPosition(_a);
      const headLocal = av.root.worldToLocal(_a.clone());
      const pitch = Math.atan2(headLocal.y - STATION.monitorY, STATION.monitorZ - headLocal.z) * sit * (1 - 0.6 * call);
      const nod = detail === 0 ? talk * Math.sin(t * 7.3 + this.seed) * 0.05 + Math.sin(t * 0.5 + this.seed) * 0.02 : 0;
      if (B.neck_01) rotateWorld(B.neck_01, right, pitch * 0.4);
      rotateWorld(head, right, pitch * 0.6 + nod);
      if (detail === 0) rotateWorld(head, this.dir(0, 1, 0, v()), Math.sin(t * 0.31 + this.seed) * 0.06 * idle + talk * Math.sin(t * 1.9) * 0.08);
    }

    // 6) braços: em pé ao longo do corpo; sentado nas mãos no teclado/mouse; gesto durante a fala
    // punho ~4 cm acima do topo do teclado (desk + 0,02): com os dedos curvados, as pontas tocam as teclas sem atravessar
    const desk = STATION.deskHeight + 0.06;
    const typePulse = (ph: number) => (detail === 0 ? Math.max(0, Math.sin(t * 13 + ph)) * 0.012 : 0);
    const mouseDrift = Math.sin(t * 0.7 + this.seed) * 0.03;
    for (const [ch, s] of [[this.chains.armL, 'l'], [this.chains.armR, 'r']] as const) {
      if (!ch) continue;
      const hip = R[`thigh_${s}`] ?? R.pelvis;
      const standPos = _a.set(ch.side * 0.2, (hip?.y ?? 0.9) - 0.12, 0.03);
      // sentado: esquerda no teclado, direita no mouse (online); ambas no teclado (digitando)
      const idleSit = s === 'l' ? _b.set(ch.side * 0.13, desk, STATION.keyboardZ) : _b.set(ch.side * 0.27 + mouseDrift * 0.4, desk, STATION.keyboardZ + 0.02 + mouseDrift * 0.3);
      const typeSit = _c.set(ch.side * 0.12, desk + typePulse(s === 'l' ? 0 : 1.7), STATION.keyboardZ + 0.01);
      const gesture = s === 'l' ? _d.set(ch.side * 0.22, desk + 0.16 + talk * Math.sin(t * 2.3) * 0.05, STATION.keyboardZ - 0.08) : _d.copy(idleSit);
      const sitPos = _e.copy(idleSit).multiplyScalar(idle).addScaledVector(typeSit, typing).addScaledVector(gesture, call);
      const target = this.local(_t.copy(standPos).lerp(sitPos, sit), v());
      const pole = this.local(_p.set(ch.side * 0.7, 0.3 + sit * 0.4, -0.6), v());
      this.solve(ch, target, pole);
      if (sit > 0.05) this.orientHand(s, 0.12 + 0.1 * typing);
      if (detail === 0) {
        const base = 0.22 * sit + 0.08;
        const a = typing > 0.05 ? [0, 1, 2, 3].map((i) => base + typing * 0.28 * Math.max(0, Math.sin(t * 14 + i * 1.3 + (s === 'l' ? 0 : 2)))) : [base, base + 0.04, base + 0.08, base + 0.12];
        this.curl(s, a);
      }
    }

    // 7) boca: visemas enquanto fala (só perto da câmera)
    if (detail === 0) {
      const amp = talk * (0.55 + 0.45 * Math.sin(t * 3.1 + this.seed));
      setMorph(av, 'viseme_aa_ah_ax_01', amp * Math.max(0, Math.sin(t * 11.0)) * 0.8);
      setMorph(av, 'viseme_ao_03', amp * Math.max(0, Math.sin(t * 7.3 + 1.1)) * 0.6);
      setMorph(av, 'viseme_y_iy_ih_ix_06', amp * Math.max(0, Math.sin(t * 9.1 + 2.3)) * 0.5);
    }
  }
}
