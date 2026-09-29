import type { Request, Response, NextFunction } from 'express';
import { query } from './db.js';
import { sha256 } from './security.js';
import { randomId } from './config.js';

const COOKIE = 'ghbot_session';
const DAYS = 7;

export async function createSession(
  userId: string,
  res: Response
) {
  const raw = randomId(32);
  const tokenHash = sha256(raw);

  // Remove old sessions for this user
  // and expired sessions.
  await query(
    `DELETE FROM sessions
     WHERE user_id = $1
        OR expires_at < NOW()`,
    [userId]
  );

  // Create new session
  await query(
    `INSERT INTO sessions(
       user_id,
       token_hash,
       expires_at
     )
     VALUES(
       $1,
       $2,
       NOW() + INTERVAL '7 days'
     )`,
    [userId, tokenHash]
  );

  res.cookie(COOKIE, raw, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });

  console.log(
    JSON.stringify({
      component: 'session',
      action: 'created',
      userId,
    })
  );
}

export async function destroySession(
  req: Request,
  res: Response
) {
  const raw = req.cookies?.[COOKIE];

  if (raw) {
    await query(
      `DELETE FROM sessions
       WHERE token_hash = $1`,
      [sha256(raw)]
    );
  }

  res.clearCookie(COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const raw = req.cookies?.[COOKIE];

    if (!raw) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const result = await query<any>(
      `SELECT u.*
       FROM sessions s
       JOIN users u
         ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.expires_at > NOW()`,
      [sha256(raw)]
    );

    if (!result.rowCount) {
      return res.status(401).json({
        error: 'Session expired',
      });
    }

    (req as any).user = result.rows[0];

    next();
  } catch (err) {
    next(err);
  }
}