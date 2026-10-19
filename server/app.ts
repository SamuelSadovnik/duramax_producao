import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ErroRegra } from '../shared/engine.js';
import { db } from './db.js';
import { type Vars } from './auth.js';
import { rotasAuth } from './rotas/auth.js';
import { rotasUsuarios } from './rotas/usuarios.js';
import { rotasEstado } from './rotas/estado.js';
import { rotasPedidos } from './rotas/pedidos.js';
import { rotasOps } from './rotas/ops.js';
import { rotasCadastros } from './rotas/cadastros.js';

export const app = new Hono<{ Variables: Vars }>().basePath('/api');

// Proteção contra CSRF: alterações só aceitam JSON (um formulário de outro site não consegue enviar JSON sem CORS).
app.use('*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const ct = c.req.header('content-type') ?? '';
    if (!ct.includes('application/json')) throw new HTTPException(415, { message: 'Envie os dados como JSON.' });
  }
  await next();
  c.header('Cache-Control', 'no-store');
});

app.get('/saude', async (c) => {
  await db().query('select 1');
  return c.json({ ok: true });
});

app.route('/auth', rotasAuth);
app.route('/usuarios', rotasUsuarios);
app.route('/', rotasEstado);
app.route('/pedidos', rotasPedidos);
app.route('/ops', rotasOps);
app.route('/', rotasCadastros);

app.notFound((c) => c.json({ erro: 'Rota não encontrada.' }, 404));

app.onError((err, c) => {
  if (err instanceof ErroRegra) return c.json({ erro: err.message }, 400);
  if (err instanceof HTTPException) return c.json({ erro: err.message }, err.status);
  if ((err as any)?.code === '23505') return c.json({ erro: 'Registro duplicado. Atualize a tela e tente de novo.' }, 409);
  console.error(err);
  return c.json({ erro: 'Erro interno no servidor. Tente de novo em instantes.' }, 500);
});
