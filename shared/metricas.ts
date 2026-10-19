/**
 * Métricas da tela de Desempenho. Funções puras sobre o estado, para poderem ser testadas.
 *
 * Definições (as mesmas que aparecem na tela):
 * - Entregas no prazo: pedidos que ficaram prontos no período até o fim do dia do prazo.
 * - Lead time: horas de expediente entre a entrada do pedido no sistema e ficar pronto, em dias úteis.
 * - Tempo no PCP: horas de expediente entre a entrada do pedido e a liberação pelo PCP.
 * - Eficiência: soma do tempo padrão ÷ soma do tempo real das OPs concluídas (100% = no padrão).
 * - OPs no tempo: OPs com tempo real até o padrão + tolerância.
 * - Tempo perdido: soma do que passou do padrão nas OPs acima da tolerância.
 */
import { diaUtil, expedienteEntre, fimDoDia, MIN_DIA } from './calendar.js';
import { prazoDoPedido } from './engine.js';
import { inicioDoDia, iso, partes, somarDias } from './tz.js';
import type { Estado, OP, Pedido } from './types.js';

export type PeriodoK = 'hoje' | '7' | '30' | 'tudo';
export interface Intervalo { desde: Date; ate: Date }

export function intervalos(k: PeriodoK, agora: Date): { atual: Intervalo; anterior: Intervalo | null } {
  if (k === 'tudo') return { atual: { desde: new Date(0), ate: agora }, anterior: null };
  if (k === 'hoje') return { atual: { desde: inicioDoDia(agora), ate: agora }, anterior: null };
  const dias = Number(k) * 86_400_000;
  const desde = new Date(agora.getTime() - dias);
  return { atual: { desde, ate: agora }, anterior: { desde: new Date(desde.getTime() - dias), ate: desde } };
}

const dentro = (s: string | undefined, i: Intervalo) => {
  if (!s) return false;
  const t = new Date(s).getTime();
  return t >= i.desde.getTime() && t <= i.ate.getTime();
};
export const linhaDe = (produtoId: string) => produtoId.split('.')[0];
const pedidoDaLinha = (p: Pedido, linha: string) => !linha || p.itens.some((i) => linhaDe(i.produtoId) === linha);

export const toleranciaDe = (e: Estado) => 1 + e.config.toleranciaPct / 100;
export const acimaDaTolerancia = (e: Estado, o: OP) => (o.realMin ?? 0) > o.tempoPadraoMin * toleranciaDe(e);
export const perdaDe = (o: OP) => Math.max(0, (o.realMin ?? 0) - o.tempoPadraoMin);

export function opsConcluidas(e: Estado, i: Intervalo, linha = ''): OP[] {
  return e.ops
    .filter((o) => o.status === 'concluida' && dentro(o.fim, i) && (!linha || linhaDe(o.produtoId) === linha))
    .sort((a, b) => b.fim!.localeCompare(a.fim!));
}

export interface Indicadores {
  nOps: number;
  volume: number;
  eficiencia: number | null; // %
  pctNoTempo: number | null;
  perdidoMin: number;
  nAcima: number;
  pedidosProntos: number;
  noPrazo: number;
  pctPrazo: number | null;
  leadTimeDias: number | null;
  pcpHoras: number | null;
}

export function indicadores(e: Estado, i: Intervalo, linha = ''): Indicadores {
  const fer = e.config.feriados;
  const ops = opsConcluidas(e, i, linha);
  const padrao = ops.reduce((s, o) => s + o.tempoPadraoMin, 0);
  const real = ops.reduce((s, o) => s + (o.realMin ?? 0), 0);
  const acima = ops.filter((o) => acimaDaTolerancia(e, o));
  const prontos = e.pedidos.filter((p) => dentro(p.prontoEm, i) && pedidoDaLinha(p, linha));
  const noPrazo = prontos.filter((p) => new Date(p.prontoEm!) <= fimDoDia(prazoDoPedido(e, p))).length;
  const lead = prontos.map((p) => expedienteEntre(new Date(p.importadoEm), new Date(p.prontoEm!), fer) / MIN_DIA);
  const liberados = e.pedidos.filter((p) => dentro(p.pcpEm, i) && pedidoDaLinha(p, linha));
  const pcp = liberados.map((p) => expedienteEntre(new Date(p.importadoEm), new Date(p.pcpEm!), fer) / 60);
  const media = (l: number[]) => (l.length ? l.reduce((s, x) => s + x, 0) / l.length : null);
  return {
    nOps: ops.length,
    volume: ops.reduce((s, o) => s + o.lote, 0),
    eficiencia: real > 0 ? (padrao / real) * 100 : null,
    pctNoTempo: ops.length ? ((ops.length - acima.length) / ops.length) * 100 : null,
    perdidoMin: acima.reduce((s, o) => s + perdaDe(o), 0),
    nAcima: acima.length,
    pedidosProntos: prontos.length,
    noPrazo,
    pctPrazo: prontos.length ? (noPrazo / prontos.length) * 100 : null,
    leadTimeDias: media(lead),
    pcpHoras: media(pcp),
  };
}

