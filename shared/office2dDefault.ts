/** Escritório 2D inicial (usado até o administrador publicar o próprio): recepção, reunião, atendimento com 12 estações e copa. */
import { type Layout2D, type Obj2D } from './office2d';

export function defaultLayout2D(): Layout2D {
  const cols = 44;
  const rows = 30;
  const floor = new Array<number>(cols * rows).fill(0);
  const walls = new Array<number>(cols * rows).fill(0);
  const objects: Obj2D[] = [];
  const stations: Layout2D['stations'] = [];
  let n = 0;
  const fill = (x1: number, y1: number, x2: number, y2: number, id: number) => {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) floor[y * cols + x] = id;
  };
  const wallH = (y: number, x1: number, x2: number, gaps: number[] = []) => {
    for (let x = x1; x <= x2; x++) if (!gaps.includes(x)) walls[y * cols + x] = 1;
  };
  const wallV = (x: number, y1: number, y2: number, gaps: number[] = []) => {
    for (let y = y1; y <= y2; y++) if (!gaps.includes(y)) walls[y * cols + x] = 1;
  };
  const put = (asset: string, x: number, y: number, rot: 0 | 1 | 2 | 3 = 0) => {
    const id = `o${++n}`;
    objects.push({ id, asset, x, y, rot });
    return id;
  };

  // prédio: x 2..41, y 2..27
  fill(2, 2, 41, 27, 6);
  fill(3, 3, 15, 11, 3); // reunião
  fill(3, 13, 15, 26, 7); // recepção
  fill(17, 3, 41, 16, 2); // atendimento
  fill(17, 18, 41, 26, 1); // copa e descanso
  wallH(2, 2, 41);
  wallH(27, 2, 41);
  wallV(2, 2, 27);
  wallV(41, 2, 27);
  wallV(16, 2, 27, [7, 8, 21, 22]);
  wallH(12, 2, 16, [8, 9]);
  wallH(17, 16, 41, [22, 23, 35, 36]);

  // atendimento: 2 fileiras de 6 mesas, cadeira à frente de cada uma
  const stationList: string[] = [];
  for (const y of [5, 10]) {
    for (let k = 0; k < 6; k++) {
      const x = 19 + k * 4;
      const desk = put('desk_pc', x, y);
      put('chair', x, y + 1, 2);
      const sid = `st${stationList.length + 1}`;
      stations.push({ id: sid, objectId: desk });
      stationList.push(sid);
    }
  }
  put('plant', 18, 3);
  put('plant', 40, 3);
  put('printer', 40, 15);
  put('cabinet', 38, 15);
  put('whiteboard', 30, 3);

  // reunião
  put('meeting_table', 6, 6);
  for (const x of [6, 7, 8, 9]) put('chair', x, 5, 0);
  for (const x of [6, 7, 8, 9]) put('chair', x, 8, 2);
  put('whiteboard', 10, 3);
  put('tv', 4, 3);
  put('plant', 14, 4);

  // recepção
  put('reception_desk', 5, 16);
  put('sofa', 11, 15, 0);
  put('sofa', 11, 24, 0);
  put('plant_big', 14, 14);
  put('plant', 4, 14);
  put('rug', 7, 21);
  put('bookshelf', 12, 13);
  put('painting', 8, 13);

  // copa e descanso
  put('coffee', 19, 19);
  put('cooler', 21, 19);
  put('round_table', 24, 21);
  put('round_table', 29, 21);
  put('chair', 23, 21, 3);
  put('chair', 26, 21, 1);
  put('chair', 28, 21, 3);
  put('chair', 31, 21, 1);
  put('rug', 33, 22);
  put('sofa', 34, 19, 0);
  put('sofa', 34, 25, 3);
  put('armchair', 38, 21, 1);
  put('armchair', 38, 23, 1);
  put('plant_big', 40, 19);
  put('plant', 18, 25);
  put('server_rack', 40, 25);

  return {
    v: 1, cols, rows, floor, walls, objects, stations,
    rooms: [
      { id: 'sala_reuniao', name: 'Sala de reunião', x: 3, y: 3, w: 13, h: 9 },
      { id: 'recepcao', name: 'Recepção', x: 3, y: 13, w: 13, h: 14 },
      { id: 'atendimento', name: 'Atendimento', x: 17, y: 3, w: 25, h: 14 },
      { id: 'copa', name: 'Copa e descanso', x: 17, y: 18, w: 25, h: 9 },
    ],
    spawns: [{ id: 'entrada_1', x: 9, y: 24 }, { id: 'entrada_2', x: 10, y: 24 }, { id: 'entrada_3', x: 8, y: 24 }],
  };
}
