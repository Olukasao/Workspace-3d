/** Descarrega tudo o que é exclusivo do modo 2D (jogos Phaser que sobraram). Rodado ao sair do 2D. */
import { phaserGames } from './registry';

export function disposePhaserWorld() {
  for (const g of [...phaserGames]) {
    g.destroy(true);
    phaserGames.delete(g);
  }
}
