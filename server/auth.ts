import bcrypt from 'bcryptjs';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { jwtVerify, SignJWT } from 'jose';
import type { Perfil, Usuario } from '../shared/types.js';
import { db } from './db.js';

const COOKIE = 'dmx_sessao';
const DURACAO_S = 60 * 60 * 24 * 30; // 30 dias: a TV e o tablet ficam conectados
const RENOVAR_APOS_S = 60 * 60 * 24; // renova a sessão uma vez por dia de uso

function segredo() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET não configurado (mínimo 32 caracteres).');
  return new TextEncoder().encode(s);
}

export type Vars = { usuario: Usuario };

export function linhaUsuario(r: any): Usuario {
  return { id: r.id, nome: r.nome, usuario: r.usuario, perfil: r.perfil, ativo: r.ativo, ultimoAcesso: r.ultimo_acesso ? new Date(r.ultimo_acesso).toISOString() : null };
}

const seguro = (c: Context) => !!process.env.VERCEL || c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';

export async function abrirSessao(c: Context, u: Usuario) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(u.id).setIssuedAt().setExpirationTime(`${DURACAO_S}s`).sign(segredo());
  setCookie(c, COOKIE, token, { httpOnly: true, secure: seguro(c), sameSite: 'Lax', path: '/', maxAge: DURACAO_S });
}

export function fecharSessao(c: Context) {
  deleteCookie(c, COOKIE, { path: '/' });
}

let dummy: string | undefined;

export async function verificarSenha(usuario: string, senha: string): Promise<Usuario | null> {
  const r = await db().query('select * from usuarios where usuario = $1', [usuario.trim().toLowerCase()]);
  const row = r.rows[0];
  // compara mesmo quando o usuário não existe, para não revelar quais usuários existem pelo tempo de resposta
  dummy ??= await bcrypt.hash('senha-inexistente', 10);
  const ok = await bcrypt.compare(senha, row?.senha_hash ?? dummy);
  if (!row || !ok || !row.ativo) return null;
  await db().query('update usuarios set ultimo_acesso = now() where id = $1', [row.id]);
  return linhaUsuario(row);
}

/** Exige sessão válida; com `perfis`, exige também um destes perfis (admin sempre passa). */
export function exigir(...perfis: Perfil[]): MiddlewareHandler<{ Variables: Vars }> {
  return async (c, next) => {
    const token = getCookie(c, COOKIE);
    if (!token) throw new HTTPException(401, { message: 'Faça login para continuar.' });
    let sub: string;
    let iat = 0;
    try {
      const { payload } = await jwtVerify(token, segredo());
      sub = String(payload.sub);
      iat = Number(payload.iat ?? 0);
    } catch {
      fecharSessao(c);
      throw new HTTPException(401, { message: 'Sua sessão expirou. Entre novamente.' });
    }
    const r = await db().query('select * from usuarios where id = $1', [sub]);
    const row = r.rows[0];
    if (!row || !row.ativo) {
      fecharSessao(c);
      throw new HTTPException(401, { message: 'Usuário desativado. Fale com o administrador.' });
    }
    const u = linhaUsuario(row);
    if (perfis.length && u.perfil !== 'admin' && !perfis.includes(u.perfil)) {
      throw new HTTPException(403, { message: 'Seu perfil não tem permissão para esta ação.' });
    }
    c.set('usuario', u);
    if (Date.now() / 1000 - iat > RENOVAR_APOS_S) await abrirSessao(c, u);
    await next();
  };
}

export const hashSenha = (s: string) => bcrypt.hash(s, 10);

export function validarSenha(s: unknown): string {
  if (typeof s !== 'string' || s.length < 8) throw new HTTPException(400, { message: 'A senha precisa ter pelo menos 8 caracteres.' });
  if (s.length > 200) throw new HTTPException(400, { message: 'Senha longa demais.' });
  return s;
}
