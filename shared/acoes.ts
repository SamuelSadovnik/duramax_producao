/**
 * Ações do sistema como funções puras: recebem o estado atual e devolvem o novo.
 * O servidor roda exatamente estas funções dentro de uma transação e grava a diferença;
 * o front usa as mesmas regras para mostrar prévias (plano do PCP, simulação da fila).
 */
import { ErroRegra, excluirPedido, statusPedido } from './engine.js';
import type { PedidoLido } from './parse.js';
import type { Config, Decisao, Estado, Pedido, Produto } from './types.js';

export { ErroRegra, excluirPedido };

/** Produto novo vindo do PDF: entra sem lote e sem tempo; o PCP informa antes de liberar. */
export function produtoDeLido(id: string, nome: string): Produto {
  return { id, nome, linha: id.split('.')[0], unidade: 'L', lote: null, tempoMin: null };
}

export const idPedido = (numero: string) => `p${numero}`;

export function pedidoDeLido(l: PedidoLido, agora: Date, extra: Partial<Pedido> = {}): Pedido {
  const id = idPedido(l.numero);
  return {
    id,
    numero: l.numero,
    cliente: l.cliente,
    fantasia: l.fantasia || l.cliente,
    cidade: l.cidade,
    uf: l.uf,
    vendedor: l.vendedor,
    transportadora: l.transportadora,
    emissao: l.emissao,
    previsao: l.previsao,
    importadoEm: agora.toISOString(),
    itens: l.itens.map((i, k) => ({
      id: `${id}-${k}`,
      codigo: i.codigo,
      descricao: i.descricao,
      codFab: i.codFab,
      produtoId: i.produtoId,
      embalagem: i.embalagem,
      qtde: i.qtde,
      volume: Math.round(i.qtde * i.embalagem * 100) / 100,
      decisao: 'pendente' as Decisao,
    })),
    eventos: [{ em: agora.toISOString(), texto: 'Pedido importado do PDF', tipo: 'info' }],
    ...extra,
  };
}

