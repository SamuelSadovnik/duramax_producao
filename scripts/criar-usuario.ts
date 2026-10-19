/**
 * Cria (ou redefine a senha de) um usuário direto no banco.
 * Use para criar o primeiro administrador; os demais podem ser criados pela tela Usuários.
 *
 *   npm run criar-usuario -- --usuario samuel --nome "Samuel" --perfil admin --senha "uma-senha-forte"
 */
import bcrypt from 'bcryptjs';
import { parseArgs } from 'node:util';
import { db } from '../server/db.js';

const PERFIS = ['admin', 'comercial', 'pcp', 'gerente', 'tv'];

async function main() {
  const { values } = parseArgs({
    options: { usuario: { type: 'string' }, nome: { type: 'string' }, perfil: { type: 'string', default: 'admin' }, senha: { type: 'string' } },
  });
  const usuario = (values.usuario ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(usuario)) throw new Error('Informe --usuario (letras minúsculas, números, ponto, hífen).');
  if (!values.senha || values.senha.length < 8) throw new Error('Informe --senha com pelo menos 8 caracteres.');
  if (!PERFIS.includes(values.perfil!)) throw new Error(`--perfil deve ser um de: ${PERFIS.join(', ')}`);
  const hash = await bcrypt.hash(values.senha, 10);
  const r = await db().query(
    `insert into usuarios (nome, usuario, senha_hash, perfil) values ($1, $2, $3, $4)
     on conflict (usuario) do update set senha_hash = excluded.senha_hash, perfil = excluded.perfil, ativo = true
     returning (xmax = 0) as novo`,
    [values.nome?.trim() || usuario, usuario, hash, values.perfil],
  );
  console.log(r.rows[0].novo ? `Usuário "${usuario}" criado (${values.perfil}).` : `Usuário "${usuario}" atualizado (${values.perfil}).`);
  await db().end();
}

main().catch(async (e) => {
  console.error('Erro:', e.message);
  await db().end().catch(() => {});
  process.exit(1);
});
