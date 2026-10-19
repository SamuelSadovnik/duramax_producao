import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { exigir, hashSenha, linhaUsuario, validarSenha, type Vars } from '../auth.js';
import { db } from '../db.js';

const PERFIS = ['admin', 'comercial', 'pcp', 'gerente', 'tv'];

export const rotasUsuarios = new Hono<{ Variables: Vars }>();
rotasUsuarios.use('*', exigir('admin'));

rotasUsuarios.get('/', async (c) => {
  const r = await db().query('select * from usuarios order by ativo desc, nome');
  return c.json({ usuarios: r.rows.map(linhaUsuario) });
});

function validarDados(b: any, novo: boolean) {
  const out: Record<string, unknown> = {};
  if (novo || b.nome !== undefined) {
    if (typeof b.nome !== 'string' || !b.nome.trim() || b.nome.length > 80) throw new HTTPException(400, { message: 'Informe o nome (até 80 caracteres).' });
    out.nome = b.nome.trim();
  }
  if (novo) {
    const u = String(b.usuario ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(u)) throw new HTTPException(400, { message: 'Usuário deve ter de 2 a 40 letras minúsculas, números, ponto ou hífen, sem espaço.' });
    out.usuario = u;
  }
  if (novo || b.perfil !== undefined) {
    if (!PERFIS.includes(b.perfil)) throw new HTTPException(400, { message: 'Perfil inválido.' });
    out.perfil = b.perfil;
  }
  if (b.ativo !== undefined) out.ativo = !!b.ativo;
  return out;
}

rotasUsuarios.post('/', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const d = validarDados(b, true);
  const hash = await hashSenha(validarSenha(b.senha));
  const r = await db().query('insert into usuarios (nome, usuario, perfil, senha_hash) values ($1,$2,$3,$4) returning *', [d.nome, d.usuario, d.perfil, hash]);
  return c.json({ usuario: linhaUsuario(r.rows[0]) }, 201);
});

rotasUsuarios.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json().catch(() => ({}));
  const d = validarDados(b, false);
  const eu = c.get('usuario');
  if (id === eu.id && (d.ativo === false || (d.perfil && d.perfil !== 'admin'))) {
    throw new HTTPException(400, { message: 'Você não pode desativar nem tirar o perfil de administrador de si mesmo.' });
  }
  if (b.senha !== undefined) d.senha_hash = await hashSenha(validarSenha(b.senha));
  const campos = Object.keys(d);
  if (!campos.length) throw new HTTPException(400, { message: 'Nada para alterar.' });
  const sets = campos.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const r = await db().query(`update usuarios set ${sets} where id = $1 returning *`, [id, ...campos.map((k) => d[k])]);
  if (!r.rows[0]) throw new HTTPException(404, { message: 'Usuário não encontrado.' });
  return c.json({ usuario: linhaUsuario(r.rows[0]) });
});
