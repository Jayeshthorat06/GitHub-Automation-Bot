import { query } from './db.js';
import { addComment, addLabel } from './github.js';
import { sendSlack } from './slack.js';
import { triageWithGemini } from './ai.js';

type Rule = {
  id: string; name: string; event_type: string; keyword: string | null; author: string | null;
  required_label: string | null; action_label: string | null; comment_template: string | null;
  slack_enabled: boolean; ai_enabled: boolean; enabled: boolean;
};

function normalize(v: unknown): string { return String(v ?? '').toLowerCase(); }

function getContext(eventName: string, payload: any) {
  if (eventName === 'issues') {
    return {
      title: payload.issue?.title ?? '', body: payload.issue?.body ?? '',
      author: payload.issue?.user?.login ?? '', number: payload.issue?.number,
      labels: (payload.issue?.labels ?? []).map((x: any) => typeof x === 'string' ? x : x.name),
      url: payload.issue?.html_url ?? '', type: 'issue'
    };
  }
  if (eventName === 'pull_request') {
    return {
      title: payload.pull_request?.title ?? '', body: payload.pull_request?.body ?? '',
      author: payload.pull_request?.user?.login ?? '', number: payload.pull_request?.number,
      labels: (payload.pull_request?.labels ?? []).map((x: any) => typeof x === 'string' ? x : x.name),
      url: payload.pull_request?.html_url ?? '', type: 'pull_request'
    };
  }
  if (eventName === 'push') {
    const commits = payload.commits ?? [];
    return {
      title: commits[0]?.message?.split('\n')[0] ?? 'Code push',
      body: commits.map((c: any) => c.message).join('\n'),
      author: payload.pusher?.name ?? payload.sender?.login ?? '', number: undefined,
      labels: [], url: payload.compare ?? payload.repository?.html_url ?? '', type: 'push'
    };
  }
  return { title: '', body: '', author: payload.sender?.login ?? '', number: undefined, labels: [], url: '', type: eventName };
}

function matches(rule: Rule, eventName: string, action: string | null, ctx: ReturnType<typeof getContext>): boolean {
  if (!rule.enabled) return false;
  if (rule.event_type !== '*' && rule.event_type !== eventName) return false;
  if (eventName === 'issues' && !['opened', 'edited', 'reopened'].includes(action ?? '')) return false;
  if (eventName === 'pull_request' && !['opened', 'reopened', 'synchronize'].includes(action ?? '')) return false;
  if (rule.keyword) {
    const haystack = `${ctx.title}\n${ctx.body}`.toLowerCase();
    if (!haystack.includes(rule.keyword.toLowerCase())) return false;
  }
  if (rule.author && normalize(rule.author) !== normalize(ctx.author)) return false;
  if (rule.required_label && !ctx.labels.some((x: string) => normalize(x) === normalize(rule.required_label))) return false;
  return true;
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? '');
}

async function recordAction(eventId: string, ruleId: string | null, type: string, actionKey: string, fn: () => Promise<any>) {
  const inserted = await query<{ id: string }>(`INSERT INTO actions(event_id,rule_id,action_key,type,status) VALUES($1,$2,$3,$4,'pending') ON CONFLICT(action_key) DO UPDATE SET status='pending', details=NULL WHERE actions.status='failed' RETURNING id`, [eventId, ruleId, actionKey, type]);
  if (!inserted.rowCount) return { skipped: true };
  try {
    const details = await fn();
    await query('UPDATE actions SET status=$1, details=$2 WHERE id=$3', ['success', JSON.stringify(details ?? {}), inserted.rows[0].id]);
    return { success: true, details };
  } catch (error: any) {
    await query('UPDATE actions SET status=$1, details=$2 WHERE id=$3', ['failed', JSON.stringify({ error: error.message }), inserted.rows[0].id]);
    throw error;
  }
}

