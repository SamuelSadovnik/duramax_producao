import pg from 'pg';

// datas (date) como texto yyyy-mm-dd, numéricos como number
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) {
    // a integração Neon da Vercel cria DATABASE_URL; POSTGRES_URL fica como alternativa
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL não configurada.');
    const local = /localhost|127\.0\.0\.1|@db:/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      // em funções serverless poucas conexões bastam; o Neon faz o pooling
      max: process.env.VERCEL ? 3 : 10,
      idleTimeoutMillis: 10_000,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export type Tx = pg.PoolClient;

/** Executa dentro de uma transação. */
export async function transacao<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
