import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { initDatabase } from './server/db';
import { authRouter } from './server/routes/authRoutes';
import { coreRouter } from './server/routes/coreRoutes';
import { payrollRouter } from './server/routes/payrollRoutes';
import { workforceRouter } from './server/routes/workforceRoutes';
import { opsRouter } from './server/routes/opsRoutes';
import { platformRouter, publicApiV1Router } from './server/routes/platformRoutes';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

initDatabase();

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

async function startServer() {
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Nexus HRM server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
