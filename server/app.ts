import express from 'express';
import { getDatabaseMode, initDatabase } from './db';
import { DatabaseConfigError } from './dbClient';
import { isSupabaseConfigured } from './services/supabaseAuth';
import { authRouter } from './routes/authRoutes';
import { coreRouter } from './routes/coreRoutes';
import { payrollRouter } from './routes/payrollRoutes';
import { workforceRouter } from './routes/workforceRoutes';
import { opsRouter } from './routes/opsRoutes';
import { platformRouter, publicApiV1Router } from './routes/platformRoutes';

declare global {
  var _nexusExpressApp: express.Express | undefined;
}

export function createApp(): express.Express {
  if (globalThis._nexusExpressApp) {
    return globalThis._nexusExpressApp;
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

  // Health endpoint placed BEFORE database middleware so diagnostics work even if DB env is misconfigured
  app.get('/api/health', async (_req, res) => {
    let databaseReady = false;
    let databaseErrorCode: string | null = null;
    try {
      await initDatabase();
      databaseReady = true;
    } catch (err) {
      databaseReady = false;
      databaseErrorCode =
        err instanceof DatabaseConfigError ? err.code : 'database_connection_failed';
    }

    res.status(databaseReady ? 200 : 503).json({
      ok: databaseReady,
      service: 'nexus-hrm',
      framework: 'next.js',
      databaseMode: getDatabaseMode(),
      databaseReady,
      databaseErrorCode,
      supabaseAuthEnabled: isSupabaseConfigured(),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      timestamp: new Date().toISOString(),
    });
  });

  // Ensure PostgreSQL or SQLite schema + seed are initialized before handling API routes
  app.use(async (_req, _res, next) => {
    try {
      await initDatabase();
      next();
    } catch (err) {
      next(err);
    }
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
    console.error('[Nexus HRM API Error]', err.name, err.message);
    if (res.headersSent) return;
    if (err instanceof DatabaseConfigError) {
      res.status(503).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: 'An unexpected server error occurred. Check /api/health and server logs.' });
  });

  globalThis._nexusExpressApp = app;
  return app;
}
