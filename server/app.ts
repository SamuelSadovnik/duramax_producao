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

/** Diagnóstico da instalação: banco acessível, tabelas criadas, segredo configurado e usuários cadastrados. */
app.get('/saude', async (c) => {
  const r: Record<string, string> = {};
  r.segredo = (process.env.AUTH_SECRET ?? '').length >= 32 ? 'ok' : 'faltando: crie AUTH_SECRET (32+ caracteres) nas variáveis da Vercel';
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) r.banco = 'faltando: DATABASE_URL não configurada';
  else {
    try {
      await db().query('select 1');
      r.banco = 'ok';
      const t = await db().query("select to_regclass('public.usuarios') is not null as ok");
      if (!t.rows[0].ok) r.tabelas = 'faltando: rode npm run db:migrar apontando para este banco';
      else {
        r.tabelas = 'ok';
        const u = await db().query("select count(*)::int as n, count(*) filter (where perfil = 'admin' and ativo)::int as adm from usuarios");
        r.usuarios = u.rows[0].adm ? `ok (${u.rows[0].n})` : 'faltando: crie o administrador com npm run criar-usuario';
      }
    } catch (e: any) {
      r.banco = `erro ao conectar: ${e?.message ?? e}`;
    }
  }
  const ok = Object.values(r).every((v) => v.startsWith('ok'));
  return c.json({ ok, ...r }, ok ? 200 : 503);
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
  const code = (err as any)?.code;
  if (code === '23505') return c.json({ erro: 'Registro duplicado. Atualize a tela e tente de novo.' }, 409);
  console.error(err);
  // problemas de instalação: mensagem que diz o que fazer
  if (code === '42P01') return c.json({ erro: 'O banco ainda não tem as tabelas. Rode "npm run db:migrar" apontando para o banco de produção.' }, 500);
  if (/AUTH_SECRET/.test(err.message)) return c.json({ erro: 'Falta configurar a variável AUTH_SECRET na Vercel (32+ caracteres) e fazer redeploy.' }, 500);
  if (/DATABASE_URL/.test(err.message)) return c.json({ erro: 'Falta configurar a variável DATABASE_URL na Vercel.' }, 500);
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '28P01', '3D000'].includes(code)) return c.json({ erro: `Não consegui conectar ao banco (${code}). Confira a DATABASE_URL na Vercel.` }, 500);
  return c.json({ erro: 'Erro interno no servidor. Tente de novo em instantes.' }, 500);
});
