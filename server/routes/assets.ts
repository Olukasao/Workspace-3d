import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express, { type Router } from 'express';
import type { AppContext } from '../app';
import { GlbRejected, countTriangles, createIo, inspectGlb, maxTextureSide, normalizeDocument, sha256, UPLOAD_LIMITS } from '../assets/glb';
import { currentUser, requireRole } from '../auth';
import { one } from '../db/driver';
import { HttpError, audit, correlationId, h, newId, str } from '../http';
import { listAssets } from '../office';

const KINDS = ['desk', 'workstation', 'printer', 'tv', 'furniture', 'decor'];
const MOUNTS = ['floor', 'wall', 'surface'];

export function assetRoutes(r: Router, { db, cfg }: AppContext) {
  const dir = path.join(cfg.dataDir, 'uploads');

  r.get('/assets', h(async (_req, res) => {
    res.json({ assets: await listAssets(db, currentUser(res).companyId) });
  }));

  // Arquivos enviados pela empresa: endereçados pelo hash e servidos só para a própria empresa.
  r.get('/assets/file/:hash', h(async (req, res) => {
    const user = currentUser(res);
    const hash = req.params.hash.replace(/\.glb$/, '');
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new HttpError(404, 'not_found', 'Arquivo não encontrado.');
    const row = await one(db, 'SELECT id FROM asset_definitions WHERE file_hash = ? AND company_id = ?', [hash, user.companyId]);
    const file = path.join(dir, `${hash}.glb`);
    if (!row || !existsSync(file)) throw new HttpError(404, 'not_found', 'Arquivo não encontrado.');
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.sendFile(file);
  }));

  /**
   * Upload de modelo pelo administrador. Corpo = bytes do GLB; metadados em parâmetros de consulta.
   * Limite de tamanho, checagem de tipo pela assinatura (não pela extensão), recusa de recursos externos,
   * limites de triângulos/textura e deduplicação pelo hash — o arquivo é guardado uma vez, mas cada cadastro
   * mantém seus próprios metadados e licença.
   */
  r.post('/assets/upload', requireRole('admin'), express.raw({ type: () => true, limit: cfg.uploadMaxBytes }), h(async (req, res) => {
    const user = currentUser(res);
    const cid = correlationId(res);
    const reject = async (status: number, code: string, message: string) => {
      await audit(db, { user, action: 'asset.upload', targetType: 'asset', targetId: '-', result: 'rejected', mode: 'real', detail: { code }, correlationId: cid });
      throw new HttpError(status, code, message);
    };
    const name = str(req.query.name, 80);
    const license = str(req.query.license, 60);
    const author = str(req.query.author, 160) ?? user.name;
    const kind = KINDS.includes(String(req.query.kind)) ? String(req.query.kind) : 'decor';
    const mount = MOUNTS.includes(String(req.query.mount)) ? String(req.query.mount) : 'floor';
    const category = str(req.query.category, 60) ?? 'Enviados';
    if (!name) throw new HttpError(400, 'bad_request', 'Informe o nome do modelo.');
    if (!license) throw new HttpError(400, 'bad_request', 'Informe a licença do modelo (por exemplo: "CC0 1.0", "CC-BY 4.0" ou "Proprietária da empresa").');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'bad_request', 'Arquivo ausente.');
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);

    let dims: { width: number; depth: number; height: number };
    let triangles = 0;
    try {
      inspectGlb(bytes, { ...UPLOAD_LIMITS, maxBytes: cfg.uploadMaxBytes });
      const io = await createIo();
      const doc = await io.readBinary(bytes);
      triangles = countTriangles(doc);
      if (triangles > UPLOAD_LIMITS.maxTriangles) throw new GlbRejected('too_complex', `O modelo tem ${triangles} triângulos; o limite é ${UPLOAD_LIMITS.maxTriangles}.`);
      if (maxTextureSide(doc) > UPLOAD_LIMITS.maxTextureSize) throw new GlbRejected('texture_too_large', `Texturas acima de ${UPLOAD_LIMITS.maxTextureSize}px não são aceitas.`);
      // mede sem alterar o arquivo: o upload precisa já estar em metros
      const probe = await io.readBinary(bytes);
      const n = normalizeDocument(probe, { pivot: mount === 'wall' ? 'wall-back' : 'base-center' });
      if (Math.max(n.width, n.depth, n.height) > 30 || Math.max(n.width, n.depth, n.height) < 0.01) throw new GlbRejected('bad_scale', 'As medidas do modelo estão fora do esperado (entre 1 cm e 30 m). Exporte em metros.');
      dims = n;
      // grava a versão NORMALIZADA (pivô na base / âncora de parede), para se comportar como os assets do catálogo
      const normalized = await io.writeBinary(probe);
      const hash = sha256(normalized);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${hash}.glb`);
      const stored = existsSync(file);
      if (!stored) writeFileSync(file, normalized);

      // mesmo arquivo + mesmos metadados = mesmo cadastro; mesmo arquivo com metadados/licença diferentes = cadastro novo que reaproveita o arquivo
      const same = await one<{ id: string }>(db, 'SELECT id FROM asset_definitions WHERE company_id = ? AND file_hash = ? AND name = ? AND license = ? AND author = ?', [user.companyId, hash, name, license, author]);
      const id = same?.id ?? newId('asset');
      if (!same) {
        await db.exec(
          `INSERT INTO asset_definitions (id, company_id, slug, name, category, default_kind, mount, pivot, file_url, thumb_url, file_hash, file_bytes, width_m, depth_m, height_m, surface_height_m, triangles, license, author, source_url, attribution, origin, version, status, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'upload', 1, 'approved', ?, ?)`,
          [id, user.companyId, id, name, category, kind, mount, mount === 'wall' ? 'wall-back' : 'base-center', `/api/assets/file/${hash}.glb`, hash, normalized.byteLength, dims.width, dims.depth, dims.height, triangles, license, author, str(req.query.sourceUrl, 400) ?? '', `"${name}" por ${author} [${license}] — enviado por ${user.name}.`, user.id, Date.now()],
        );
      }
      await audit(db, { user, action: 'asset.upload', targetType: 'asset', targetId: id, result: 'completed', mode: 'real', detail: { hash, bytes: normalized.byteLength, triangles, deduplicatedFile: stored, reusedDefinition: !!same }, correlationId: cid });
      const asset = (await listAssets(db, user.companyId)).find((a) => a.id === id);
      res.status(same ? 200 : 201).json({ asset, deduplicatedFile: stored, reusedDefinition: !!same });
    } catch (e) {
      if (e instanceof GlbRejected) return reject(e.code === 'too_large' ? 413 : 422, e.code, e.message);
      if (e instanceof HttpError) throw e;
      return reject(422, 'invalid_model', 'Não foi possível ler o modelo. Envie um GLB (glTF 2.0 binário) válido e autocontido.');
    }
  }));
}
