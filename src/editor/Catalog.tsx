import { DoorOpen, Eraser, MousePointer2, PanelTop, Search, Square, SquareDashed, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AssetDefinition, FloorFinish, SceneDoc } from '../../shared/types';
import type { DrawOptions, Tool } from './DrawController';
import { api, errorText } from '../api';
import { Dialog, toast } from '../ui';

const KIND_LABEL: Record<string, string> = { room: 'Sala', wall: 'Parede', opening: 'Porta/janela', workstation: 'Posto', printer: 'Impressora', tv: 'TV', furniture: 'Mobiliário', decor: 'Decoração' };
const MOUNT_LABEL: Record<string, string> = { floor: 'piso', wall: 'parede', surface: 'superfície' };

type DrawOpts = Omit<DrawOptions, 'grid'>;

export function Catalog({ assets, doc, onAdd, tool, setTool, drawOpts, setDrawOpts, onClearPlan, onUpload, onSelectObject, selected }: {
  assets: AssetDefinition[]; doc: SceneDoc; onAdd: (a: AssetDefinition) => void; tool: Tool; setTool: (t: Tool) => void; drawOpts: DrawOpts; setDrawOpts: (o: DrawOpts) => void; onClearPlan: () => void; onUpload: () => void; onSelectObject: (id: string) => void; selected: ReadonlySet<string>;
}) {
  const [tab, setTab] = useState<'catalog' | 'objects'>('catalog');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('Todas');
  const cats = useMemo(() => ['Todas', ...[...new Set(assets.map((a) => a.category))].sort()], [assets]);
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = assets.filter((a) => (cat === 'Todas' || a.category === cat) && (!q || norm(`${a.name} ${a.category} ${a.author}`).includes(norm(q))));
  const objects = doc.objects.filter((o) => !q || norm(`${o.name} ${KIND_LABEL[o.kind]}`).includes(norm(q)));

  return (
    <>
      <div className="side-head">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'catalog'} aria-pressed={tab === 'catalog'} onClick={() => setTab('catalog')}>Catálogo</button>
          <button role="tab" aria-selected={tab === 'objects'} aria-pressed={tab === 'objects'} onClick={() => setTab('objects')}>Objetos ({doc.objects.length})</button>
        </div>
        <div className="row">
          <Search size={15} className="muted" aria-hidden />
          <input className="input" placeholder={tab === 'catalog' ? 'Buscar no catálogo' : 'Buscar objeto na cena'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        </div>
        {tab === 'catalog' && (
          <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
      </div>
      <div className="side-body">
        {tab === 'catalog' ? (
          <>
            <StructureTools tool={tool} setTool={setTool} opts={drawOpts} setOpts={setDrawOpts} onClearPlan={onClearPlan} empty={doc.objects.length === 0} />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>Modelos ({list.length})</h3>
              <button className="btn small" onClick={onUpload}><Upload size={13} /> Enviar GLB</button>
            </div>
            <div className="catalog">
              {list.map((a) => (
                <button key={a.id} className="asset-card" onClick={() => onAdd(a)} title={`${a.name}\n${a.width}×${a.depth}×${a.height} m · montagem: ${MOUNT_LABEL[a.mount]}\n${a.license} — ${a.author}`} data-asset={a.slug}>
                  {a.thumbUrl ? <img src={a.thumbUrl} alt="" loading="lazy" /> : <span className="ph">sem miniatura</span>}
                  <b>{a.name}</b>
                  <small>{KIND_LABEL[a.defaultKind]} · {MOUNT_LABEL[a.mount]}</small>
                </button>
              ))}
            </div>
            <p className="muted">Clique para inserir no centro da vista. Itens de superfície (monitor, telefone…) entram sobre a mesa selecionada e passam a acompanhá-la.</p>
          </>
        ) : (
          <div className="objlist" role="listbox" aria-label="Objetos da cena">
            {objects.map((o) => (
              <div key={o.id} role="option" tabIndex={0} aria-selected={selected.has(o.id)} onClick={() => onSelectObject(o.id)} onKeyDown={(e) => e.key === 'Enter' && onSelectObject(o.id)}>
                <span className="txt">
                  <b>{o.name}</b>
                  <small>{KIND_LABEL[o.kind]}{o.locked ? ' · bloqueado' : ''}{o.groupId ? ' · em grupo' : ''}</small>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [license, setLicense] = useState('');
  const [author, setAuthor] = useState('');
  const [kind, setKind] = useState('decor');
  const [mount, setMount] = useState('floor');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ name, license, author, kind, mount });
      const out = await api.raw<{ reusedDefinition: boolean; deduplicatedFile: boolean }>(`/api/assets/upload?${q}`, file, { 'Content-Type': 'model/gltf-binary' });
      toast(out.reusedDefinition ? 'Este modelo já estava cadastrado com os mesmos dados.' : out.deduplicatedFile ? 'Cadastro criado; o arquivo idêntico já existente foi reaproveitado.' : 'Modelo enviado e adicionado ao catálogo.');
      onUploaded();
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Enviar modelo 3D" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!file || !name || !license || busy} onClick={() => void send()}>{busy ? 'Validando…' : 'Enviar'}</button>
      </>
    }>
      <p className="muted">Aceito: GLB (glTF 2.0 binário) autocontido, em metros, até 8 MB, até 150 mil triângulos e texturas de até 2048 px. Arquivos com recursos externos são recusados.</p>
      <label className="field"><span>Arquivo .glb</span><input className="input" type="file" accept=".glb,model/gltf-binary" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <label className="field"><span>Nome no catálogo</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      <div className="grid2">
        <label className="field"><span>Licença</span><input className="input" value={license} onChange={(e) => setLicense(e.target.value)} placeholder="CC0 1.0, CC-BY 4.0, Proprietária…" /></label>
        <label className="field"><span>Autor</span><input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} /></label>
      </div>
      <div className="grid2">
        <label className="field"><span>Tipo</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="decor">Decoração</option><option value="furniture">Mobiliário</option><option value="workstation">Posto (computador)</option><option value="printer">Impressora</option><option value="tv">TV</option>
          </select>
        </label>
        <label className="field"><span>Montagem</span>
          <select className="input" value={mount} onChange={(e) => setMount(e.target.value)}>
            <option value="floor">Piso</option><option value="surface">Superfície (mesa)</option><option value="wall">Parede</option>
          </select>
        </label>
      </div>
      {err && <div className="notice bad" role="alert">{err}</div>}
    </Dialog>
  );
}

const TOOLS: Array<[Tool, string, string, typeof Square]> = [
  ['select', 'Selecionar', 'V', MousePointer2],
  ['floor', 'Piso', 'F', Square],
  ['wall', 'Parede', 'W', PanelTop],
  ['door', 'Porta', 'P', DoorOpen],
  ['window', 'Janela', 'J', SquareDashed],
  ['glassDoor', 'Porta de vidro', '', DoorOpen],
];
const FINISHES: Array<[FloorFinish, string]> = [['carpet', 'Carpete'], ['wood', 'Madeira'], ['tile', 'Cerâmica'], ['concrete', 'Concreto'], ['plain', 'Liso']];

function StructureTools({ tool, setTool, opts, setOpts, onClearPlan, empty }: { tool: Tool; setTool: (t: Tool) => void; opts: DrawOpts; setOpts: (o: DrawOpts) => void; onClearPlan: () => void; empty: boolean }) {
  const wallOpts = (patch: Partial<DrawOpts['wall']>) => setOpts({ ...opts, wall: { ...opts.wall, ...patch } });
  return (
    <div className="stack" data-testid="structure-tools">
      <h3>Construir a estrutura</h3>
      <div className="grid3" role="toolbar" aria-label="Ferramentas de construção">
        {TOOLS.map(([id, label, key, Icon]) => (
          <button key={id} className={`btn small${tool === id ? ' primary' : ''}`} aria-pressed={tool === id} onClick={() => setTool(id)} title={key ? `${label} (${key})` : label} data-tool={id} style={{ flexDirection: 'column', gap: 2, padding: '6px 4px' }}>
            <Icon size={16} />
            <span style={{ fontSize: 11 }}>{label}</span>
          </button>
        ))}
      </div>
      {tool === 'floor' && (
        <div className="card stack" style={{ boxShadow: 'none', padding: 10 }}>
          <label className="field"><span>Acabamento do piso</span>
            <select className="input" value={opts.floor} onChange={(e) => setOpts({ ...opts, floor: e.target.value as FloorFinish })} data-testid="floor-finish">
              {FINISHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={opts.withWalls} onChange={(e) => setOpts({ ...opts, withWalls: e.target.checked })} /> Já criar as 4 paredes (sala fechada)</label>
          <p className="muted">Arraste no chão. Cada piso é uma zona com nome, setor e capacidade (edite no inspetor).</p>
        </div>
      )}
      {(tool === 'wall' || (tool === 'floor' && opts.withWalls)) && (
        <div className="card stack" style={{ boxShadow: 'none', padding: 10 }}>
          <label className="field"><span>Tipo de parede</span>
            <select className="input" value={opts.wall.style} onChange={(e) => { const style = e.target.value as DrawOpts['wall']['style']; wallOpts({ style, thickness: style === 'glass' ? 0.06 : style === 'partition' ? 0.08 : 0.12 }); }}>
              <option value="solid">Alvenaria</option><option value="glass">Divisória de vidro</option><option value="partition">Divisória</option>
            </select>
          </label>
          <div className="grid2">
            <label className="field"><span>Altura (m)</span><input className="input" type="number" min={0.3} max={6} step={0.05} value={opts.wall.height} onChange={(e) => wallOpts({ height: Math.min(6, Math.max(0.3, Number(e.target.value) || 2.7)) })} /></label>
            <label className="field"><span>Espessura (m)</span><input className="input" type="number" min={0.03} max={0.6} step={0.01} value={opts.wall.thickness} onChange={(e) => wallOpts({ thickness: Math.min(0.6, Math.max(0.03, Number(e.target.value) || 0.12)) })} /></label>
          </div>
          {tool === 'wall' && <p className="muted">Clique ponto a ponto. Clicar de novo no primeiro ponto fecha o contorno. Para esticar uma parede pronta, selecione-a e arraste as bolinhas das pontas.</p>}
        </div>
      )}
      {(tool === 'door' || tool === 'window' || tool === 'glassDoor') && <p className="muted">Passe o mouse sobre uma parede: o vão aparece em azul onde cabe. Depois de inserido, arraste-o ao longo da parede ou ajuste largura e altura no inspetor.</p>}
      <button className="btn small" onClick={onClearPlan} disabled={empty}><Eraser size={13} /> Começar com o plano vazio</button>
    </div>
  );
}
