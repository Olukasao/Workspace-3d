/**
 * Ambiente 2D: escritório em pixel art com Phaser 3 (operação, editor de layout e "Meu avatar" em 2D).
 * Este módulo, e tudo o que ele importa (Phaser, a arte, os sprites), só é carregado quando o 2D está ativo.
 */
import { useEffect, useState } from 'react';
import { loadOfficePack } from './art/pack';
import { engineStarted } from '../../engine';
import type { ModeProps } from '../../types';
import { AvatarEditor2D } from './AvatarEditor2D';
import { Editor2DView } from './Editor2DView';
import { Office2DView } from './Office2DView';

export default function Mode2D({ page, officeId, user, onReady }: ModeProps) {
  const [packReady, setPackReady] = useState(false);
  useEffect(() => {
    const stop = engineStarted('phaser');
    return stop;
  }, []);
  useEffect(() => {
    let on = true;
    void loadOfficePack().then(() => on && setPackReady(true));
    return () => {
      on = false;
    };
  }, []);
  if (!packReady) return null; // a arte do pacote carrega antes de montar o Phaser (são poucos KB)
  if (page === 'ops') return officeId ? <Office2DView officeId={officeId} user={user} onReady={onReady} /> : null;
  if (page === 'editor') return officeId ? <Editor2DView officeId={officeId} onReady={onReady} /> : null;
  return <AvatarEditor2D user={user} onReady={onReady} />;
}