async function processEvent(row: any) {
  const payload = row.payload;
  const eventName = row.event_name;
  const ctx = getContext(eventName, payload);
  const repo = row.repository_id ? (await query<any>('SELECT r.*, i.github_installation_id, i.user_id FROM repositories r JOIN installations i ON i.id=r.installation_id WHERE r.id=$1', [row.repository_id])).rows[0] : null;
  if (!repo || !repo.connected) {
    await query('UPDATE events SET status=$1, processed_at=NOW(), last_error=$2 WHERE id=$3', ['ignored', 'Repository is not connected in the dashboard', row.id]);
    return;
  }

  const rules = (await query<Rule>('SELECT * FROM rules WHERE repository_id=$1 AND enabled=true ORDER BY created_at', [repo.id])).rows;
  const matching = rules.filter((rule: Rule) => matches(rule, eventName, row.action, ctx));
  let ai: any = null;
  for (const rule of matching) {
    if (rule.ai_enabled && (eventName === 'issues' || eventName === 'pull_request')) {
      ai ??= await triageWithGemini({ title: ctx.title, body: ctx.body, author: ctx.author, event: ctx.type });
    }
    const aiText = ai ? `\n\nAI triage: ${ai.summary}\nSuggested label: ${ai.suggestedLabel}\nPriority: ${ai.priority}` : '';
    const baseVars = { title: ctx.title, body: ctx.body, author: ctx.author, repo: repo.full_name, number: String(ctx.number ?? ''), url: ctx.url };

    if (rule.action_label && ctx.number && (eventName === 'issues' || eventName === 'pull_request')) {
      await recordAction(row.id, rule.id, 'github_label', `${row.delivery_id}:label:${rule.id}:${rule.action_label}`, () => addLabel(repo.github_installation_id, repo.owner, repo.name, ctx.number!, rule.action_label!));
    }

    if (rule.comment_template && ctx.number && (eventName === 'issues' || eventName === 'pull_request')) {
      const body = `${renderTemplate(rule.comment_template, baseVars)}${aiText}\n\n<!-- github-automation:${row.delivery_id}:${rule.id} -->`;
      await recordAction(row.id, rule.id, 'github_comment', `${row.delivery_id}:comment:${rule.id}`, async () => {
        // If the same event is retried after a worker crash, avoid adding the same bot comment twice.
        const existing = await findExistingComment(repo.github_installation_id, repo.owner, repo.name, ctx.number!, `github-automation:${row.delivery_id}:${rule.id}`);
        if (existing) return { skipped: true, reason: 'comment already exists' };
        return addComment(repo.github_installation_id, repo.owner, repo.name, ctx.number!, body);
      });
    }

    if (rule.slack_enabled) {
      const text = `GitHub ${eventName}${row.action ? `/${row.action}` : ''}: ${repo.full_name}\n${ctx.title}\nAuthor: ${ctx.author}${ctx.url ? `\n${ctx.url}` : ''}${aiText}`;
      await recordAction(row.id, rule.id, 'slack', `${row.delivery_id}:slack:${rule.id}`, () => sendSlack(text));
    }
  }

  if (matching.length === 0) {
    await query('INSERT INTO actions(event_id,type,status,details,action_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(action_key) DO NOTHING', [row.id, 'rule_evaluation', 'success', JSON.stringify({ matched: 0 }), `${row.delivery_id}:rules:none`]);
  }

  await query('UPDATE events SET status=$1, processed_at=NOW(), last_error=NULL WHERE id=$2', ['processed', row.id]);
}

async function findExistingComment(installationId: number, owner: string, repo: string, issueNumber: number, marker: string) {
  // The comments endpoint is intentionally called only for a retry path; normal processing does not need it.
  const { createInstallationToken } = await import('./github.js');
  const { default: axios } = await import('axios');
  const token = await createInstallationToken(installationId);
  const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    params: { per_page: 100 },
    headers: { Authorization: `Bearer ${token.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' }
  });
  return response.data.find((c: any) => String(c.body ?? '').includes(marker));
}

export async function runWorkerOnce() {
  const { pool } = await import('./db.js');

  const client = await pool.connect();

  let row: any;

  try {
    await client.query('BEGIN');

    const result = await client.query(`
      SELECT *
      FROM events
      WHERE status = 'pending'
        AND attempts < 5
      ORDER BY received_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    // IMPORTANT:
    // Even when there is no pending event, the connection
    // must be released in the finally block.
    if (!result.rowCount) {
      await client.query('COMMIT');
      return false;
    }

    row = result.rows[0];

    await client.query(
      `
      UPDATE events
      SET status = 'processing',
          attempts = attempts + 1
      WHERE id = $1
      `,
      [row.id]
    );

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError: any) {
      console.error(
        JSON.stringify({
          component: 'worker',
          error: 'Rollback failed',
          message: rollbackError?.message,
        })
      );
    }

    throw error;
  } finally {
    // ALWAYS return the connection to the pool.
    client.release();
  }

  try {
    await processEvent(row);
  } catch (error: any) {
    const attempts = row.attempts + 1;
    const terminal = attempts >= 5;

    await query(
      `
      UPDATE events
      SET status = $1,
          last_error = $2
      WHERE id = $3
      `,
      [
        terminal ? 'failed' : 'pending',
        String(error?.message ?? error).slice(0, 4000),
        row.id,
      ]
    );
  }

  return true;
}

export function startWorker() {
  let running = false;

  const timer = setInterval(async () => {
    if (running) {
      return;
    }

    running = true;

    try {
      await runWorkerOnce();
    } catch (err: any) {
      console.error(
        JSON.stringify({
          component: 'worker',
          error: err?.message ?? String(err),
        })
      );
    } finally {
      running = false;
    }
  }, 2500);

  return () => clearInterval(timer);
}
