import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const api = async (url: string, options: RequestInit = {}) => {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }

  return response.json();
};

type Repo = {
  id: string;
  full_name: string;
  private: boolean;
  connected: boolean;
  account_login: string;
};

type Rule = {
  id: string;
  name: string;
  event_type: string;
  keyword?: string;
  author?: string;
  required_label?: string;
  action_label?: string;
  comment_template?: string;
  slack_enabled: boolean;
  ai_enabled: boolean;
  full_name: string;
};

type EventRow = {
  id: string;
  event_name: string;
  action?: string;
  status: string;
  attempts: number;
  last_error?: string;
  received_at: string;
  full_name?: string;
  actions: { type: string; status: string }[];
};

function Login() {
  return (
    <div className="center">
      <div className="card login">
        <div className="logo">GH</div>

        <h1>GitHub Automation Bot</h1>

        <p>
          Connect a repository, react to GitHub events,
          automate GitHub actions, and notify Slack.
        </p>

        <a className="button" href="/auth/github">
          Continue with GitHub
        </a>

        <small>
          GitHub handles your password. This app receives only
          the authorization required for the integration.
        </small>
      </div>
    </div>
  );
}

function App() {
  const [me, setMe] = React.useState<any>(null);
  const [repos, setRepos] = React.useState<Repo[]>([]);
  const [rules, setRules] = React.useState<Rule[]>([]);
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [ruleForm, setRuleForm] = React.useState({ repositoryId: '', name: 'Bug triage', eventType: 'issues', keyword: 'bug', author: '', requiredLabel: '', actionLabel: 'bug', commentTemplate: 'Thanks {{author}}. This item was automatically triaged by the bot.', slackEnabled: true, aiEnabled: true });

  const load = React.useCallback(async () => {
    try {
      const [user, r, rl, ev] = await Promise.all([api('/api/me'), api('/api/repositories'), api('/api/rules'), api('/api/events')]);
      setMe(user); setRepos(r); setRules(rl); setEvents(ev);
      if (!ruleForm.repositoryId && r.find((x: Repo) => x.connected)) setRuleForm(f => ({ ...f, repositoryId: r.find((x: Repo) => x.connected)!.id }));
    } catch (e: any) {
      if (e.message === 'Authentication required' || e.message === 'Session expired') setMe(null); else setError(e.message);
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { if (!me) return; const id = setInterval(() => void load(), 5000); return () => clearInterval(id); }, [me, load]);

  if (loading) return <div className="center"><div className="spinner" /></div>;
  if (!me) return <Login />;

  async function install() {
    const data = await api('/api/github/install-url');
    window.location.href = data.url;
  }
  async function connect(id: string) { await api(`/api/repositories/${id}/connect`, { method: 'POST' }); await load(); }
  async function addRule(e: React.FormEvent) { e.preventDefault(); try { await api('/api/rules', { method: 'POST', body: JSON.stringify(ruleForm) }); await load(); } catch (e: any) { setError(e.message); } }
  async function deleteRule(id: string) { await api(`/api/rules/${id}`, { method: 'DELETE' }); await load(); }
  async function logout() { await api('/api/logout', { method: 'POST' }); setMe(null); }
  async function slackTest() { try { await api('/api/slack/test', { method: 'POST' }); alert('Slack test sent.'); } catch (e: any) { setError(e.message); } }

  const connected = repos.filter(r => r.connected);
  return <div className="app">
    <header><div><b>GitHub Automation Bot</b><span className="muted">Event-driven repository automation</span></div><div className="user"><img src={me.avatarUrl} /><span>{me.githubLogin}</span><button className="ghost" onClick={logout}>Logout</button></div></header>
    {error && <div className="error">{error}<button onClick={() => setError('')}>×</button></div>}
    <main>
      <section className="hero"><div><h2>Automation dashboard</h2><p>Watch webhook events, connect repositories, and configure rules without hard-coding behavior.</p></div><button className="button" onClick={install}>+ Connect GitHub repository</button></section>
      <section className="grid two">
        <div className="card"><div className="sectionTitle"><h3>Repositories</h3><span>{repos.length}</span></div>{repos.length === 0 && <p className="muted">No GitHub App installation yet.</p>}{repos.map(r => <div className="row" key={r.id}><div><b>{r.full_name}</b><small>{r.private ? 'Private' : 'Public'} · {r.account_login}</small></div>{r.connected ? <span className="pill success">Connected</span> : <button className="smallButton" onClick={() => connect(r.id)}>Connect</button>}</div>)}</div>
        <div className="card"><div className="sectionTitle"><h3>Slack</h3></div><p className="muted">Notifications use a Slack bot token and channel configured on the server.</p><button className="smallButton" onClick={slackTest}>Send test notification</button></div>
      </section>
      <section className="card"><div className="sectionTitle"><h3>Create rule</h3><span>Configurable</span></div>{connected.length === 0 ? <p className="muted">Connect a repository first.</p> : <form onSubmit={addRule} className="form"><label>Repository<select value={ruleForm.repositoryId} onChange={e => setRuleForm({ ...ruleForm, repositoryId: e.target.value })}>{connected.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}</select></label><label>Rule name<input value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} /></label><label>Event<select value={ruleForm.eventType} onChange={e => setRuleForm({ ...ruleForm, eventType: e.target.value })}><option value="issues">Issues</option><option value="pull_request">Pull requests</option><option value="push">Push</option><option value="*">Any supported event</option></select></label><label>Keyword<input value={ruleForm.keyword} onChange={e => setRuleForm({ ...ruleForm, keyword: e.target.value })} placeholder="bug" /></label><label>Author (optional)<input value={ruleForm.author} onChange={e => setRuleForm({ ...ruleForm, author: e.target.value })} placeholder="octocat" /></label><label>Required label (optional)<input value={ruleForm.requiredLabel} onChange={e => setRuleForm({ ...ruleForm, requiredLabel: e.target.value })} placeholder="triage" /></label><label>Label to add<input value={ruleForm.actionLabel} onChange={e => setRuleForm({ ...ruleForm, actionLabel: e.target.value })} placeholder="bug" /></label><label className="wide">Comment template<textarea value={ruleForm.commentTemplate} onChange={e => setRuleForm({ ...ruleForm, commentTemplate: e.target.value })} /></label><label className="check"><input type="checkbox" checked={ruleForm.slackEnabled} onChange={e => setRuleForm({ ...ruleForm, slackEnabled: e.target.checked })} /> Slack notification</label><label className="check"><input type="checkbox" checked={ruleForm.aiEnabled} onChange={e => setRuleForm({ ...ruleForm, aiEnabled: e.target.checked })} /> AI triage</label><div><button className="button">Save rule</button></div></form>}</section>
      <section className="card"><div className="sectionTitle"><h3>Rules</h3><span>{rules.length}</span></div>{rules.length === 0 && <p className="muted">No rules configured.</p>}{rules.map(r => <div className="row" key={r.id}><div><b>{r.name}</b><small>{r.full_name} · {r.event_type}{r.keyword ? ` · keyword: ${r.keyword}` : ''}{r.action_label ? ` · add label: ${r.action_label}` : ''}</small></div><button className="danger" onClick={() => deleteRule(r.id)}>Delete</button></div>)}</section>
      <section className="card"><div className="sectionTitle"><h3>Live event & action log</h3><span>Auto-refresh 5s</span></div>{events.length === 0 && <p className="muted">No webhook events recorded yet. Push, open an issue, or open a PR in a connected repository.</p>}{events.map(e => <div className="event" key={e.id}><div className="eventTop"><b>{e.event_name}{e.action ? ` / ${e.action}` : ''}</b><span className={`pill ${e.status === 'processed' ? 'success' : e.status === 'failed' ? 'dangerPill' : 'pending'}`}>{e.status}</span></div><small>{e.full_name ?? 'Unconnected repository'} · {new Date(e.received_at).toLocaleString()} · attempts {e.attempts}</small>{e.last_error && <div className="failure">{e.last_error}</div>}{e.actions?.length > 0 && <div className="actions">{e.actions.map((a, i) => <span key={i}>{a.type}: {a.status}</span>)}</div>}</div>)}</section>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
