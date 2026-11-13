/** Mesa, teclado, monitor e cadeira da pré-visualização do "Meu avatar" (medidas de src/three/avatar/rig.ts). */
import { STATION } from '../three/avatar/rig';

export function Station() {
  const c = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => (
    <mesh position={[x, y, z]} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  );
  return (
    <group>
      {c(1.4, 0.03, 0.7, 0, STATION.deskHeight - 0.015, 0.72, '#c8a57a')}
      {c(0.44, 0.02, 0.15, 0, STATION.deskHeight + 0.01, STATION.keyboardZ + 0.04, '#e6e8eb')}
      {c(0.6, 0.36, 0.03, 0, STATION.deskHeight + 0.22, STATION.monitorZ + 0.1, '#16181c')}
      {c(0.48, 0.06, 0.46, 0, STATION.seatHeight - 0.03, -0.04, '#3b4048')}
      {c(0.46, 0.5, 0.05, 0, STATION.seatHeight + 0.3, -0.29, '#3b4048')}
    </group>
  );
}
