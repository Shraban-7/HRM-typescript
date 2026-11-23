import express from 'express';
import { initDatabase } from './db';
import { authRouter } from './routes/authRoutes';
import { coreRouter } from './routes/coreRoutes';
import { payrollRouter } from './routes/payrollRoutes';
import { workforceRouter } from './routes/workforceRoutes';
import { opsRouter } from './routes/opsRoutes';
import { platformRouter, publicApiV1Router } from './routes/platformRoutes';

let initialized = false;

export function createApp(): express.Express {
  if (!initialized) {
    initDatabase();
    initialized = true;
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  // Security headers (iframe-compatible: no X-Frame-Options)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'nexus-hrm', timestamp: new Date().toISOString() });
  });

  // Mount API route modules
  app.use('/api/auth', authRouter);
  app.use('/api', workforceRouter);
  app.use('/api', coreRouter);
  app.use('/api', payrollRouter);
  app.use('/api', opsRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api/v1', publicApiV1Router);

  // API 404 fallback
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Nexus HRM API Error]', err.message);
    res.status(500).json({ error: 'An unexpected server error occurred.' });
  });

  return app;
}
