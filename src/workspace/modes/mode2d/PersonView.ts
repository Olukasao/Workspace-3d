/**
 * Uma pessoa no escritório 2D: sprite em camadas, nome, balão de estado e animação conforme o estado REAL de presença
 * (online, digitando no chat, em atendimento, ausente). Nada aqui inventa estado: vem do servidor.
 */
import Phaser from 'phaser';
import { defaultAvatar2D, isSprite2D, type Avatar2DConfig } from '../../../../shared/avatar2d';
import { TILE, type Dir } from '../../../../shared/office2d';
import type { LiveStatus } from '../../../live';
import { ANIMS, FH, FOOT_Y, ROW, type AnimName } from './art/characters';
import { preloadLpc } from './art/lpc';
import { acquireAvatar, frameName, releaseAvatar } from './textures2d';

export const STATUS_BG: Record<LiveStatus, string> = { online: '#1f9d55', typing: '#2f6fed', in_call: '#c05621', away: '#b7791f', offline: '#6b7280' };
const SEAT_DROP = 10;
/** De costas para a câmera (olhando a mesa), a pessoa senta mais fundo, no assento. */
const SEAT_DROP_BACK = 17;

export interface AnimChoice { name: AnimName; fps: number }
/** Qual animação mostrar: andando; sentado na estação (trabalhando, digitando, atendendo); em pé (parado ou atendendo). */
export function pickAnim(moving: boolean, seated: boolean, status: LiveStatus): AnimChoice {
  if (moving) return { name: 'walk', fps: 9 };
  if (seated) {
    if (status === 'in_call') return { name: 'sittalk', fps: 4 };
    if (status === 'typing') return { name: 'type', fps: 5 };
    if (status === 'away') return { name: 'sit', fps: 1 };
    return { name: 'type', fps: 2 }; // trabalhando no computador
  }
  if (status === 'in_call') return { name: 'talk', fps: 4 };
  return { name: 'idle', fps: 1 };
}

export class PersonView {
  readonly sprite: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private bubble: Phaser.GameObjects.Text;
  x = 0;
  y = 0;
  tx = 0;
  ty = 0;
  dir: Dir = 'down';
  moving = false;
  seated = false;
  status: LiveStatus = 'online';
  speaking: boolean | null = null;
  private texKey = '';
  private cfgSig = '';
  private frame = '';
  private bubbleText = '';
  private dead = false;

  constructor(
    private scene: Phaser.Scene,
    readonly id: string,
    private name: string,
    readonly isMe: boolean,
  ) {
    this.sprite = scene.add.image(0, 0, '__DEFAULT').setOrigin(0.5, FOOT_Y / FH).setVisible(false);
    this.label = scene.add.text(0, 0, name, { fontFamily: 'system-ui, sans-serif', fontSize: '9px', color: '#ffffff', padding: { x: 3, y: 1 } }).setOrigin(0.5, 1).setDepth(100000);
    this.bubble = scene.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '9px', color: '#1c2028', backgroundColor: '#ffffff', padding: { x: 3, y: 1 } }).setOrigin(0.5, 1).setDepth(100001).setVisible(false);
  }

  /** Assinatura da aparência em uso (diagnóstico e testes). */
  get look() {
    return this.cfgSig;
  }

  setName(name: string) {
    if (name !== this.name) {
      this.name = name;
      this.label.setText(name);
    }
  }

  /** Troca a folha de sprites só quando a aparência (ou o headset) muda. */
  setAppearance(raw: unknown, headset: boolean) {
    const cfg: Avatar2DConfig = isSprite2D(raw) ? raw : defaultAvatar2D(this.id);
    const sig = JSON.stringify(cfg) + (headset ? 'h' : 'n');
    if (sig === this.cfgSig) return;
    this.cfgSig = sig;
    const apply = () => {
      if (this.dead || sig !== this.cfgSig) return; // a pessoa saiu ou a aparência mudou de novo enquanto as imagens carregavam
      const old = this.texKey;
      this.texKey = acquireAvatar(this.scene, cfg, headset);
      this.frame = '';
      this.sprite.setTexture(this.texKey).setVisible(true);
      if (old) releaseAvatar(this.scene, old);
    };
    // no estilo LPC as imagens das peças são baixadas sob demanda; sem elas vale o personagem pequeno
    if (cfg.look === 'lpc') void preloadLpc(cfg).then(apply, apply);
    else apply();
  }

  setTarget(x: number, y: number, snap = false) {
    this.tx = x;
    this.ty = y;
    if (snap) [this.x, this.y] = [x, y];
  }

  update(dt: number, t: number, mine: boolean) {
    if (!mine) {
      const k = 1 - Math.exp(-dt * 14); // interpolação suave da pessoa remota
      this.x += (this.tx - this.x) * k;
      this.y += (this.ty - this.y) * k;
      if (Math.hypot(this.tx - this.x, this.ty - this.y) < 0.2) [this.x, this.y] = [this.tx, this.ty];
    }
    const a = pickAnim(this.moving, this.seated, this.status);
    const def = ANIMS[a.name];
    const col = def.start + (def.frames > 1 ? Math.floor(t * a.fps) % def.frames : 0);
    const f = frameName(ROW[this.dir], col);
    if (f !== this.frame && this.texKey) {
      this.frame = f;
      this.sprite.setFrame(f);
    }
    const backToCamera = this.seated && this.dir === 'up';
    const ry = this.y + (this.seated ? (backToCamera ? SEAT_DROP_BACK : SEAT_DROP) : 0);
    this.sprite.setPosition(Math.round(this.x), Math.round(ry));
    this.sprite.setDepth(this.seated ? (Math.floor(this.y / TILE) + 1) * TILE + 1 : this.y);
    this.sprite.setAlpha(this.status === 'away' ? 0.6 : 1);
    this.label.setPosition(Math.round(this.x), Math.round(ry - FOOT_Y + 2));
    this.label.setBackgroundColor(STATUS_BG[this.status]);
    const text = this.status === 'typing' ? '…' : this.status === 'in_call' ? (this.speaking ? 'Em atendimento ···' : 'Em atendimento') : this.status === 'away' ? 'Ausente' : '';
    if (text !== this.bubbleText) {
      this.bubbleText = text;
      this.bubble.setText(text).setVisible(!!text);
    }
    if (text) this.bubble.setPosition(Math.round(this.x), Math.round(ry - FOOT_Y - 8));
  }

  /** Posição na tela (pixels do canvas) para ancorar o cartão da pessoa. */
  hit(wx: number, wy: number) {
    return Math.abs(wx - this.x) < 12 && wy > this.y - 46 && wy < this.y + 6;
  }

  destroy() {
    this.dead = true;
    this.sprite.destroy();
    this.label.destroy();
    this.bubble.destroy();
    if (this.texKey) releaseAvatar(this.scene, this.texKey);
  }
}
