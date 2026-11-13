/**
 * Clique na impressora do escritório 2D: área de impressoras (lista com busca, no mesmo estilo da área de dispositivos da TV).
 * A pessoa escolhe a impressora do inventário (a do objeto vem marcada), seleciona o PDF e envia para a fila dela. Documento,
 * confirmação, tamanho e clique duplo seguem as mesmas regras do 3D; o estado mostrado vem da própria fila.
 */
import { Printer, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText, idempotencyKey } from '../../../api';
import { DemoBadge, Dialog } from '../../../ui';

interface PrinterRow { id: string; name: string; location: string | null; canPrint: boolean; reason?: string; bound: boolean }
interface List { mode: 'demo' | 'real'; queue: { available: boolean; reason?: string }; printers: PrinterRow[] }
interface Job { id: string; fileName: string; bytes: number; status: string; statusLabel: string; mode: 'demo' | 'real' }
const MAX = 10 * 1024 * 1024;
const STEPS: Array<[string, string]> = [['queued', 'Na fila'], ['sent', 'Envio confirmado pela fila'], ['completed', 'Conclusão reportada pela fila']];

export function PrinterDialog({ officeId, objectId, onClose }: { officeId: string; objectId: string; onClose: () => void }) {
  const [list, setList] = useState<List | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ job: Job; printer: { name: string }; dup: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const keyRef = useRef<{ file: File; printer: string; key: string } | null>(null);
  const base = `/api/office2d/${officeId}/objects/${objectId}`;

  useEffect(() => {
    let dead = false;
    api.get<List>(`${base}/printers`).then(
      (r) => {
        if (dead) return;
        setList(r);
        setSel((r.printers.find((p) => p.bound && p.canPrint) ?? r.printers.find((p) => p.canPrint))?.id ?? null);
      },
      (e) => !dead && setErr(errorText(e)),
    );
    return () => {
      dead = true;
    };
  }, [base]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list?.printers ?? []).filter((p) => !t || `${p.name} ${p.location ?? ''}`.toLowerCase().includes(t));
  }, [list, q]);
  const chosen = list?.printers.find((p) => p.id === sel) ?? null;

  const choose = (f: File | null) => {
    setErr(null);
    setConfirming(false);
    if (!f) return setFile(null);
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setFile(null);
      return setErr('Selecione um arquivo PDF.');
    }
    if (f.size > MAX) {
      setFile(null);
      return setErr('O arquivo passa de 10 MB.');
    }
    setFile(f);
  };

  const send = async () => {
    if (!file || !chosen || busy) return;
    if (!keyRef.current || keyRef.current.file !== file || keyRef.current.printer !== chosen.id) keyRef.current = { file, printer: chosen.id, key: idempotencyKey() };
    setBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ deviceId: chosen.id, fileName: file.name, confirm: 'true' });
      const r = await api.raw<{ job: Job; printer: { name: string }; duplicateOf?: string; replayed?: boolean }>(`${base}/print/jobs?${params}`, file, { 'Content-Type': 'application/pdf', 'Idempotency-Key': keyRef.current.key });
      setJob({ job: r.job, printer: r.printer, dup: !!r.duplicateOf || !!r.replayed });
      setConfirming(false);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // acompanha a fila até um estado final
  useEffect(() => {
    if (!job || job.job.status === 'completed' || job.job.status === 'failed') return;
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ job: Job }>(`/api/print/jobs/${job.job.id}`);
        setJob({ ...job, job: r.job });
      } catch (e) {
        setErr(errorText(e));
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [job]);

  const idx = job ? STEPS.findIndex(([s]) => s === job.job.status) : -1;
  const queueOk = list?.queue.available ?? true;
  return (
    <Dialog
      title="Impressora: escolha e envie o documento"
      wide
      onClose={onClose}
      badge={job ? <DemoBadge mode={job.job.mode} /> : list ? <DemoBadge mode={list.mode} /> : undefined}
      footer={
        job ? (
          <button className="btn primary" onClick={onClose} data-testid="printer-close">Fechar</button>
        ) : (
          <>
            <button className="btn" onClick={onClose} data-testid="printer-close">Cancelar</button>
            {confirming ? (
              <button className="btn primary" disabled={busy} onClick={() => void send()} data-testid="printer-confirm">{busy ? 'Enviando…' : 'Confirmar envio'}</button>
            ) : (
              <button className="btn primary" disabled={!file || !chosen || !queueOk} onClick={() => setConfirming(true)} data-testid="printer-send">{chosen ? `Enviar para ${chosen.name}` : 'Escolha uma impressora'}</button>
            )}
          </>
        )
      }
    >
      {!job && (
        <>
          <label className="tv-search">
            <Search size={14} aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar impressora por nome ou local" aria-label="Buscar impressora" data-testid="printer-search" />
          </label>
          {!list && !err && <div className="muted">Carregando…</div>}
          {list && !list.printers.length && <div className="notice info" data-testid="printer-empty">Nenhuma impressora está cadastrada no inventário.</div>}
          {list && !queueOk && <div className="notice warn" data-testid="printer-queue-off">{list.queue.reason ?? 'O envio direto está indisponível.'}</div>}
          <ul className="tv-devices" role="listbox" aria-label="Impressoras">
            {shown.map((p) => (
              <li key={p.id}>
                <button role="option" aria-selected={p.id === sel} disabled={!p.canPrint} className={`tv-device ${p.id === sel ? 'on' : ''}`} title={p.reason} onClick={() => { setSel(p.id); setConfirming(false); }} data-testid={`printer-${p.id}`}>
                  <Printer size={20} aria-hidden="true" />
                  <span className="tv-device-main">
                    <b>{p.name}</b>
                    <span className="muted">{p.location ?? 'Impressora'}</span>
                    {!p.canPrint && <span className="muted tv-reason">{p.reason}</span>}
                  </span>
                  {p.bound && <span className="tv-tag">Deste ponto</span>}
                </button>
              </li>
            ))}
          </ul>
          <label className="field">
            <span>Documento (PDF, até 10 MB)</span>
            <input className="input" type="file" accept="application/pdf,.pdf" onChange={(e) => choose(e.target.files?.[0] ?? null)} data-testid="printer-file" />
          </label>
          {confirming && file && chosen && <div className="notice warn">Enviar “{file.name}” ({Math.ceil(file.size / 1024)} KB) para {chosen.name}?</div>}
          <p className="muted">O documento vai para a fila da impressora escolhida; o estado mostrado vem da própria fila. O arquivo é apagado quando a fila conclui.</p>
        </>
      )}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {job && (
        <div className="timeline" aria-live="polite" data-testid="printer-job">
          <p><b>{job.job.fileName}</b> → {job.printer.name}</p>
          {job.dup && <div className="notice info">Este documento já tinha sido enviado agora há pouco: o mesmo trabalho foi reaproveitado (sem impressão duplicada).</div>}
          {STEPS.map(([s, label], i) => (
            <div key={s} className={`step${i <= idx ? ' done' : ''}${i === idx + 1 ? ' current' : ''}`}><span className="dot" />{label}</div>
          ))}
          {job.job.status === 'failed' && <div className="notice bad">A fila reportou falha.</div>}
          {job.job.mode === 'demo' && <div className="notice demo">Fila simulada: nada foi enviado a uma impressora física.</div>}
        </div>
      )}
    </Dialog>
  );
}
