import { LogOut } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { OfficeInfo, SessionUser } from '../shared/types';
import { AuditPage, CreditsPage, IntegrationsPage } from './admin/pages';
import { SettingsPage } from './admin/SettingsPage';
import { api, errorText } from './api';
import { PresenceDemo } from './avatar/PresenceDemo';
import { connectLive } from './live';
import { isDirty, useEditor } from './editor/store';
import { WorkspaceManager } from './workspace/WorkspaceManager';
import { Toast, toast } from './ui';

type Page = 'ops' | 'editor' | 'audit' | 'integrations' | 'credits' | 'avatar' | 'settings';
const ROLE_LABEL = { admin: 'Administrador', operator: 'Operador', viewer: 'Visualizador' } as const;

const pageFromHash = (): Page => {
  const p = location.hash.replace('#/', '') as Page;
  return ['ops', 'editor', 'audit', 'integrations', 'credits', 'avatar', 'settings'].includes(p) ? p : 'ops';
};

export function App() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [demoMode, setDemoMode] = useState(false);
  useEffect(() => {
    api.get<{ user: SessionUser; demoMode: boolean }>('/api/auth/me').then(
      (r) => {
        setUser(r.user);
        setDemoMode(r.demoMode);
      },
      () => setUser(null),
    );
  }, []);
  if (user === undefined) return <div className="loading">Carregando…</div>;
  if (!user) return <Login onLogin={(u, demo) => { setUser(u); setDemoMode(demo); }} />;
  return (
    <>
      <Shell user={user} demoMode={demoMode} onLogout={() => setUser(null)} />
      <Toast />
    </>
  );
}

