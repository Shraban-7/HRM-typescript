import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from './server/app';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = createApp();
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
