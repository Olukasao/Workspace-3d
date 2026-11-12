import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role, SessionUser } from '../shared/types';
import type { Config } from './config';
import { one, type Db } from './db/driver';
import { HttpError } from './http';

export const SESSION_COOKIE = 'o3d_session';

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

interface UserRow {
  id: string;
  company_id: string;
  company_name: string;
  email: string;
  name: string;
  role: Role;
  employee_id: string | null;
  password_hash: string;
}

const toSessionUser = (u: UserRow): SessionUser => ({ id: u.id, name: u.name, email: u.email, role: u.role, companyId: u.company_id, companyName: u.company_name, employeeId: u.employee_id });

export async function login(db: Db, cfg: Config, email: string, password: string): Promise<{ user: SessionUser; token: string; maxAgeMs: number } | null> {
  const u = await one<UserRow>(
    db,
    'SELECT u.id, u.company_id, c.name AS company_name, u.email, u.name, u.role, u.employee_id, u.password_hash FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = ? AND u.active = 1',
    [email.trim().toLowerCase()],
  );
  // compara mesmo sem usuário, para o tempo de resposta não revelar se o e-mail existe
  const ok = verifyPassword(password, u?.password_hash ?? 'scrypt$00$00');
  if (!u || !ok) return null;
  const token = randomBytes(32).toString('hex');
  const maxAgeMs = cfg.sessionTtlHours * 3600_000;
  const now = Date.now();
  await db.exec('DELETE FROM sessions WHERE expires_at < ?', [now]);
  await db.exec('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [tokenHash(token), u.id, now, now + maxAgeMs]);
  return { user: toSessionUser(u), token, maxAgeMs };
}

export async function logout(db: Db, token: string | null): Promise<void> {
  if (token) await db.exec('DELETE FROM sessions WHERE token_hash = ?', [tokenHash(token)]);
}

export async function userFromToken(db: Db, token: string | null): Promise<SessionUser | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const u = await one<UserRow>(
    db,
    `SELECT u.id, u.company_id, c.name AS company_name, u.email, u.name, u.role, u.employee_id, u.password_hash
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN companies c ON c.id = u.company_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    [tokenHash(token), Date.now()],
  );
  return u ? toSessionUser(u) : null;
}

export function sessionCookie(cfg: Config, token: string, maxAgeMs: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${cfg.cookieSecure ? '; Secure' : ''}`;
}

/** Exige sessão válida. O usuário fica em res.locals.user. */
export function requireAuth(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await userFromToken(db, readCookie(req, SESSION_COOKIE));
      if (!user) throw new HttpError(401, 'unauthenticated', 'Sessão expirada ou ausente. Entre novamente.');
      res.locals.user = user;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user as SessionUser | undefined;
    if (!user || !roles.includes(user.role)) return next(new HttpError(403, 'forbidden', 'Seu perfil não tem permissão para esta operação.'));
    next();
  };
}

export const currentUser = (res: Response): SessionUser => res.locals.user as SessionUser;
