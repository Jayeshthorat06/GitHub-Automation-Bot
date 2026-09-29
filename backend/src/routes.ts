import { Router } from 'express';
import { randomId } from './config.js';
import { query } from './db.js';
import { createSession, authMiddleware, destroySession } from './session.js';
import { exchangeUserCode, getAuthenticatedUser, getInstallation, listInstallationRepositories } from './github.js';
import { sendSlack } from './slack.js';

export const router = Router();

router.get('/health', async (_req, res) => {
  try { await query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

router.get('/auth/github', async (req, res, next) => {
  try {
    const state = randomId(24);
    await query(`INSERT INTO oauth_states(state,purpose,expires_at) VALUES($1,'login',NOW()+INTERVAL '10 minutes')`, [state]);
    const redirect = `${process.env.APP_BASE_URL!.replace(/\/$/, '')}/auth/github/callback`;
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', process.env.GITHUB_APP_CLIENT_ID!);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  } catch (e) { next(e); }
});

router.get('/auth/github/callback', async (req, res, next) => {
  try {
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');

    if (!code || !state) {
      return res.status(400).send(
        'Missing GitHub OAuth parameters. Please start login again.',
      );
    }

    console.log(
      JSON.stringify({
        component: 'oauth',
        step: 'callback_received',
      }),
    );

    const stateRow = await query<any>(
      `DELETE FROM oauth_states
       WHERE state = $1
         AND purpose = 'login'
         AND expires_at > NOW()
       RETURNING state`,
      [state],
    );

    if (!stateRow.rowCount) {
      return res.status(400).send(
        'Invalid or expired OAuth state. Please start GitHub login again.',
      );
    }

    const redirect =
      `${process.env.APP_BASE_URL!.replace(/\/$/, '')}` +
      `/auth/github/callback`;

    console.log(
      JSON.stringify({
        component: 'oauth',
        step: 'exchanging_code',
      }),
    );

    const token = await exchangeUserCode(
      code,
      redirect,
    );

    console.log(
      JSON.stringify({
        component: 'oauth',
        step: 'token_received',
      }),
    );

    const ghUser =
      await getAuthenticatedUser(
        token.access_token,
      );

    console.log(
      JSON.stringify({
        component: 'oauth',
        step: 'github_user_received',
        githubLogin: ghUser.login,
      }),
    );

    const user = await query<any>(
      `INSERT INTO users(
         github_id,
         github_login,
         name,
         avatar_url
       )
       VALUES($1, $2, $3, $4)
       ON CONFLICT(github_id)
       DO UPDATE SET
         github_login = EXCLUDED.github_login,
         name = EXCLUDED.name,
         avatar_url = EXCLUDED.avatar_url,
         updated_at = NOW()
       RETURNING *`,
      [
        ghUser.id,
        ghUser.login,
        ghUser.name,
        ghUser.avatar_url,
      ],
    );

    await createSession(
      user.rows[0].id,
      res,
    );

    console.log(
      JSON.stringify({
        component: 'oauth',
        step: 'login_success',
        githubLogin: ghUser.login,
      }),
    );

    return res.redirect('/');
  } catch (error: any) {
    console.error(
      JSON.stringify({
        component: 'oauth',
        step: 'callback_failed',
        code: error?.code,
        status: error?.response?.status,
        message: error?.message,
      }),
    );

    return next(error);
  }
});

router.get('/auth/github/setup', authMiddleware, async (req, res, next) => {
  try {
    const installationId = Number(req.query.installation_id);
    const setupAction = String(req.query.setup_action ?? 'install');
    const state = String(req.query.state ?? '');
    if (!Number.isInteger(installationId) || !state) return res.status(400).send('Invalid installation callback');
    const stateRow = await query<any>(`SELECT user_id FROM oauth_states WHERE state=$1 AND purpose='install' AND expires_at>NOW()`, [state]);
    if (!stateRow.rowCount || stateRow.rows[0].user_id !== (req as any).user.id) return res.status(403).send('Invalid installation state');
    await query('DELETE FROM oauth_states WHERE state=$1', [state]);

    const installation = await getInstallation(installationId);
    const account = installation.account;
    await query(`INSERT INTO installations(github_installation_id,github_account_id,account_login,account_type,user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(github_installation_id) DO UPDATE SET github_account_id=EXCLUDED.github_account_id,account_login=EXCLUDED.account_login,account_type=EXCLUDED.account_type,user_id=EXCLUDED.user_id,updated_at=NOW()`, [installationId, account?.id ?? null, account?.login ?? account?.slug ?? 'unknown', account?.type ?? null, (req as any).user.id]);
    const inst = await query<any>('SELECT id FROM installations WHERE github_installation_id=$1', [installationId]);
    const repos = await listInstallationRepositories(installationId);
    for (const repo of repos) {
      await query(`INSERT INTO repositories(github_repo_id,installation_id,owner,name,full_name,private) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(github_repo_id) DO UPDATE SET installation_id=EXCLUDED.installation_id,owner=EXCLUDED.owner,name=EXCLUDED.name,full_name=EXCLUDED.full_name,private=EXCLUDED.private,updated_at=NOW()`, [repo.id, inst.rows[0].id, repo.owner.login, repo.name, repo.full_name, repo.private]);
    }
    res.redirect(`${process.env.FRONTEND_URL}/?installed=${encodeURIComponent(setupAction)}`);
  } catch (e) { next(e); }
});

router.get('/api/me', authMiddleware, (req, res) => {
  const u = (req as any).user;
  res.json({ id: u.id, githubLogin: u.github_login, name: u.name, avatarUrl: u.avatar_url });
});

router.post('/api/logout', authMiddleware, async (req, res, next) => {
  try { await destroySession(req, res); res.json({ ok: true }); } catch (e) { next(e); }
});

router.get('/api/github/install-url', authMiddleware, async (req, res, next) => {
  try {
    const state = randomId(24);
    await query(`INSERT INTO oauth_states(state,user_id,purpose,expires_at) VALUES($1,$2,'install',NOW()+INTERVAL '15 minutes')`, [state, (req as any).user.id]);
    const url = new URL(`https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_NAME!)}/installations/new`);
    url.searchParams.set('state', state);
    res.json({ url: url.toString() });
  } catch (e) { next(e); }
});

router.get('/api/repositories', authMiddleware, async (req, res, next) => {
  try {
    const rows = await query<any>(`SELECT r.id,r.github_repo_id,r.full_name,r.private,r.connected,i.account_login FROM repositories r JOIN installations i ON i.id=r.installation_id WHERE i.user_id=$1 ORDER BY r.full_name`, [(req as any).user.id]);
    res.json(rows.rows);
  } catch (e) { next(e); }
});

router.post('/api/repositories/:id/connect', authMiddleware, async (req, res, next) => {
  try {
    const repo = await query<any>(`SELECT r.* FROM repositories r JOIN installations i ON i.id=r.installation_id WHERE r.id=$1 AND i.user_id=$2`, [req.params.id, (req as any).user.id]);
    if (!repo.rowCount) return res.status(404).json({ error: 'Repository not found' });
    await query('UPDATE repositories SET connected=true,connected_by_user_id=$1,updated_at=NOW() WHERE id=$2', [(req as any).user.id, req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/api/rules', authMiddleware, async (req, res, next) => {
  try {
    const rows = await query<any>(`SELECT r.*,repo.full_name FROM rules r JOIN repositories repo ON repo.id=r.repository_id JOIN installations i ON i.id=repo.installation_id WHERE i.user_id=$1 ORDER BY r.created_at DESC`, [(req as any).user.id]);
    res.json(rows.rows);
  } catch (e) { next(e); }
});

router.post('/api/rules', authMiddleware, async (req, res, next) => {
  try {
    const { repositoryId, name, eventType, keyword, author, requiredLabel, actionLabel, commentTemplate, slackEnabled, aiEnabled } = req.body ?? {};
    if (!repositoryId || !name || !eventType) return res.status(400).json({ error: 'repositoryId, name and eventType are required' });
    const repo = await query<any>(`SELECT r.id FROM repositories r JOIN installations i ON i.id=r.installation_id WHERE r.id=$1 AND i.user_id=$2 AND r.connected=true`, [repositoryId, (req as any).user.id]);
    if (!repo.rowCount) return res.status(404).json({ error: 'Connected repository not found' });
    const row = await query<any>(`INSERT INTO rules(user_id,repository_id,name,event_type,keyword,author,required_label,action_label,comment_template,slack_enabled,ai_enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [(req as any).user.id, repositoryId, name, eventType, keyword || null, author || null, requiredLabel || null, actionLabel || null, commentTemplate || null, slackEnabled !== false, aiEnabled !== false]);
    res.status(201).json(row.rows[0]);
  } catch (e) { next(e); }
});

router.delete('/api/rules/:id', authMiddleware, async (req, res, next) => {
  try {
    await query(`DELETE FROM rules r USING repositories repo, installations i WHERE r.id=$1 AND r.repository_id=repo.id AND repo.installation_id=i.id AND i.user_id=$2`, [req.params.id, (req as any).user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get('/api/events', authMiddleware, async (req, res, next) => {
  try {
    const rows = await query<any>(`SELECT e.id,e.delivery_id,e.event_name,e.action,e.status,e.attempts,e.last_error,e.received_at,e.processed_at,repo.full_name, COALESCE(json_agg(json_build_object('type',a.type,'status',a.status,'details',a.details,'createdAt',a.created_at) ORDER BY a.created_at DESC) FILTER (WHERE a.id IS NOT NULL),'[]') actions FROM events e LEFT JOIN repositories repo ON repo.id=e.repository_id LEFT JOIN installations i ON i.id=repo.installation_id LEFT JOIN actions a ON a.event_id=e.id WHERE i.user_id=$1 GROUP BY e.id,repo.full_name ORDER BY e.received_at DESC LIMIT 100`, [(req as any).user.id]);
    res.json(rows.rows);
  } catch (e) { next(e); }
});

router.post('/api/slack/test', authMiddleware, async (_req, res, next) => {
  try { await sendSlack('✅ GitHub Automation Bot Slack connection test succeeded.'); res.json({ ok: true }); }
  catch (e) { next(e); }
});
