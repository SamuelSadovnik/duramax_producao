/**
 * Leitura do estado completo do banco e gravação apenas do que mudou.
 * Toda alteração passa por `mutar`: trava global (as escritas são poucas), carrega,
 * aplica a regra pura de shared/ e grava a diferença na mesma transação.
 */
import type { Estado, OP, Pedido, Produto } from '../shared/types.js';
import { transacao, type Tx } from './db.js';

/** Pedidos expedidos e OPs concluídas há mais tempo que isso não são carregados. */
export const JANELA_DIAS = 120;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : undefined);
const opc = <T>(v: T | null | undefined) => (v === null ? undefined : v);

function linhaProduto(r: any): Produto {
  return { id: r.id, nome: r.nome, linha: r.linha, unidade: r.unidade, lote: Number(r.lote), tempoMin: r.tempo_min, pendente: r.pendente || undefined };
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

export async function carregar(c: Tx | { query: Tx['query'] }): Promise<Carregado> {
  const [prod, ped, ops, cfg, seq] = await Promise.all([
    c.query('select * from produtos'),
    c.query(`select * from pedidos where expedido_em is null or expedido_em > now() - interval '${JANELA_DIAS} days'`),
    c.query(`select * from ops where status <> 'concluida' or fim > now() - interval '${JANELA_DIAS} days'`),
    c.query('select * from config where id = 1'),
    c.query('select coalesce(max(numero), 0) as m from ops'),
  ]);
  const produtos: Record<string, Produto> = {};
  for (const r of prod.rows) produtos[r.id] = linhaProduto(r);
  const pedidos = ped.rows.map(linhaPedido);
  const ordemDB = new Map<string, number | null>(ped.rows.map((r: any) => [r.id, r.ordem]));
  const prioridade = ped.rows
    .filter((r: any) => !r.expedido_em)
    .sort((a: any, b: any) => (a.ordem ?? 1e12) - (b.ordem ?? 1e12) || a.importado_em - b.importado_em)
    .map((r: any) => r.id as string);
  const k = cfg.rows[0];
  return {
    estado: {
      versao: k.versao,
      produtos,
      pedidos,
      ops: ops.rows.map(linhaOP),
      prioridade,
      config: { capacidade: k.capacidade, toleranciaPct: k.tolerancia_pct, prazoDiasUteis: k.prazo_dias_uteis ?? 7, feriados: k.feriados ?? [] },
      seqOP: seq.rows[0].m,
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

export async function persistir(c: Tx, antes: Carregado, depois: Estado): Promise<number> {
  let n = 0;
  const A = antes.estado;

  for (const p of Object.values(depois.produtos)) {
    if (igual(A.produtos[p.id], p)) continue;
    await c.query(
      `insert into produtos (id, nome, linha, unidade, lote, tempo_min, pendente, atualizado_em)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       on conflict (id) do update set nome=$2, linha=$3, unidade=$4, lote=$5, tempo_min=$6, pendente=$7, atualizado_em=now()`,
      [p.id, p.nome, p.linha, p.unidade, p.lote, p.tempoMin, !!p.pendente],
    );
    n++;
  }

  const ordem = new Map(depois.prioridade.map((id, i) => [id, i]));
  const pedAntes = new Map(A.pedidos.map((p) => [p.id, p]));
  for (const p of depois.pedidos) {
    const ord = p.expedidoEm ? null : ordem.get(p.id) ?? null;
    if (igual(pedAntes.get(p.id), p) && antes.ordemDB.get(p.id) === ord) continue;
    await c.query(
      `insert into pedidos (id, numero, cliente, fantasia, cidade, uf, vendedor, transportadora, emissao, previsao,
         importado_em, pcp_em, pronto_em, expedido_em, ordem, itens, eventos, atualizado_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
       on conflict (id) do update set numero=$2, cliente=$3, fantasia=$4, cidade=$5, uf=$6, vendedor=$7, transportadora=$8,
         emissao=$9, previsao=$10, importado_em=$11, pcp_em=$12, pronto_em=$13, expedido_em=$14, ordem=$15,
         itens=$16, eventos=$17, atualizado_em=now()`,
      [
        p.id, p.numero, p.cliente, p.fantasia, p.cidade, p.uf, p.vendedor, p.transportadora,
        p.emissao || null, p.previsao || null, p.importadoEm, p.pcpEm ?? null, p.prontoEm ?? null, p.expedidoEm ?? null,
        ord, JSON.stringify(p.itens), JSON.stringify(p.eventos),
      ],
    );
    n++;
  }
  const idsPed = new Set(depois.pedidos.map((p) => p.id));
  for (const p of A.pedidos)
    if (!idsPed.has(p.id)) {
      await c.query('delete from pedidos where id = $1', [p.id]);
      n++;
    }

  const opAntes = new Map(A.ops.map((o) => [o.id, o]));
  for (const o of depois.ops) {
    if (igual(opAntes.get(o.id), o)) continue;
    await c.query(
      `insert into ops (id, numero, produto_id, lote, tempo_padrao_min, alocacoes, status, criada_em, inicio, fim,
         real_min, motivo, obs, iniciada_por, finalizada_por, atualizado_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
       on conflict (id) do update set produto_id=$3, lote=$4, tempo_padrao_min=$5, alocacoes=$6, status=$7, inicio=$9, fim=$10,
         real_min=$11, motivo=$12, obs=$13, iniciada_por=$14, finalizada_por=$15, atualizado_em=now()`,
      [
        o.id, o.numero, o.produtoId, o.lote, o.tempoPadraoMin, JSON.stringify(o.alocacoes), o.status, o.criadaEm,
        o.inicio ?? null, o.fim ?? null, o.realMin ?? null, o.motivo ?? null, o.obs ?? null, o.iniciadaPor ?? null, o.finalizadaPor ?? null,
      ],
    );
    n++;
  }
  const idsOp = new Set(depois.ops.map((o) => o.id));
  for (const o of A.ops)
    if (!idsOp.has(o.id)) {
      await c.query('delete from ops where id = $1', [o.id]);
      n++;
    }

  if (!igual(A.config, depois.config)) {
    await c.query('update config set capacidade=$1, tolerancia_pct=$2, feriados=$3, prazo_dias_uteis=$4 where id = 1', [
      depois.config.capacidade,
      depois.config.toleranciaPct,
      JSON.stringify(depois.config.feriados),
      depois.config.prazoDiasUteis,
    ]);
    n++;
  }
  return n;
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
      out.estado = { ...out.estado, versao: v.rows[0].versao };
    }
    return out;
  });
}
