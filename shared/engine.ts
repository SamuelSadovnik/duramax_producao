import { expedienteEntre, fimDoDia, MIN_DIA, proximoExpediente, somarExpediente } from './calendar.js';
import type { Estado, OP, Pedido, StatusOP, StatusPedido } from './types.js';

export const opsDoPedido = (e: Estado, pedidoId: string) =>
  e.ops.filter((o) => o.alocacoes.some((a) => a.pedidoId === pedidoId));

export function statusPedido(e: Estado, p: Pedido): StatusPedido {
  if (p.expedidoEm) return 'expedido';
  if (!p.pcpEm) return 'pcp';
  const ops = opsDoPedido(e, p.id);
  if (!ops.length || ops.every((o) => o.status === 'concluida')) return 'pronto';
  if (ops.some((o) => o.status !== 'fila')) return 'producao';
  return 'fila';
}

export const volumePedido = (p: Pedido) => p.itens.reduce((s, i) => s + i.volume, 0);
export const alocado = (o: OP) => o.alocacoes.reduce((s, a) => s + a.volume, 0);

/* ---------------------------------------------------------------- plano PCP */

export interface LinhaPlano {
  produtoId: string;
  necessidade: number;
  aproveita: { opId: string; numero: number; volume: number; livre: number }[];
  novas: { lote: number; volume: number }[];
  sobra: number;        // volume de lotes novos que não é deste pedido (vai para estoque)
  tempoMin: number;     // tempo das OPs novas
}

export function planejar(e: Estado, pedido: Pedido): LinhaPlano[] {
  const nec = new Map<string, number>();
  for (const i of pedido.itens) if (i.decisao === 'op') nec.set(i.produtoId, (nec.get(i.produtoId) ?? 0) + i.volume);
  const linhas: LinhaPlano[] = [];
  for (const [produtoId, necessidade] of nec) {
    const prod = e.produtos[produtoId];
    let resta = necessidade;
    const aproveita: LinhaPlano['aproveita'] = [];
    for (const o of e.ops) {
      if (resta <= 0.001) break;
      if (o.produtoId !== produtoId || o.status !== 'fila') continue;
      if (o.alocacoes.some((a) => a.pedidoId === pedido.id)) continue;
      const livre = o.lote - alocado(o);
      if (livre <= 0.001) continue;
      const v = Math.min(livre, resta);
      aproveita.push({ opId: o.id, numero: o.numero, volume: v, livre });
      resta -= v;
    }
    const novas: LinhaPlano['novas'] = [];
    const lote = prod?.lote || 500;
    while (resta > 0.001) {
      const v = Math.min(lote, resta);
      novas.push({ lote, volume: v });
      resta -= v;
    }
    linhas.push({
      produtoId,
      necessidade,
      aproveita,
      novas,
      sobra: novas.reduce((s, n) => s + n.lote - n.volume, 0),
      tempoMin: novas.length * (prod?.tempoMin ?? 360),
    });
  }
  return linhas.sort((a, b) => b.necessidade - a.necessidade);
}

/** Aplica o plano do PCP: aloca em OPs existentes e cria as novas. Retorna novo estado. */
export function liberarPedido(e: Estado, pedidoId: string, agora: Date, por?: string): Estado {
  const pedido = e.pedidos.find((p) => p.id === pedidoId);
  if (!pedido) throw new ErroRegra('Pedido não encontrado.');
  if (pedido.pcpEm) throw new ErroRegra(`O pedido #${pedido.numero} já foi liberado.`);
  if (pedido.itens.some((i) => i.decisao === 'pendente')) throw new ErroRegra('Ainda há itens sem decisão (estoque ou produzir).');
  const plano = planejar(e, pedido);
  let seq = e.seqOP;
  const ops = e.ops.map((o) => ({ ...o, alocacoes: [...o.alocacoes] }));
  const novasNums: number[] = [];
  for (const l of plano) {
    for (const a of l.aproveita) ops.find((o) => o.id === a.opId)!.alocacoes.push({ pedidoId, volume: a.volume });
    for (const n of l.novas) {
      seq++;
      novasNums.push(seq);
      const prod = e.produtos[l.produtoId];
      ops.push({
        id: `op${seq}`,
        numero: seq,
        produtoId: l.produtoId,
        lote: n.lote,
        tempoPadraoMin: prod?.tempoMin ?? 360,
        alocacoes: [{ pedidoId, volume: n.volume }],
        status: 'fila',
        criadaEm: agora.toISOString(),
      });
    }
  }
  const aproveitadas = plano.reduce((s, l) => s + l.aproveita.length, 0);
  const estoque = pedido.itens.filter((i) => i.decisao === 'estoque').length;
  const texto = `PCP liberou: ${novasNums.length} OP(s) nova(s)${aproveitadas ? `, ${aproveitadas} aproveitada(s)` : ''}, ${estoque} item(ns) do estoque`;
  const pedidos = e.pedidos.map((p) =>
    p.id !== pedidoId ? p : { ...p, pcpEm: agora.toISOString(), eventos: [...p.eventos, { em: agora.toISOString(), texto, tipo: 'info' as const, por }] },
  );
  let novo: Estado = { ...e, ops, pedidos, seqOP: seq };
  novo = verificarProntos(novo, agora);
  return novo;
}

