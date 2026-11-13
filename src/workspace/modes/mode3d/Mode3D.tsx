/**
 * Ambiente 3D: o escritório tridimensional original (operação, editor e "Meu avatar" em 3D).
 * Este módulo, e tudo o que ele importa (Three.js, React Three Fiber, modelos), só é carregado quando o 3D está ativo.
 */
import { useEffect } from 'react';
import { AvatarEditor } from '../../../avatar/AvatarEditor';
import { Editor } from '../../../editor/Editor';
import { Operational } from '../../../ops/Operational';
import { engineStarted } from '../../engine';
import type { ModeProps } from '../../types';

export default function Mode3D({ page, officeId, user, opsKey, onEdit, onOfficeChanged, onReady }: ModeProps) {
  useEffect(() => {
    const stop = engineStarted('three');
    onReady();
    return () => {
      stop();
      delete (window as unknown as { __office3d?: unknown }).__office3d;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div data-engine="three" style={{ display: 'contents' }}>
      {page === 'ops' && officeId && <Operational key={`${officeId}-${opsKey}`} officeId={officeId} user={user} onEdit={onEdit} />}
      {page === 'editor' && officeId && <Editor officeId={officeId} user={user} onOfficeChanged={onOfficeChanged} />}
      {page === 'avatar' && <AvatarEditor user={user} />}
    </div>
  );
}
