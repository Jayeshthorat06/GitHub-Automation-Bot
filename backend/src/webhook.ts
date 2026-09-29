import type { Request, Response } from 'express';
import { query } from './db.js';
import { verifyGithubSignature } from './security.js';

export async function githubWebhook(req: Request, res: Response) {
  const raw = req.body as Buffer;
  const signature = req.header('x-hub-signature-256');
  if (!verifyGithubSignature(raw, signature, process.env.GITHUB_WEBHOOK_SECRET!)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  const deliveryId = req.header('x-github-delivery');
  const eventName = req.header('x-github-event');
  if (!deliveryId || !eventName) return res.status(400).json({ error: 'Missing GitHub delivery headers' });

  let payload: any;
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const installationId = payload.installation?.id ? Number(payload.installation.id) : null;
  const repoGithubId = payload.repository?.id ? Number(payload.repository.id) : null;
  const action = payload.action ?? null;

  const result = await query<any>(`INSERT INTO events(delivery_id,installation_id,repository_id,github_repo_id,event_name,action,payload) VALUES($1,(SELECT id FROM installations WHERE github_installation_id=$2),(SELECT id FROM repositories WHERE github_repo_id=$3),$4,$5,$6,$7) ON CONFLICT(delivery_id) DO NOTHING RETURNING id`, [deliveryId, installationId, repoGithubId, repoGithubId, eventName, action, payload]);
  res.status(result.rowCount ? 202 : 200).json({ accepted: true, duplicate: !result.rowCount });
}
