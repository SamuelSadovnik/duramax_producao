/**
 * Servidor local: API em http://localhost:3001/api.
 * Em desenvolvimento o Vite (5173) encaminha /api para cá.
 * Depois de `npm run build`, também serve a interface pronta de dist/ (npm run preview).
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import { app } from './app.js';

const raiz = new Hono();
raiz.route('/', app);
if (existsSync('dist/index.html')) {
  raiz.use('/*', serveStatic({ root: './dist' }));
  raiz.get('*', serveStatic({ path: './dist/index.html' }));
}

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: raiz.fetch, port }, () => console.log(`API em http://localhost:${port}/api`));
