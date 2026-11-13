/**
 * Hospeda um jogo Phaser dentro do React: cria ao montar e DESTRÓI ao desmontar (loop, texturas, entrada e canvas saem).
 * O React não participa do loop visual: só desenha os painéis ao redor.
 */
import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import { registerPhaserCounter } from '../../engine';
import { phaserGames } from './registry';

registerPhaserCounter(() => phaserGames.size);

export function createGame(parent: HTMLElement, scene: Phaser.Scene): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#20242b',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE, width: Math.max(320, parent.clientWidth), height: Math.max(240, parent.clientHeight) },
    scene,
    input: { keyboard: { capture: [] }, mouse: { preventDefaultWheel: true }, touch: true },
    audio: { noAudio: true },
    fps: { target: 60, smoothStep: true },
    banner: false,
    disableContextMenu: true,
  });
  phaserGames.add(game);
  return game;
}

export function PhaserHost({ make, onGame, className }: { make: (parent: HTMLElement) => Phaser.Game; onGame?: (g: Phaser.Game | null) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const game = make(ref.current!);
    onGame?.(game);
    return () => {
      onGame?.(null);
      phaserGames.delete(game);
      game.destroy(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} className={className} data-engine="phaser" />;
}