function Shell({ user, demoMode, onLogout }: { user: SessionUser; demoMode: boolean; onLogout: () => void }) {
  const [page, setPageState] = useState<Page>(pageFromHash);
  const [offices, setOffices] = useState<OfficeInfo[] | null>(null);
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [opsKey, setOpsKey] = useState(0);

  const loadOffices = useCallback(async () => {
    try {
      const r = await api.get<{ offices: OfficeInfo[] }>('/api/offices');
      setOffices(r.offices);
      setOfficeId((cur) => cur ?? r.offices[0]?.id ?? null);
    } catch (e) {
      setErr(errorText(e));
    }
  }, []);
  useEffect(() => {
    void loadOffices();
  }, [loadOffices]);

  const allowed = (p: Page) => p === 'ops' || p === 'credits' || (p === 'avatar' && !!user.employeeId) || user.role === 'admin';
  // presença: a conexão com o aplicativo (qualquer aba) mantém a pessoa online, não só a aba do escritório
  useEffect(() => connectLive(), []);
  const setPage = (p: Page) => {
    if (!allowed(p)) return toast('Seu perfil não tem acesso a esta área.');
    if (page === 'editor' && p !== 'editor' && isDirty(useEditor.getState())) toast('Há alterações não salvas no rascunho; elas continuam aqui quando você voltar ao editor.');
    location.hash = `#/${p}`;
    setPageState(p);
  };
  useEffect(() => {
    const onHash = () => setPageState(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const current: Page = allowed(page) ? page : 'ops';

  const logout = async () => {
    if (isDirty(useEditor.getState()) && !window.confirm('Há alterações não salvas no rascunho. Sair mesmo assim?')) return;
    await api.post('/api/auth/logout').catch(() => undefined);
    useEditor.setState({ doc: null, officeId: null, savedJson: '', past: [], future: [], selected: [] });
    location.hash = '';
    onLogout();
  };

  const office = offices?.find((o) => o.id === officeId) ?? null;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><img src="/favicon.svg" alt="" /> Office 3D</div>
        {offices && offices.length > 1 ? (
          <select className="input" style={{ width: 'auto' }} value={officeId ?? ''} onChange={(e) => setOfficeId(e.target.value)} aria-label="Andar">
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        ) : (
          <span className="office">{office ? `${office.building.name} · ${office.floor.name}` : ''}</span>
        )}
        <nav className="tabs" aria-label="Áreas">
          <button aria-pressed={current === 'ops'} onClick={() => setPage('ops')}>Operação</button>
          {user.role === 'admin' && <button aria-pressed={current === 'editor'} onClick={() => setPage('editor')}>Editor</button>}
          {user.role === 'admin' && <button aria-pressed={current === 'audit'} onClick={() => setPage('audit')}>Trilha</button>}
          {user.role === 'admin' && <button aria-pressed={current === 'integrations'} onClick={() => setPage('integrations')}>Integrações</button>}
          {user.role === 'admin' && <button aria-pressed={current === 'settings'} onClick={() => setPage('settings')} data-testid="nav-settings">Configurações</button>}
          <button aria-pressed={current === 'credits'} onClick={() => setPage('credits')}>Créditos</button>
        </nav>
        <div className="spacer" />
        {demoMode && <span className="badge-demo" title="Dados fictícios; conectores simulados">Demonstração</span>}
        <div className="user">
          <PresenceDemo user={user} demoMode={demoMode} />
          {user.employeeId ? <button className="btn small ghost" onClick={() => setPage('avatar')} title="Meu avatar" data-testid="my-avatar">{user.name}</button> : <span>{user.name}</span>}
          <span className="role">{ROLE_LABEL[user.role]}</span>
          <span className="muted">{user.companyName}</span>
          <button className="btn icon ghost" onClick={() => void logout()} aria-label="Sair" title="Sair"><LogOut size={16} /></button>
        </div>
      </header>
      {err && <div className="page"><div className="notice bad">{err}</div></div>}
      {!err && offices && !officeId && <div className="page"><div className="notice info">Nenhum andar cadastrado para esta empresa.</div></div>}
      <WorkspaceManager page={current} officeId={officeId} user={user} opsKey={opsKey} onEdit={(id) => { setPage('editor'); useEditor.getState().select([id]); }} onOfficeChanged={() => { setOpsKey((k) => k + 1); void loadOffices(); }} />
      {current === 'audit' && <AuditPage />}
      {current === 'integrations' && <IntegrationsPage demoMode={demoMode} />}
      {current === 'credits' && <CreditsPage />}
      {current === 'settings' && <SettingsPage />}
    </div>
  );
}

interface DemoAccounts {
  demoMode: boolean;
  password?: string;
  accounts: Array<{ email: string; label: string; name: string; role: string }>;
}

function Login({ onLogin }: { onLogin: (u: SessionUser, demo: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<DemoAccounts | null>(null);
  useEffect(() => {
    api.get<DemoAccounts>('/api/demo/accounts').then(setDemo, () => setDemo(null));
  }, []);
  const submit = async (em = email, pw = password) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ user: SessionUser }>('/api/auth/login', { email: em, password: pw });
      onLogin(r.user, !!demo?.demoMode);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login">
      <div className="card">
        <div className="brand" style={{ fontSize: 18 }}><img src="/favicon.svg" alt="" /> Office 3D</div>
        <p className="muted">Planta do escritório como interface operacional.</p>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="field"><span>E-mail</span><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="field"><span>Senha</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {err && <div className="notice bad" role="alert">{err}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
        {demo?.demoMode && (
          <div className="stack">
            <hr className="sep" />
            <div className="row" style={{ justifyContent: 'space-between' }}><h3>Contas fictícias</h3><span className="badge-demo">Demonstração</span></div>
            <div className="demo-accounts">
              {demo.accounts.map((a) => (
                <button key={a.email} className="btn" disabled={busy} onClick={() => void submit(a.email, demo.password ?? '')} data-account={a.role === 'admin' && a.email.includes('outra') ? 'other' : a.role}>
                  <span><b>{a.label}</b><br /><span className="muted">{a.email}</span></span>
                  <span className="muted">entrar →</span>
                </button>
              ))}
            </div>
            <p className="muted">Senha de todas: <span className="mono">{demo.password}</span>. Dados e conectores simulados.</p>
          </div>
        )}
      </div>
    </main>
  );
}
