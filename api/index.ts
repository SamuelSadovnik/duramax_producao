/**
 * Função da Vercel: todas as rotas /api/* chegam aqui (ver rewrites no vercel.json).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '@hono/node-server/vercel';
import { app } from '../server/app.js';

export const config = { api: { bodyParser: false } };

const h = handle(app);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // O rewrite manda /api/xyz para /api?__rota=xyz; restaura o caminho original.
  const u = new URL(req.url ?? '/', 'http://local');
  const rota = u.searchParams.get('__rota');
  if (rota !== null && (u.pathname === '/api' || u.pathname === '/api/')) {
    u.searchParams.delete('__rota');
    req.url = `/api/${rota}${u.search}`;
  }
  return h(req, res);
}