export interface Importacao {
  pedido: PedidoLido;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export function validarImportacao(x: Importacao): string | null {
  const p = x?.pedido;
  if (!p || typeof p.numero !== 'string' || !/^\d{1,12}$/.test(p.numero)) return 'Número do pedido inválido.';
  if (!Array.isArray(p.itens) || !p.itens.length) return `Pedido #${p.numero} sem itens.`;
  if (p.itens.length > 500) return `Pedido #${p.numero} com itens demais.`;
  for (const i of p.itens) {
    if (!i || typeof i.produtoId !== 'string' || !i.produtoId || !(i.qtde > 0) || !(i.embalagem > 0)) return `Pedido #${p.numero}: item inválido (${i?.codigo ?? '?'}).`;
  }
  return null;
}

export function importarPedidos(e: Estado, lista: Importacao[], agora: Date, por?: string): { estado: Estado; novosProdutos: number; importados: string[] } {
  const produtos = { ...e.produtos };
  const pedidos = [...e.pedidos];
  const prioridade = [...e.prioridade];
  let novosProdutos = 0;
  const importados: string[] = [];
  for (const x of lista) {
    const erro = validarImportacao(x);
    if (erro) throw new ErroRegra(erro);
    const l = x.pedido;
    if (pedidos.some((p) => p.numero === l.numero)) throw new ErroRegra(`O pedido #${l.numero} já existe no sistema.`);
    for (const i of l.itens)
      if (!produtos[i.produtoId]) {
        produtos[i.produtoId] = produtoDeLido(i.produtoId, i.produtoNome || i.descricao);
        novosProdutos++;
      }
    const p = pedidoDeLido(l, agora);
    p.eventos = [{ em: agora.toISOString(), texto: 'Pedido importado do PDF', tipo: 'info', por }];
    pedidos.push(p);
    prioridade.push(p.id);
    importados.push(l.numero);
  }
  return { estado: { ...e, produtos, pedidos, prioridade }, novosProdutos, importados };
}

export function decidirItens(e: Estado, pedidoId: string, itemIds: string[], decisao: Decisao): Estado {
  const p = e.pedidos.find((x) => x.id === pedidoId);
  if (!p) throw new ErroRegra('Pedido não encontrado.');
  if (p.pcpEm) throw new ErroRegra(`O pedido #${p.numero} já foi liberado; as decisões não podem mais mudar.`);
  if (!['estoque', 'op', 'pendente'].includes(decisao)) throw new ErroRegra('Decisão inválida.');
  const ids = new Set(itemIds);
  return {
    ...e,
    pedidos: e.pedidos.map((x) => (x.id !== pedidoId ? x : { ...x, itens: x.itens.map((i) => (ids.has(i.id) ? { ...i, decisao } : i)) })),
  };
}

export function expedirPedido(e: Estado, pedidoId: string, agora: Date, por?: string): Estado {
  const p = e.pedidos.find((x) => x.id === pedidoId);
  if (!p) throw new ErroRegra('Pedido não encontrado.');
  if (statusPedido(e, p) !== 'pronto') throw new ErroRegra(`O pedido #${p.numero} ainda não está pronto para expedição.`);
  const em = agora.toISOString();
  return {
    ...e,
    pedidos: e.pedidos.map((x) => (x.id === pedidoId ? { ...x, expedidoEm: em, eventos: [...x.eventos, { em, texto: 'Expedido', tipo: 'ok', por }] } : x)),
    prioridade: e.prioridade.filter((x) => x !== pedidoId),
  };
}

/** Define a ordem dos pedidos informados; os demais mantêm a ordem relativa depois deles. */
export function definirPrioridade(e: Estado, ids: string[]): Estado {
  const existentes = new Set(e.prioridade);
  const ordem = ids.filter((id, i) => existentes.has(id) && ids.indexOf(id) === i);
  return { ...e, prioridade: [...ordem, ...e.prioridade.filter((id) => !ordem.includes(id))] };
}

export function atualizarProduto(e: Estado, id: string, patch: { lote?: number; tempoMin?: number; nome?: string }): Estado {
  const p = e.produtos[id];
  if (!p) throw new ErroRegra('Produto não encontrado.');
  if (patch.lote !== undefined && !(patch.lote > 0 && patch.lote < 1_000_000)) throw new ErroRegra('Tamanho de lote inválido.');
  if (patch.tempoMin !== undefined && !(Number.isInteger(patch.tempoMin) && patch.tempoMin > 0 && patch.tempoMin < 60 * 24 * 30)) throw new ErroRegra('Tempo inválido.');
  const novo: Produto = {
    ...p,
    ...(patch.lote !== undefined ? { lote: patch.lote } : {}),
    ...(patch.tempoMin !== undefined ? { tempoMin: patch.tempoMin } : {}),
    ...(patch.nome ? { nome: patch.nome.slice(0, 200) } : {}),
  };
  return {
    ...e,
    produtos: { ...e.produtos, [id]: novo },
    // OPs que ainda não começaram passam a usar o novo tempo padrão
    ops: patch.tempoMin ? e.ops.map((o) => (o.produtoId === id && o.status === 'fila' ? { ...o, tempoPadraoMin: patch.tempoMin! } : o)) : e.ops,
  };
}

export function atualizarConfig(e: Estado, patch: Partial<Config>): Estado {
  const c = { ...e.config };
  if (patch.capacidade !== undefined) {
    if (!(Number.isInteger(patch.capacidade) && patch.capacidade >= 1 && patch.capacidade <= 50)) throw new ErroRegra('Capacidade inválida.');
    c.capacidade = patch.capacidade;
  }
  if (patch.toleranciaPct !== undefined) {
    if (!(Number.isInteger(patch.toleranciaPct) && patch.toleranciaPct >= 0 && patch.toleranciaPct <= 200)) throw new ErroRegra('Tolerância inválida.');
    c.toleranciaPct = patch.toleranciaPct;
  }
  if (patch.prazoDiasUteis !== undefined) {
    if (!(Number.isInteger(patch.prazoDiasUteis) && patch.prazoDiasUteis >= 1 && patch.prazoDiasUteis <= 60)) throw new ErroRegra('Prazo inválido (1 a 60 dias úteis).');
    c.prazoDiasUteis = patch.prazoDiasUteis;
  }
  if (patch.feriados !== undefined) {
    if (!Array.isArray(patch.feriados) || patch.feriados.some((f) => !DATA.test(f))) throw new ErroRegra('Feriados inválidos.');
    c.feriados = [...new Set(patch.feriados)].sort();
  }
  return { ...e, config: c };
}
