import type { LiveStatus } from '../../../live';

/** Quem está no mapa, agrupado como o cartão da pessoa: disponível, em atendimento, ausente. */
export function teamOf(ids: string[], people: Record<string, { name: string; status: LiveStatus }>) {
  const groups = { free: [] as string[], call: [] as string[], away: [] as string[] };
  for (const id of ids) {
    const p = people[id];
    if (!p || p.status === 'offline') continue;
    (p.status === 'in_call' ? groups.call : p.status === 'away' ? groups.away : groups.free).push(p.name);
  }
  for (const g of Object.values(groups)) g.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return groups;
}