/** Marca como prontos os pedidos cujas OPs terminaram. */
export function verificarProntos(e: Estado, agora: Date): Estado {
  let mudou = false;
  const pedidos = e.pedidos.map((p) => {
    if (p.prontoEm || !p.pcpEm || p.expedidoEm) return p;
    const ops = opsDoPedido(e, p.id);
    if (ops.every((o) => o.status === 'concluida')) {
      mudou = true;
      return {
        ...p,
        prontoEm: agora.toISOString(),
        eventos: [...p.eventos, { em: agora.toISOString(), texto: 'Liberado para expedição', tipo: 'ok' as const }],
      };
    }
    return p;
  });
  return mudou ? { ...e, pedidos } : e;
}

/* ------------------------------------------------------------------ agenda */

export interface Previsao { inicio: Date; fim: Date; atrasada: boolean; ordem: number }
export interface Agenda {
  ops: Map<string, Previsao>;
  pedidos: Map<string, Date>;
  base: Date;
}

export function chavePrioridade(e: Estado, prioridade = e.prioridade) {
  const pos = new Map(prioridade.map((id, i) => [id, i]));
  return (o: OP) => Math.min(...o.alocacoes.map((a) => pos.get(a.pedidoId) ?? 9999), 9999);
}

export function filaOrdenada(e: Estado, prioridade = e.prioridade): OP[] {
  const k = chavePrioridade(e, prioridade);
  return e.ops.filter((o) => o.status === 'fila').sort((a, b) => k(a) - k(b) || a.numero - b.numero);
}

export function calcularAgenda(e: Estado, agora: Date, prioridade = e.prioridade): Agenda {
  const fer = e.config.feriados;
  const base = proximoExpediente(agora, fer);
  const res = new Map<string, Previsao>();
  let slots: Date[] = [];
  let ordem = 0;
  const emProd = e.ops.filter((o) => o.status === 'producao').sort((a, b) => a.inicio!.localeCompare(b.inicio!));
  for (const o of emProd) {
    const ini = new Date(o.inicio!);
    let fim = somarExpediente(ini, o.tempoPadraoMin, fer);
    const atrasada = fim < agora;
    // já passou do padrão: considera pelo menos mais 30 min de expediente
    if (atrasada) fim = somarExpediente(agora, 30, fer);
    res.set(o.id, { inicio: ini, fim, atrasada, ordem: ordem++ });
    slots.push(fim);
  }
  const cap = Math.max(1, e.config.capacidade);
  slots.sort((a, b) => a.getTime() - b.getTime());
  while (slots.length > cap) slots.shift();
  while (slots.length < cap) slots.push(base);
  for (const o of filaOrdenada(e, prioridade)) {
    slots.sort((a, b) => a.getTime() - b.getTime());
    const ini = proximoExpediente(slots[0] < base ? base : slots[0], fer);
    const fim = somarExpediente(ini, o.tempoPadraoMin, fer);
    res.set(o.id, { inicio: ini, fim, atrasada: false, ordem: ordem++ });
    slots[0] = fim;
  }
  const pedidos = new Map<string, Date>();
  for (const p of e.pedidos) {
    if (!p.pcpEm || p.prontoEm || p.expedidoEm) continue;
    let fim: Date | null = null;
    for (const o of opsDoPedido(e, p.id)) {
      const pv = res.get(o.id);
      if (pv && (!fim || pv.fim > fim)) fim = pv.fim;
    }
    if (fim) pedidos.set(p.id, fim);
  }
  return { ops: res, pedidos, base };
}

/** Situação do pedido em relação ao prazo (data previsão). */
export interface Prazo { tipo: 'ok' | 'risco' | 'atrasado' | 'sem'; texto: string; dias: number }
export function situacaoPrazo(e: Estado, p: Pedido, estimativa: Date | undefined, agora: Date): Prazo {
  if (!p.previsao) return { tipo: 'sem', texto: 'Sem prazo', dias: 0 };
  const limite = fimDoDia(p.previsao);
  const fer = e.config.feriados;
  const ref = p.expedidoEm ? new Date(p.expedidoEm) : p.prontoEm ? new Date(p.prontoEm) : estimativa ?? (p.pcpEm ? undefined : agora);
  if (!ref) return { tipo: 'sem', texto: '—', dias: 0 };
  if (ref <= limite) {
    const folga = expedienteEntre(ref, limite, fer) / MIN_DIA;
    if (!p.prontoEm && folga < 0.5) return { tipo: 'risco', texto: 'No limite do prazo', dias: 0 };
    return { tipo: 'ok', texto: 'No prazo', dias: 0 };
  }
  const dias = Math.max(1, Math.ceil(expedienteEntre(limite, ref, fer) / MIN_DIA - 0.05));
  const texto = !p.pcpEm ? `Prazo vencido há ${dias} dia${dias > 1 ? 's' : ''} út.` : `${dias} dia${dias > 1 ? 's' : ''} út. de atraso`;
  return { tipo: 'atrasado', texto, dias };
}