/** Volume concluído por dia útil, separado por linha de produto. */
export function volumePorDia(e: Estado, agora: Date, nDias = 15, linha = '') {
  const fer = e.config.feriados;
  const dias: Date[] = [];
  let c = inicioDoDia(agora);
  while (dias.length < nDias) {
    if (diaUtil(c, fer)) dias.unshift(new Date(c));
    c = somarDias(c, -1);
  }
  const idx = new Map(dias.map((d, k) => [iso(d), k]));
  const serie = dias.map((d) => ({ d, total: 0, porLinha: {} as Record<string, number>, nOps: 0, acima: 0 }));
  for (const o of e.ops) {
    if (o.status !== 'concluida' || !o.fim || (linha && linhaDe(o.produtoId) !== linha)) continue;
    const k = idx.get(iso(new Date(o.fim)));
    if (k === undefined) continue;
    const s = serie[k];
    const l = linhaDe(o.produtoId);
    s.porLinha[l] = (s.porLinha[l] ?? 0) + o.lote;
    s.total += o.lote;
    s.nOps++;
    if (acimaDaTolerancia(e, o)) s.acima++;
  }
  return serie;
}

/** Últimas semanas (segunda a domingo): volume, eficiência, OPs no tempo e entregas no prazo. */
export function evolucaoSemanal(e: Estado, agora: Date, nSemanas = 8, linha = '') {
  const hoje = inicioDoDia(agora);
  const seg = somarDias(hoje, -((partes(hoje).semana + 6) % 7));
  const out = [];
  for (let k = nSemanas - 1; k >= 0; k--) {
    const desde = somarDias(seg, -7 * k);
    const ate = new Date(Math.min(somarDias(desde, 7).getTime() - 1, agora.getTime()));
    out.push({ inicio: desde, atual: k === 0, ...indicadores(e, { desde, ate }, linha) });
  }
  return out;
}

/** Pareto dos motivos de atraso no período (só OPs acima da tolerância). */
export function paretoMotivos(e: Estado, i: Intervalo, linha = '') {
  const late = opsConcluidas(e, i, linha).filter((o) => acimaDaTolerancia(e, o));
  const m = new Map<string, { n: number; min: number }>();
  for (const o of late) {
    const k = o.motivo ?? 'Sem motivo informado';
    const v = m.get(k) ?? { n: 0, min: 0 };
    v.n++;
    v.min += perdaDe(o);
    m.set(k, v);
  }
  const lista = [...m].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.min - a.min);
  const total = lista.reduce((s, x) => s + x.min, 0);
  let acum = 0;
  return lista.map((x) => {
    acum += x.min;
    return { ...x, pct: total ? (x.min / total) * 100 : 0, acumulado: total ? (acum / total) * 100 : 0 };
  });
}

/** Produtos com mais tempo perdido no período. */
export function produtosQueEstouram(e: Estado, i: Intervalo, linha = '', n = 6) {
  const ops = opsConcluidas(e, i, linha);
  const m = new Map<string, { n: number; acima: number; min: number; padrao: number; real: number }>();
  for (const o of ops) {
    const v = m.get(o.produtoId) ?? { n: 0, acima: 0, min: 0, padrao: 0, real: 0 };
    v.n++;
    v.padrao += o.tempoPadraoMin;
    v.real += o.realMin ?? 0;
    if (acimaDaTolerancia(e, o)) {
      v.acima++;
      v.min += perdaDe(o);
    }
    m.set(o.produtoId, v);
  }
  return [...m]
    .map(([pid, v]) => ({ pid, ...v, eficiencia: v.real ? (v.padrao / v.real) * 100 : 100 }))
    .filter((x) => x.min > 0)
    .sort((a, b) => b.min - a.min)
    .slice(0, n);
}

/** Volume e eficiência por linha de produto no período. */
export function porLinha(e: Estado, i: Intervalo) {
  const m = new Map<string, { volume: number; n: number; padrao: number; real: number }>();
  for (const o of opsConcluidas(e, i)) {
    const l = linhaDe(o.produtoId);
    const v = m.get(l) ?? { volume: 0, n: 0, padrao: 0, real: 0 };
    v.volume += o.lote;
    v.n++;
    v.padrao += o.tempoPadraoMin;
    v.real += o.realMin ?? 0;
    m.set(l, v);
  }
  const total = [...m.values()].reduce((s, v) => s + v.volume, 0);
  return [...m]
    .map(([linha, v]) => ({ linha, ...v, pct: total ? (v.volume / total) * 100 : 0, eficiencia: v.real ? (v.padrao / v.real) * 100 : null }))
    .sort((a, b) => b.volume - a.volume);
}

/** Carteira agora: o que está em cada etapa e quanto trabalho tem pela frente. */
export function carteira(e: Estado, agora: Date, status: (p: Pedido) => string) {
  const fer = e.config.feriados;
  const etapas = { pcp: { n: 0, volume: 0 }, fila: { n: 0, volume: 0 }, producao: { n: 0, volume: 0 }, pronto: { n: 0, volume: 0 } };
  for (const p of e.pedidos) {
    const st = status(p) as keyof typeof etapas;
    if (!(st in etapas)) continue;
    etapas[st].n++;
    etapas[st].volume += p.itens.reduce((s, i) => s + i.volume, 0);
  }
  const filaMin = e.ops.filter((o) => o.status === 'fila').reduce((s, o) => s + o.tempoPadraoMin, 0);
  const restanteMin = e.ops
    .filter((o) => o.status === 'producao' && o.inicio)
    .reduce((s, o) => s + Math.max(0, o.tempoPadraoMin - expedienteEntre(new Date(o.inicio!), agora, fer)), 0);
  const opsFila = e.ops.filter((o) => o.status === 'fila').length;
  const horas = (filaMin + restanteMin) / 60;
  return { etapas, opsFila, horas, diasFabrica: (filaMin + restanteMin) / (MIN_DIA * Math.max(1, e.config.capacidade)) };
}
