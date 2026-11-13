/**
 * Admin → Configurações → Mesas e cadeiras (2D): para cada pessoa, a mesa de trabalho e a cadeira dela.
 * A cadeira é a da própria mesa. Quando a pessoa entra no escritório 2D (Workspace aberto), vai até ela; ao entrar em atendimento,
 * vai direto para o computador e senta. Cadeiras soltas (reunião, copa) não têm dono: qualquer um pode usar.
 * Cada escolha é gravada na hora (os vínculos não dependem de publicar o layout).
 */
import { useEffect, useMemo, useState } from 'react';
import { ASSET_BY_ID, seatOfObject, type Layout2D } from '../../shared/office2d';
import { api, errorText } from '../api';
import { toast } from '../ui';

interface Person { id: string; name: string }
interface Draft { layout: Layout2D; seats: Array<{ stationId: string; employeeId: string }> }

export function DeskAssignments({ officeId }: { officeId: string | null }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!officeId) return;
    let dead = false;
    Promise.all([api.get<{ employees: Person[] }>('/api/directory'), api.get<Draft>(`/api/admin/office2d/${officeId}/draft`)]).then(
      ([d, o]) => {
        if (dead) return;
        setPeople(d.employees);
        setDraft(o);
      },
      (e) => !dead && setErr(errorText(e)),
    );
    return () => {
      dead = true;
    };
  }, [officeId]);

  // mesas do layout, com sala e posição da cadeira, para escolher sem ver o mapa
  const stations = useMemo(() => {
    if (!draft) return [];
    const l = draft.layout;
    return l.stations
      .map((st, i) => {
        const obj = l.objects.find((o) => o.id === st.objectId);
        const seat = obj && seatOfObject(obj);
        if (!obj || !seat) return null;
        const room = l.rooms.find((r) => seat.cx >= r.x && seat.cx < r.x + r.w && seat.cy >= r.y && seat.cy < r.y + r.h);
        return { id: st.id, label: `Mesa ${i + 1}${room ? ` · ${room.name}` : ''} (coluna ${seat.cx}, linha ${seat.cy})`, asset: ASSET_BY_ID.get(obj.asset)?.name ?? obj.asset };
      })
      .filter((x): x is { id: string; label: string; asset: string } => !!x);
  }, [draft]);

  const owner = (stationId: string) => draft?.seats.find((s) => s.stationId === stationId)?.employeeId;
  const stationOf = (employeeId: string) => draft?.seats.find((s) => s.employeeId === employeeId)?.stationId ?? '';
  const nameOf = (id?: string) => people.find((p) => p.id === id)?.name;

  const assign = async (employeeId: string, stationId: string) => {
    if (!officeId) return;
    const before = stationOf(employeeId);
    setBusy(true);
    try {
      // escolher uma mesa solta a pessoa de outra; "sem mesa" libera a atual
      const r = stationId ? await api.put<{ seats: Draft['seats'] }>(`/api/admin/office2d/${officeId}/seats/${stationId}`, { employeeId }) : await api.put<{ seats: Draft['seats'] }>(`/api/admin/office2d/${officeId}/seats/${before}`, { employeeId: null });
      setDraft((d) => (d ? { ...d, seats: r.seats } : d));
      toast(stationId ? 'Mesa e cadeira vinculadas.' : 'Mesa liberada.');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!officeId) return null;
  return (
    <section className="card" data-testid="desk-assignments-card" aria-labelledby="mesas-h">
      <h3 id="mesas-h">Mesas e cadeiras (2D)</h3>
      <p className="muted">
        Escolha a mesa de cada pessoa; a cadeira é a da mesa. No escritório 2D ela vai até a mesa ao entrar e, quando entra em atendimento, vai direto para o computador e
        senta. Quem não está com o Workspace aberto não aparece no mapa. Cadeiras soltas (reunião, copa) são livres para todos.
      </p>
      {err && <div className="notice bad">{err}</div>}
      {!draft && !err && <div className="muted">Carregando…</div>}
      {draft && (
        <>
          <p className="muted" data-testid="desk-summary">{draft.seats.length} de {stations.length} mesas com dono.</p>
          <table className="table">
            <thead><tr><th>Pessoa</th><th>Mesa e cadeira</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} data-testid={`desk-row-${p.id}`}>
                  <td>{p.name}</td>
                  <td>
                    <select value={stationOf(p.id)} disabled={busy} onChange={(e) => void assign(p.id, e.target.value)} aria-label={`Mesa de ${p.name}`} data-testid={`desk-select-${p.id}`}>
                      <option value="">Sem mesa</option>
                      {stations.map((st) => {
                        const o = owner(st.id);
                        return <option key={st.id} value={st.id}>{st.label}{o && o !== p.id ? ` — hoje de ${nameOf(o) ?? o}` : ''}</option>;
                      })}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
