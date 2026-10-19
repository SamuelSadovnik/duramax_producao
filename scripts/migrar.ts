/**
 * Aplica as migrações de db/migrations em ordem, uma única vez cada.
 * Uso: npm run db:migrar   (usa DATABASE_URL do .env)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/db.js';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

async function main() {
  const c = await db().connect();
  try {
    await c.query(`create table if not exists schema_migrations (nome text primary key, aplicada_em timestamptz not null default now())`);
    const feitas = new Set((await c.query<{ nome: string }>('select nome from schema_migrations')).rows.map((r) => r.nome));
    const arquivos = readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort();
    let n = 0;
    for (const f of arquivos) {
      if (feitas.has(f)) continue;
      process.stdout.write(`Aplicando ${f}… `);
      await c.query('begin');
      try {
        await c.query(readFileSync(join(pasta, f), 'utf8'));
        await c.query('insert into schema_migrations (nome) values ($1)', [f]);
        await c.query('commit');
        console.log('ok');
        n++;
      } catch (e) {
        await c.query('rollback');
        throw e;
      }
    }
    console.log(n ? `${n} migração(ões) aplicada(s).` : 'Banco já está atualizado.');
  } finally {
    c.release();
    await db().end();
  }
}

main().catch((e) => {
  console.error('\nFalha na migração:', e.message);
  process.exit(1);
});
