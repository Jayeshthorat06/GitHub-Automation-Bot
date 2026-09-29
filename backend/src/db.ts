import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,

  max: 10,

  // Close idle connections after 30 seconds.
  idleTimeoutMillis: 30_000,

  // Don't wait forever if Neon cannot establish a connection.
  connectionTimeoutMillis: 10_000,

  // Helps detect broken TCP connections.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// IMPORTANT:
// Prevent an unexpected Neon connection termination from
// becoming an unhandled Node.js error.
pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]', {
    message: err.message,
    code: (err as { code?: string }).code,
  });
});

export async function query<T extends pg.QueryResultRow = any>(text: string, values: unknown[] = []): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function initDb() {
  await query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      github_id BIGINT UNIQUE NOT NULL,
      github_login TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);

    CREATE TABLE IF NOT EXISTS installations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      github_installation_id BIGINT UNIQUE NOT NULL,
      github_account_id BIGINT,
      account_login TEXT NOT NULL,
      account_type TEXT,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      github_repo_id BIGINT UNIQUE NOT NULL,
      installation_id UUID NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      private BOOLEAN NOT NULL DEFAULT false,
      connected BOOLEAN NOT NULL DEFAULT false,
      connected_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS repositories_installation_idx ON repositories(installation_id);

    CREATE TABLE IF NOT EXISTS rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      keyword TEXT,
      author TEXT,
      required_label TEXT,
      action_label TEXT,
      comment_template TEXT,
      slack_enabled BOOLEAN NOT NULL DEFAULT true,
      ai_enabled BOOLEAN NOT NULL DEFAULT true,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      delivery_id TEXT UNIQUE NOT NULL,
      installation_id UUID REFERENCES installations(id) ON DELETE SET NULL,
      repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
      github_repo_id BIGINT,
      event_name TEXT NOT NULL,
      action TEXT,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS events_status_idx ON events(status, received_at);

    CREATE TABLE IF NOT EXISTS actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      rule_id UUID REFERENCES rules(id) ON DELETE SET NULL,
      action_key TEXT UNIQUE,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS actions_event_idx ON actions(event_id, created_at DESC);
  `);
}
