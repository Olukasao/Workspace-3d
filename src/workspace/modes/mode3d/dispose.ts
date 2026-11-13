/** Descarrega tudo o que é exclusivo do modo 3D (modelos, texturas, materiais, ganchos de diagnóstico). Rodado ao sair do 3D. */
import { disposeAllAssets } from '../../../three/assetCache';
import { disposeAraAssets } from '../../../three/avatar/ara';
import { disposeAvatarAssets } from '../../../three/avatar/assets';

export function disposeThreeWorld() {
  disposeAllAssets();
  disposeAvatarAssets();
  disposeAraAssets();
  delete (window as unknown as { __office3d?: unknown }).__office3d;
}