/* ------------------------------------------------------------------- ações */

export type AcaoOP = 'iniciar' | 'finalizar' | 'voltar' | 'reabrir';

/**
 * Muda a situação de uma OP.
 * - iniciar: fila → produção
 * - finalizar: produção → concluída (calcula o tempo real em minutos de expediente)
 * - voltar: produção → fila (desfaz um início)
 * - reabrir: concluída → produção (desfaz uma conclusão)
 */
export function mudarStatusOP(
  e: Estado,
  opId: string,
  acao: AcaoOP,
  quando: Date,
  extra: { motivo?: string; obs?: string; inicio?: Date; por?: string } = {},
  agora = new Date(),
): Estado {
  const fer = e.config.feriados;
  const atual = e.ops.find((o) => o.id === opId);
  if (!atual) throw new ErroRegra('OP não encontrada.');
  const esperado: Record<AcaoOP, StatusOP> = { iniciar: 'fila', finalizar: 'producao', voltar: 'producao', reabrir: 'concluida' };
  if (atual.status !== esperado[acao]) throw new ErroRegra(`A OP ${atual.numero} já mudou de situação. Atualize a tela.`);

  const ops = e.ops.map((o) => {
    if (o.id !== opId) return o;
    switch (acao) {
      case 'iniciar':
        return { ...o, status: 'producao' as const, inicio: quando.toISOString(), fim: undefined, realMin: undefined, iniciadaPor: extra.por };
      case 'voltar':
        return { ...o, status: 'fila' as const, inicio: undefined, fim: undefined, realMin: undefined, motivo: undefined, obs: undefined, iniciadaPor: undefined };
      case 'reabrir':
        return { ...o, status: 'producao' as const, fim: undefined, realMin: undefined, motivo: undefined, obs: undefined, finalizadaPor: undefined };
      case 'finalizar': {
        const ini = extra.inicio ?? new Date(o.inicio!);
        if (quando <= ini) throw new ErroRegra('O término precisa ser depois do início.');
        return {
          ...o,
          status: 'concluida' as const,
          inicio: ini.toISOString(),
          fim: quando.toISOString(),
          realMin: Math.round(expedienteEntre(ini, quando, fer)),
          motivo: extra.motivo,
          obs: extra.obs,
          finalizadaPor: extra.por,
        };
      }
    }
  });
  const op = ops.find((o) => o.id === opId)!;
  const texto = {
    iniciar: `OP ${op.numero} iniciada`,
    finalizar: `OP ${op.numero} concluída`,
    voltar: `OP ${op.numero} voltou para a fila`,
    reabrir: `OP ${op.numero} reaberta`,
  }[acao];
  const ids = new Set(op.alocacoes.map((a) => a.pedidoId));
  const pedidos = e.pedidos.map((p) => {
    if (!ids.has(p.id)) return p;
    const q: Pedido = {
      ...p,
      eventos: [...p.eventos, { em: agora.toISOString(), texto, tipo: acao === 'finalizar' ? 'ok' : 'info', por: extra.por }],
    };
    if ((acao === 'voltar' || acao === 'reabrir') && q.prontoEm && !q.expedidoEm) delete q.prontoEm;
    return q;
  });
  return verificarProntos({ ...e, ops, pedidos }, agora);
}

/** Erro de regra de negócio: mensagem pronta para mostrar ao usuário. */
export class ErroRegra extends Error {}

export function excluirPedido(e: Estado, pedidoId: string): Estado {
  const ops = e.ops
    .map((o) => (o.status === 'fila' ? { ...o, alocacoes: o.alocacoes.filter((a) => a.pedidoId !== pedidoId) } : o))
    .filter((o) => o.alocacoes.length > 0 || o.status !== 'fila');
  return {
    ...e,
    ops,
    pedidos: e.pedidos.filter((p) => p.id !== pedidoId),
    prioridade: e.prioridade.filter((id) => id !== pedidoId),
  };
}

export const MOTIVOS = [
  'Falta de matéria-prima',
  'Acerto de cor demorado',
  'Reprovado no laboratório / retrabalho',
  'Equipamento parado / manutenção',
  'Falta de embalagem ou rótulo',
  'Falta de pessoal',
  'Outro',
];
