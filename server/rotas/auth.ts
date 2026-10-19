import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import bcrypt from 'bcryptjs';
import { abrirSessao, exigir, fecharSessao, hashSenha, validarSenha, verificarSenha, type Vars } from '../auth.js';
import { db } from '../db.js';

export const rotasAuth = new Hono<{ Variables: Vars }>();

rotasAuth.post('/entrar', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.usuario !== 'string' || typeof b.senha !== 'string') throw new HTTPException(400, { message: 'Informe usuário e senha.' });
  const u = await verificarSenha(b.usuario, b.senha);
  if (!u) throw new HTTPException(401, { message: 'Usuário ou senha incorretos.' });
  await abrirSessao(c, u);
  return c.json({ usuario: u });
});

rotasAuth.post('/sair', (c) => {
  fecharSessao(c);
  return c.json({ ok: true });
});

rotasAuth.get('/eu', exigir(), (c) => c.json({ usuario: c.get('usuario') }));

rotasAuth.post('/senha', exigir(), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const u = c.get('usuario');
  const r = await db().query('select senha_hash from usuarios where id = $1', [u.id]);
  if (!(await bcrypt.compare(String(b.atual ?? ''), r.rows[0].senha_hash))) throw new HTTPException(400, { message: 'A senha atual não confere.' });
  await db().query('update usuarios set senha_hash = $1 where id = $2', [await hashSenha(validarSenha(b.nova)), u.id]);
  return c.json({ ok: true });
});
