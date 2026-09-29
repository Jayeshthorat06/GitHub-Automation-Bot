import crypto from 'node:crypto';
import { encryptionKey } from './config.js';

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function timingSafeHexEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function encrypt(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decrypt(value: string): string {
  const [ivRaw, tagRaw, encryptedRaw] = value.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64url')), decipher.final()]).toString('utf8');
}

export function verifyGithubSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeHexEqual(signature.slice(7), expected);
}
