/**
 * Leitura do estado completo do banco e gravação apenas do que mudou.
 * Toda alteração passa por `mutar`: trava global (as escritas são poucas), carrega,
 * aplica a regra pura de shared/ e grava a diferença na mesma transação.
 *
 * Para reduzir idas e voltas ao banco:
 * - o estado inteiro vem numa consulta só (json_build_object);
 * - a gravação é em lote: um insert/upsert por tabela, com as linhas em JSON (jsonb_to_recordset).
 */
import type { Estado, OP, Pedido, Produto } from '../shared/types.js';
import { transacao, type Tx } from './db.js';

/** Pedidos expedidos e OPs concluídas há mais tempo que isso não são carregados. */
export const JANELA_DIAS = 120;

type Consulta = { query: Tx['query'] };

/** Aceita Date (pg) ou texto (JSON do Postgres) e devolve ISO em UTC. */
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : undefined);
const opc = <T>(v: T | null | undefined) => (v === null ? undefined : v);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function linhaProduto(r: any): Produto {
  return { id: r.id, nome: r.nome, linha: r.linha, unidade: r.unidade, lote: num(r.lote), tempoMin: r.tempo_min ?? null };
}

function linhaPedido(r: any): Pedido {
  return {
    id: r.id,
    numero: r.numero,
    cliente: r.cliente,
    fantasia: r.fantasia,
    cidade: r.cidade,
    uf: r.uf,
    vendedor: r.vendedor,
    transportadora: r.transportadora,
    emissao: r.emissao ?? '',
    previsao: r.previsao ?? '',
    importadoEm: iso(r.importado_em)!,
    pcpEm: iso(r.pcp_em),
    prontoEm: iso(r.pronto_em),
    expedidoEm: iso(r.expedido_em),
    itens: r.itens ?? [],
    eventos: r.eventos ?? [],
  };
}

function linhaOP(r: any): OP {
  return {
    id: r.id,
    numero: r.numero,
    produtoId: r.produto_id,
    lote: Number(r.lote),
    tempoPadraoMin: r.tempo_padrao_min,
    alocacoes: r.alocacoes ?? [],
    status: r.status,
    criadaEm: iso(r.criada_em)!,
    inicio: iso(r.inicio),
    fim: iso(r.fim),
    realMin: opc(r.real_min),
    motivo: opc(r.motivo),
    obs: opc(r.obs),
    iniciadaPor: opc(r.iniciada_por),
    finalizadaPor: opc(r.finalizada_por),
  };
}

export interface Carregado {
  estado: Estado;
  ordemDB: Map<string, number | null>;
}

const SQL_ESTADO = `
select json_build_object(
  'produtos', coalesce((select json_agg(p) from produtos p), '[]'::json),
  'pedidos',  coalesce((select json_agg(x) from pedidos x
                        where x.expedido_em is null or x.expedido_em > now() - interval '${JANELA_DIAS} days'), '[]'::json),
  'ops',      coalesce((select json_agg(o) from ops o
                        where o.status <> 'concluida' or o.fim > now() - interval '${JANELA_DIAS} days'), '[]'::json),
  'config',   (select row_to_json(c) from config c where c.id = 1),
  'seq',      (select coalesce(max(numero), 0) from ops)
) as d`;

export async function carregar(c: Consulta): Promise<Carregado> {
  const d = (await c.query(SQL_ESTADO)).rows[0].d;
  const produtos: Record<string, Produto> = {};
  for (const r of d.produtos) produtos[r.id] = linhaProduto(r);
  const pedidos = (d.pedidos as any[]).map(linhaPedido);
  const ordemDB = new Map<string, number | null>((d.pedidos as any[]).map((r) => [r.id, r.ordem ?? null]));
  const prioridade = (d.pedidos as any[])
    .filter((r) => !r.expedido_em)
    .sort((a, b) => (a.ordem ?? 1e12) - (b.ordem ?? 1e12) || new Date(a.importado_em).getTime() - new Date(b.importado_em).getTime())
    .map((r) => r.id as string);
  const k = d.config;
  return {
    estado: {
      versao: Number(k.versao),
      produtos,
      pedidos,
      ops: (d.ops as any[]).map(linhaOP),
      prioridade,
      config: { capacidade: k.capacidade, toleranciaPct: k.tolerancia_pct, prazoDiasUteis: k.prazo_dias_uteis ?? 7, feriados: k.feriados ?? [] },
      seqOP: Number(d.seq),
    },
    ordemDB,
  };
}

