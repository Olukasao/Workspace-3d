import type { Router } from 'express';
import type { AppContext } from '../app';
import { currentUser, requireRole } from '../auth';
import { HttpError, audit, correlationId, h } from '../http';
import { listOffices, loadOffice, officeInfo, operationalView, parseScene, publish, saveDraft } from '../office';

export function officeRoutes(r: Router, { db, integrations, live }: AppContext) {
  r.get('/offices', h(async (_req, res) => {
    res.json({ offices: await listOffices(db, currentUser(res)) });
  }));

  // Visão operacional: sempre a ÚLTIMA REVISÃO PUBLICADA, com os estados calculados para o perfil atual.
  r.get('/offices/:id/operational', h(async (req, res) => {
    res.json(await operationalView(db, currentUser(res), req.params.id, integrations));
  }));

  // ---- edição: só administrador ----
  r.get('/offices/:id/draft', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const office = await loadOffice(db, user, req.params.id);
    res.json({ office: await officeInfo(db, office), doc: parseScene(office.draft_json), version: Number(office.draft_version), updatedAt: Number(office.draft_updated_at) });
  }));

  r.put('/offices/:id/draft', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const { doc, baseVersion } = (req.body ?? {}) as { doc?: unknown; baseVersion?: unknown };
    if (!Number.isInteger(baseVersion)) throw new HttpError(400, 'bad_request', 'Informe a versão-base do rascunho.');
    try {
      const out = await saveDraft(db, user, req.params.id, doc, baseVersion as number);
      await audit(db, { user, action: 'draft.save', targetType: 'office', targetId: req.params.id, result: 'completed', mode: 'real', detail: { version: out.version }, correlationId: correlationId(res) });
      res.json(out);
    } catch (e) {
      if (e instanceof HttpError && e.code === 'draft_conflict') await audit(db, { user, action: 'draft.save', targetType: 'office', targetId: req.params.id, result: 'conflict', mode: 'real', detail: { baseVersion }, correlationId: correlationId(res) });
      throw e;
    }
  }));

  r.post('/offices/:id/publish', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    const { baseVersion, note } = (req.body ?? {}) as { baseVersion?: unknown; note?: unknown };
    if (!Number.isInteger(baseVersion)) throw new HttpError(400, 'bad_request', 'Informe a versão do rascunho a publicar.');
    try {
      const out = await publish(db, user, req.params.id, baseVersion as number, typeof note === 'string' ? note.slice(0, 250) : null);
      live.invalidate(user.companyId);
      await audit(db, { user, action: 'office.publish', targetType: 'office', targetId: req.params.id, result: 'completed', mode: 'real', detail: { revision: out.number }, correlationId: correlationId(res) });
      res.json(out);
    } catch (e) {
      if (e instanceof HttpError && e.code === 'draft_conflict') await audit(db, { user, action: 'office.publish', targetType: 'office', targetId: req.params.id, result: 'conflict', mode: 'real', detail: { baseVersion }, correlationId: correlationId(res) });
      throw e;
    }
  }));

  r.get('/offices/:id/revisions', requireRole('admin'), h(async (req, res) => {
    const user = currentUser(res);
    await loadOffice(db, user, req.params.id);
    const rows = await db.query<{ id: string; rev_number: number; note: string | null; published_at: number; name: string | null }>(
      'SELECT r.id, r.rev_number, r.note, r.published_at, u.name FROM office_revisions r LEFT JOIN users u ON u.id = r.published_by WHERE r.office_id = ? AND r.company_id = ? ORDER BY r.rev_number DESC LIMIT 50',
      [req.params.id, user.companyId],
    );
    res.json({ revisions: rows.map((x) => ({ id: x.id, number: Number(x.rev_number), note: x.note, publishedAt: Number(x.published_at), publishedBy: x.name ?? '—' })) });
  }));

  r.get('/integrations/status', (_req, res) => {
    res.json({ integrations: integrations.status() });
  });
}
