import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cookieParser from 'cookie-parser';

import { initDb } from './db.js';
import { config } from './config.js';
import { router } from './routes.js';
import { githubWebhook } from './webhook.js';
import { startWorker } from './processor.js';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Cookie parser MUST come before routes
app.use(cookieParser());

// GitHub webhook must receive raw body
app.post(
  '/api/github/webhook',
  express.raw({
    type: 'application/json',
    limit: '2mb',
  }),
  (req, res, next) => {
    githubWebhook(req, res).catch(next);
  }
);

// Normal JSON APIs
app.use(
  express.json({
    limit: '1mb',
  })
);

// API + OAuth routes
app.use(router);

// Serve React frontend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDist = path.resolve(
  __dirname,
  '../../frontend/dist'
);

console.log(
  JSON.stringify({
    component: 'frontend',
    frontendDist,
  })
);

app.use(express.static(frontendDist));

// React SPA fallback
app.get('*splat', (req, res, next) => {
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/auth/')
  ) {
    return next();
  }

  res.sendFile(
    path.join(frontendDist, 'index.html')
  );
});

// Global error handler
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(
      JSON.stringify({
        component: 'http',
        error: err?.message,
        stack: err?.stack,
      })
    );

    if (res.headersSent) {
      return;
    }

    res.status(500).json({
      error: 'Internal server error',
    });
  }
);

await initDb();

app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      component: 'server',
      port: config.port,
      env: config.nodeEnv,
    })
  );
});

startWorker();