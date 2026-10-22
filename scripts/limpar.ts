/**
 * Apaga todos os pedidos, OPs e produtos do banco. Usuários e configurações (prazo, feriados,
 * tolerância, capacidade) ficam. A numeração das OPs recomeça do 1.
 *
 *   npm run db:limpar -- --confirmar
 *
 * Sem --confirmar, só mostra o que seria apagado.
 */
import { parseArgs } from 'node:util';
import { db, transacao } from '../server/db.js';

async function main() {
  const { values } = parseArgs({ options: { confirmar: { type: 'boolean', default: false } } });
  const contar = async () => {
    const r = await db().query(
      `select (select count(*) from pedidos) as pedidos, (select count(*) from ops) as ops,
              (select count(*) from produtos) as produtos, (select count(*) from usuarios) as usuarios`,
    );
    return r.rows[0] as { pedidos: number; ops: number; produtos: number; usuarios: number };
  };

  const antes = await contar();
  console.log(`No banco agora: ${antes.pedidos} pedidos, ${antes.ops} OPs, ${antes.produtos} produtos, ${antes.usuarios} usuários.`);

  if (!values.confirmar) {
    console.log('\nNada foi apagado. Para apagar pedidos, OPs e produtos (os usuários ficam), rode:');
    console.log('  npm run db:limpar -- --confirmar');
    await db().end();
    return;
  }

  await transacao(async (c) => {
    // mesma trava das alterações do sistema: ninguém grava no meio da limpeza
    await c.query('select pg_advisory_xact_lock(7311)');
    await c.query('delete from ops');
    await c.query('delete from pedidos');
    await c.query('delete from produtos');
    // muda a versão para as telas abertas recarregarem sozinhas
    await c.query('update config set versao = versao + 1 where id = 1');
  });

  const depois = await contar();
  console.log(`Pronto. Ficaram: ${depois.pedidos} pedidos, ${depois.ops} OPs, ${depois.produtos} produtos e ${depois.usuarios} usuários.`);
  console.log('As telas abertas atualizam sozinhas em alguns segundos.');
  await db().end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db().end().catch(() => {});
  process.exit(1);
});
