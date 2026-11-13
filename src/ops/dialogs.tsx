import { useEffect, useMemo, useRef, useState } from 'react';
import type { OperationalObject, SessionUser } from '../../shared/types';
import { api, ApiError, errorText, idempotencyKey } from '../api';
import { typingSignal } from '../live';
import { DemoBadge, Dialog, dateTime } from '../ui';

// ---------- chat ----------
interface Msg {
  id: string;
  mine: boolean;
  body: string;
  createdAt: number;
}

/** `direct`: abre a conversa pelo colega (ambiente 2D, sem mesa 3D); senão, pela mesa do mapa 3D. */
export function ChatDialog({ officeId, object, onClose, direct = false }: { officeId: string; object: Pick<OperationalObject, 'objectId' | 'seat'>; onClose: () => void; direct?: boolean }) {
  const [conv, setConv] = useState<{ conversationId: string; created: boolean; mode: 'demo' | 'real' } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const peer = object.seat?.employee;
  useEffect(() => {
    let alive = true;
    api
      .post<{ conversationId: string; created: boolean; mode: 'demo' | 'real' }>(direct ? `/api/office2d/${officeId}/chat/open` : `/api/offices/${officeId}/actions/chat/open`, direct ? { employeeId: object.seat?.employee?.id } : { objectId: object.objectId })
      .then(async (c) => {
        if (!alive) return;
        setConv(c);
        const m = await api.get<{ messages: Msg[] }>(`/api/chat/conversations/${c.conversationId}/messages`);
        if (alive) setMsgs(m.messages);
      })
      .catch((e) => alive && setErr(errorText(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeId, object.objectId]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [msgs]);
  useEffect(() => () => typingSignal.stop(), []);
  const send = async () => {
    if (!conv || !text.trim() || sending) return;
    setSending(true);
    try {
      typingSignal.stop();
      const r = await api.post<{ message: Msg }>(`/api/chat/conversations/${conv.conversationId}/messages`, { body: text.trim() });
      setMsgs((m) => [...m, r.message]);
      setText('');
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog title={`Conversa com ${peer?.name ?? 'colaborador'}`} onClose={onClose} badge={conv && <DemoBadge mode={conv.mode} />}>
      {peer && <p className="muted">{peer.department} · ramal {peer.extension}{conv ? ` · ${conv.created ? 'conversa criada agora' : 'conversa existente'}` : ''}</p>}
      {conv?.mode === 'demo' && <div className="notice demo">Demonstração: as mensagens ficam apenas neste ambiente e ninguém as recebe de fato.</div>}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {!conv && !err && <p className="muted">Abrindo conversa…</p>}
      {conv && (
        <>
          <div className="chat-log" ref={log} aria-live="polite">
            {msgs.length === 0 && <p className="muted">Nenhuma mensagem ainda.</p>}
            {msgs.map((m) => (
              <div key={m.id} className={`msg${m.mine ? ' mine' : ''}`} title={dateTime(m.createdAt)}>
                {m.body}
              </div>
            ))}
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input className="input" value={text} onChange={(e) => { setText(e.target.value); if (e.target.value) typingSignal.keystroke(); else typingSignal.stop(); }} onBlur={() => typingSignal.stop()} maxLength={2000} placeholder="Escreva uma mensagem" aria-label="Mensagem" />
            <button className="btn primary" disabled={!text.trim() || sending}>Enviar</button>
          </form>
        </>
      )}
    </Dialog>
  );
}

// ---------- acesso remoto ----------
interface RemoteResult {
  requestId: string;
  mode: 'demo' | 'real';
  status: string;
  device: { name: string };
  note: string;
  address?: string;
  command?: string;
  launchUrl?: string;
  correlationId: string;
}

export function RemoteDialog({ officeId, object, user, onClose }: { officeId: string; object: OperationalObject; user: SessionUser; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RemoteResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await api.post<RemoteResult>(`/api/offices/${officeId}/actions/remote/request`, { objectId: object.objectId, confirm: true }));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const mode = object.actions.remote?.mode ?? 'demo';
  return (
    <Dialog title="Solicitar acesso remoto" onClose={onClose} badge={<DemoBadge mode={res?.mode ?? mode} />} footer={
      res ? <button className="btn primary" onClick={onClose}>Fechar</button> : (
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy} onClick={() => void confirm()}>{busy ? 'Registrando…' : 'Confirmar solicitação'}</button>
        </>
      )
    }>
      <dl className="kv">
        <dt>Dispositivo</dt><dd>{object.device?.name ?? '—'}</dd>
        <dt>Objeto</dt><dd>{object.name}</dd>
        <dt>Solicitante</dt><dd>{user.name}</dd>
      </dl>
      {!res && <div className="notice info">A solicitação fica registrada na trilha de auditoria. A conexão, o consentimento da pessoa do outro lado e a autenticação acontecem dentro do produto de acesso remoto — este sistema não guarda senhas nem conecta sozinho.</div>}
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res && (
        <div className="stack">
          <div className={`notice ${res.mode === 'demo' ? 'demo' : 'ok'}`} role="status">{res.note}</div>
          {res.address && (
            <dl className="kv">
              <dt>Endereço AnyDesk</dt><dd className="mono">{res.address}</dd>
              <dt>Comando oficial</dt><dd className="mono">{res.command}</dd>
            </dl>
          )}
          {res.launchUrl && <a className="btn primary" href={res.launchUrl}>Abrir o AnyDesk</a>}
          <p className="muted">Registro {res.requestId} · ref. {res.correlationId.slice(0, 8)}</p>
        </div>
      )}
    </Dialog>
  );
}

// ---------- transferência ----------
interface Ticket {
  id: string;
  protocol: string;
  customerName: string;
  subject: string;
  queue: string;
  version: number;
}

export function TransferDialog({ officeId, object, onClose, onDone }: { officeId: string; object: OperationalObject; onClose: () => void; onDone: () => void }) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [mode, setMode] = useState<'demo' | 'real'>('demo');
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ ticket: Ticket; recipient: { name: string }; confirmedAt: number; transferId: string; replayed: boolean; mode: 'demo' | 'real' } | null>(null);
  // uma chave por intenção (atendimento escolhido): cliques repetidos e novas tentativas reaproveitam a mesma
  const keyRef = useRef<{ ticket: string; key: string } | null>(null);
  const recipient = object.seat?.employee;
  const load = async () => {
    try {
      const r = await api.get<{ tickets: Ticket[]; reason?: string; mode: 'demo' | 'real' }>('/api/tickets/active');
      setTickets(r.tickets);
      setReason(r.reason ?? null);
      setMode(r.mode);
      setPick((p) => (r.tickets.some((t) => t.id === p) ? p : r.tickets[0]?.id ?? null));
    } catch (e) {
      setErr(errorText(e));
      setTickets([]);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const ticket = tickets?.find((t) => t.id === pick) ?? null;
  const confirm = async () => {
    if (!ticket || busy) return;
    if (!keyRef.current || keyRef.current.ticket !== `${ticket.id}:${ticket.version}`) keyRef.current = { ticket: `${ticket.id}:${ticket.version}`, key: idempotencyKey() };
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<NonNullable<typeof done>>(`/api/offices/${officeId}/actions/transfer`, { objectId: object.objectId, ticketId: ticket.id, expectedVersion: ticket.version, confirm: true }, { 'Idempotency-Key': keyRef.current.key });
      setDone(r);
      onDone();
    } catch (e) {
      setErr(errorText(e));
      if (e instanceof ApiError && (e.code === 'ticket_changed' || e.code === 'no_active_ticket')) void load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Transferir atendimento" onClose={onClose} badge={<DemoBadge mode={done?.mode ?? mode} />} footer={
      done ? <button className="btn primary" onClick={onClose}>Fechar</button> : (
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!ticket || busy} onClick={() => void confirm()} data-testid="confirm-transfer">{busy ? 'Transferindo…' : 'Confirmar transferência'}</button>
        </>
      )
    }>
      {done ? (
        <div className="notice ok" role="status">
          Atendimento {done.ticket.protocol} transferido para {done.recipient.name} (fila {done.ticket.queue}) — confirmado pelo provedor em {dateTime(done.confirmedAt)}.
          {done.mode === 'demo' && ' Simulação: nenhum sistema de atendimento real foi alterado.'}
        </div>
      ) : (
        <>
          <dl className="kv">
            <dt>Destinatário</dt><dd>{recipient ? `${recipient.name} — ${recipient.department}, ramal ${recipient.extension}` : '—'}</dd>
            <dt>Fila</dt><dd>{ticket?.queue ?? '—'}</dd>
          </dl>
          {tickets === null && <p className="muted">Buscando seus atendimentos ativos…</p>}
          {tickets && tickets.length === 0 && <div className="notice warn" role="status">{reason ?? 'Você não tem atendimento ativo para transferir.'}</div>}
          {tickets && tickets.length > 0 && (
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="muted" style={{ marginBottom: 6 }}>Atendimento ativo a transferir</legend>
              {tickets.map((t) => (
                <label key={t.id} className="check card" style={{ padding: 10, boxShadow: 'none' }}>
                  <input type="radio" name="ticket" checked={pick === t.id} onChange={() => setPick(t.id)} />
                  <span>
                    <b>{t.protocol}</b> · {t.customerName}
                    <br />
                    <span className="muted">{t.subject} · fila {t.queue}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
      {err && <div className="notice bad" role="alert">{err}</div>}
    </Dialog>
  );
}

// ---------- impressão ----------
type PrintStatus = 'queued' | 'sent' | 'completed' | 'failed';
interface Job {
  id: string;
  fileName: string;
  status: PrintStatus;
  statusLabel: string;
  mode: 'demo' | 'real';
  createdAt: number;
}

export function PrintDialog({ officeId, object, onClose }: { officeId: string; object: OperationalObject; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dialogOpened, setDialogOpened] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [dup, setDup] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const keyRef = useRef<{ file: File; key: string } | null>(null);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  const queue = object.actions.printQueue;
  const MAX = 10 * 1024 * 1024;

  const choose = (f: File | null) => {
    setErr(null);
    setJob(null);
    setDialogOpened(false);
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

  const browserPrint = async () => {
    if (!file) return;
    try {
      frame.current?.contentWindow?.focus();
      frame.current?.contentWindow?.print();
    } catch {
      if (url) window.open(url, '_blank', 'noopener');
    }
    setDialogOpened(true);
    try {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map((b) => b.toString(16).padStart(2, '0')).join('');
      await api.post(`/api/offices/${officeId}/actions/print/dialog`, { objectId: object.objectId, fileName: file.name, fileSha256: digest, bytes: file.size });
    } catch {
      /* o registro na trilha não impede a impressão pelo navegador */
    }
  };

  const send = async () => {
    if (!file || busy) return;
    if (!keyRef.current || keyRef.current.file !== file) keyRef.current = { file, key: idempotencyKey() };
    setBusy(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ objectId: object.objectId, fileName: file.name, confirm: 'true' });
      const r = await api.raw<{ job: Job; duplicateOf?: string; replayed?: boolean }>(`/api/offices/${officeId}/actions/print/jobs?${q}`, file, { 'Content-Type': 'application/pdf', 'Idempotency-Key': keyRef.current.key });
      setJob(r.job);
      setDup(!!r.duplicateOf || !!r.replayed);
      setConfirming(false);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // acompanha a fila até um estado final
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') return;
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ job: Job }>(`/api/print/jobs/${job.id}`);
        setJob(r.job);
      } catch (e) {
        setErr(errorText(e));
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [job]);

  const steps: Array<[PrintStatus, string]> = [['queued', 'Na fila'], ['sent', 'Envio confirmado pela fila'], ['completed', 'Conclusão reportada pela fila']];
  const idx = job ? steps.findIndex(([s]) => s === job.status) : -1;
  return (
    <Dialog title={`Imprimir — ${object.name}`} onClose={onClose} wide badge={job ? <DemoBadge mode={job.mode} /> : queue?.state === 'available' ? <DemoBadge mode={queue.mode} /> : undefined}>
      <label className="field">
        <span>Documento (PDF, até 10 MB)</span>
        <input className="input" type="file" accept="application/pdf,.pdf" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
      </label>
      {err && <div className="notice bad" role="alert">{err}</div>}
      {url && <iframe ref={frame} className="preview" src={url} title="Pré-visualização do documento" />}
      {file && (
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="card stack" style={{ boxShadow: 'none' }}>
            <h3>Diálogo do navegador</h3>
            <p className="muted">Abre a impressão do próprio navegador. O navegador não garante qual impressora será usada nem confirma que o papel saiu.</p>
            <button className="btn" onClick={() => void browserPrint()}>Abrir diálogo de impressão</button>
            {dialogOpened && <div className="notice info" role="status">Diálogo aberto. Não há confirmação de impressão por este caminho.</div>}
          </div>
          <div className="card stack" style={{ boxShadow: 'none' }}>
            <h3>Envio direto para a impressora cadastrada</h3>
            {queue?.state !== 'available' ? (
              <p className="muted">{queue?.reason ?? 'Envio direto indisponível para esta impressora.'}</p>
            ) : job ? (
              <div className="timeline" aria-live="polite">
                {dup && <div className="notice info">Este documento já tinha sido enviado agora há pouco: o mesmo trabalho foi reaproveitado (sem impressão duplicada).</div>}
                {steps.map(([s, label], i) => (
                  <div key={s} className={`step${i <= idx ? ' done' : ''}${i === idx + 1 ? ' current' : ''}`}><span className="dot" />{label}</div>
                ))}
                {job.status === 'failed' && <div className="notice bad">A fila reportou falha.</div>}
                {job.mode === 'demo' && <div className="notice demo">Fila simulada: nada foi enviado a uma impressora física.</div>}
              </div>
            ) : confirming ? (
              <div className="stack">
                <div className="notice warn">Enviar “{file.name}” ({Math.ceil(file.size / 1024)} KB) para {object.device?.name ?? object.name}?</div>
                <div className="row">
                  <button className="btn" onClick={() => setConfirming(false)}>Cancelar</button>
                  <button className="btn primary" disabled={busy} onClick={() => void send()} data-testid="confirm-print">{busy ? 'Enviando…' : 'Confirmar envio'}</button>
                </div>
              </div>
            ) : (
              <>
                <p className="muted">O documento vai para a fila da impressora vinculada; o estado mostrado vem da própria fila. Retenção: o arquivo é apagado ao concluir.</p>
                <button className="btn primary" onClick={() => setConfirming(true)}>Enviar para {object.device?.name ?? 'a impressora'}</button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------- painel / CAD ----------
export function DashboardDialog({ officeId, object, kind, onClose }: { officeId: string; object: OperationalObject; kind: 'dashboard' | 'cad'; onClose: () => void }) {
  const [res, setRes] = useState<{ name: string; url: string; mode: 'demo' | 'real' } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.post<{ name: string; url: string; mode: 'demo' | 'real' }>(`/api/offices/${officeId}/actions/${kind}/open`, { objectId: object.objectId }).then(setRes, (e) => setErr(errorText(e)));
  }, [officeId, object.objectId, kind]);
  return (
    <Dialog title={res?.name ?? (kind === 'cad' ? 'Projeto CAD' : 'Painel')} onClose={onClose} wide badge={res && <DemoBadge mode={res.mode} />} footer={res && res.mode === 'real' ? <a className="btn" href={res.url} target="_blank" rel="noopener noreferrer">Abrir em nova aba</a> : undefined}>
      {err && <div className="notice bad" role="alert">{err}</div>}
      {res && <iframe className="preview" style={{ height: 480 }} src={res.url} title={res.name} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />}
    </Dialog>
  );
}
