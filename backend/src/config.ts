import 'dotenv/config';
import crypto from 'node:crypto';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8080),
  appBaseUrl: required('APP_BASE_URL').replace(/\/$/, ''),
  frontendUrl: required('FRONTEND_URL').replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  encryptionKey: required('APP_ENCRYPTION_KEY'),
  github: {
    appId: Number(required('GITHUB_APP_ID')),
    clientId: required('GITHUB_APP_CLIENT_ID'),
    clientSecret: required('GITHUB_APP_CLIENT_SECRET'),
    appName: required('GITHUB_APP_NAME'),
    privateKey: required('GITHUB_PRIVATE_KEY').replace(/\\n/g, '\n'),
    webhookSecret: required('GITHUB_WEBHOOK_SECRET')
  },
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN ?? '',
    channelId: process.env.SLACK_CHANNEL_ID ?? ''
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  }
};

if (!/^[a-fA-F0-9]{64}$/.test(config.encryptionKey)) {
  throw new Error('APP_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
}

export const encryptionKey = Buffer.from(config.encryptionKey, 'hex');

export function randomId(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}