/** JSON com chaves ordenadas e sem undefined, para comparar registros. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b))) : x,
  );
}
const igual = (a: unknown, b: unknown) => a === b || canon(a) === canon(b);

const UPSERT_PRODUTOS = `
insert into produtos (id, nome, linha, unidade, lote, tempo_min, atualizado_em)
select id, nome, linha, unidade, lote, tempo_min, now()
from jsonb_to_recordset($1::jsonb) as x(id text, nome text, linha text, unidade text, lote numeric, tempo_min integer)
on conflict (id) do update set nome = excluded.nome, linha = excluded.linha, unidade = excluded.unidade,
  lote = excluded.lote, tempo_min = excluded.tempo_min, atualizado_em = now()`;

const UPSERT_PEDIDOS = `
insert into pedidos (id, numero, cliente, fantasia, cidade, uf, vendedor, transportadora, emissao, previsao,
  importado_em, pcp_em, pronto_em, expedido_em, ordem, itens, eventos, atualizado_em)
select id, numero, cliente, fantasia, cidade, uf, vendedor, transportadora, emissao, previsao,
  importado_em, pcp_em, pronto_em, expedido_em, ordem, itens, eventos, now()
from jsonb_to_recordset($1::jsonb) as x(id text, numero text, cliente text, fantasia text, cidade text, uf text,
  vendedor text, transportadora text, emissao date, previsao date, importado_em timestamptz, pcp_em timestamptz,
  pronto_em timestamptz, expedido_em timestamptz, ordem double precision, itens jsonb, eventos jsonb)
on conflict (id) do update set numero = excluded.numero, cliente = excluded.cliente, fantasia = excluded.fantasia,
  cidade = excluded.cidade, uf = excluded.uf, vendedor = excluded.vendedor, transportadora = excluded.transportadora,
  emissao = excluded.emissao, previsao = excluded.previsao, importado_em = excluded.importado_em, pcp_em = excluded.pcp_em,
  pronto_em = excluded.pronto_em, expedido_em = excluded.expedido_em, ordem = excluded.ordem, itens = excluded.itens,
  eventos = excluded.eventos, atualizado_em = now()`;

const UPSERT_OPS = `
insert into ops (id, numero, produto_id, lote, tempo_padrao_min, alocacoes, status, criada_em, inicio, fim,
  real_min, motivo, obs, iniciada_por, finalizada_por, atualizado_em)
select id, numero, produto_id, lote, tempo_padrao_min, alocacoes, status, criada_em, inicio, fim,
  real_min, motivo, obs, iniciada_por, finalizada_por, now()
from jsonb_to_recordset($1::jsonb) as x(id text, numero integer, produto_id text, lote numeric, tempo_padrao_min integer,
  alocacoes jsonb, status text, criada_em timestamptz, inicio timestamptz, fim timestamptz, real_min integer,
  motivo text, obs text, iniciada_por text, finalizada_por text)
on conflict (id) do update set produto_id = excluded.produto_id, lote = excluded.lote, tempo_padrao_min = excluded.tempo_padrao_min,
  alocacoes = excluded.alocacoes, status = excluded.status, inicio = excluded.inicio, fim = excluded.fim,
  real_min = excluded.real_min, motivo = excluded.motivo, obs = excluded.obs, iniciada_por = excluded.iniciada_por,
  finalizada_por = excluded.finalizada_por, atualizado_em = now()`;

/** Grava as diferenças (no máximo um comando por tabela) e devolve quantos registros mudaram. */
export async function persistir(c: Tx, antes: Carregado, depois: Estado): Promise<number> {
  const A = antes.estado;

  const produtos = Object.values(depois.produtos)
    .filter((p) => !igual(A.produtos[p.id], p))
    .map((p) => ({ id: p.id, nome: p.nome, linha: p.linha, unidade: p.unidade, lote: p.lote, tempo_min: p.tempoMin }));

  const ordem = new Map(depois.prioridade.map((id, i) => [id, i]));
  const pedAntes = new Map(A.pedidos.map((p) => [p.id, p]));
  const pedidos = depois.pedidos
    .map((p) => ({ p, ord: p.expedidoEm ? null : ordem.get(p.id) ?? null }))
    .filter(({ p, ord }) => !igual(pedAntes.get(p.id), p) || antes.ordemDB.get(p.id) !== ord)
    .map(({ p, ord }) => ({
      id: p.id, numero: p.numero, cliente: p.cliente, fantasia: p.fantasia, cidade: p.cidade, uf: p.uf,
      vendedor: p.vendedor, transportadora: p.transportadora, emissao: p.emissao || null, previsao: p.previsao || null,
      importado_em: p.importadoEm, pcp_em: p.pcpEm ?? null, pronto_em: p.prontoEm ?? null, expedido_em: p.expedidoEm ?? null,
      ordem: ord, itens: p.itens, eventos: p.eventos,
    }));
  const idsPed = new Set(depois.pedidos.map((p) => p.id));
  const pedidosRemovidos = A.pedidos.filter((p) => !idsPed.has(p.id)).map((p) => p.id);

  const opAntes = new Map(A.ops.map((o) => [o.id, o]));
  const ops = depois.ops
    .filter((o) => !igual(opAntes.get(o.id), o))
    .map((o) => ({
      id: o.id, numero: o.numero, produto_id: o.produtoId, lote: o.lote, tempo_padrao_min: o.tempoPadraoMin,
      alocacoes: o.alocacoes, status: o.status, criada_em: o.criadaEm, inicio: o.inicio ?? null, fim: o.fim ?? null,
      real_min: o.realMin ?? null, motivo: o.motivo ?? null, obs: o.obs ?? null,
      iniciada_por: o.iniciadaPor ?? null, finalizada_por: o.finalizadaPor ?? null,
    }));
  const idsOp = new Set(depois.ops.map((o) => o.id));
  const opsRemovidas = A.ops.filter((o) => !idsOp.has(o.id)).map((o) => o.id);

  const configMudou = !igual(A.config, depois.config);

  // produtos antes das OPs (chave estrangeira)
  if (produtos.length) await c.query(UPSERT_PRODUTOS, [JSON.stringify(produtos)]);
  if (pedidos.length) await c.query(UPSERT_PEDIDOS, [JSON.stringify(pedidos)]);
  if (pedidosRemovidos.length) await c.query('delete from pedidos where id = any($1::text[])', [pedidosRemovidos]);
  if (ops.length) await c.query(UPSERT_OPS, [JSON.stringify(ops)]);
  if (opsRemovidas.length) await c.query('delete from ops where id = any($1::text[])', [opsRemovidas]);
  if (configMudou)
    await c.query('update config set capacidade = $1, tolerancia_pct = $2, feriados = $3, prazo_dias_uteis = $4 where id = 1', [
      depois.config.capacidade,
      depois.config.toleranciaPct,
      JSON.stringify(depois.config.feriados),
      depois.config.prazoDiasUteis,
    ]);

  return produtos.length + pedidos.length + pedidosRemovidos.length + ops.length + opsRemovidas.length + (configMudou ? 1 : 0);
}

/**
 * Aplica uma alteração de forma serializada e devolve o estado novo.
 * `fn` pode devolver só o estado ou { estado, ...extras }.
 */
export async function mutar<X extends object = {}>(
  fn: (e: Estado, agora: Date) => Estado | ({ estado: Estado } & X),
): Promise<{ estado: Estado } & Partial<X>> {
  return transacao(async (c) => {
    await c.query('select pg_advisory_xact_lock(7311)');
    const antes = await carregar(c);
    const r = fn(antes.estado, new Date());
    const out = ('estado' in r ? r : { estado: r }) as { estado: Estado } & Partial<X>;
    const n = await persistir(c, antes, out.estado);
    if (n) {
      const v = await c.query('update config set versao = versao + 1 where id = 1 returning versao');
      out.estado = { ...out.estado, versao: Number(v.rows[0].versao) };
    }
    return out;
  });
}
