/**
 * Simulação da fábrica para dados de teste: libera os pedidos nos horários combinados e
 * produz as OPs na ordem da fila, com 2 postos ao mesmo tempo, até o momento atual.
 * Algumas OPs passam do tempo (com motivo), outras ficam em produção agora e o resto na fila.
 */
import { decidirItens, expedirPedido } from '../shared/acoes.js';
import { filaOrdenada, liberarPedido, mudarStatusOP, MOTIVOS } from '../shared/engine.js';
import { proximoExpediente, somarExpediente, subtrairExpediente } from '../shared/calendar.js';
import type { Estado, OP } from '../shared/types.js';

/** Gerador pseudoaleatório fixo: os dados saem sempre iguais. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface PedidoSimulado {
  id: string;
  /** quando o PCP libera; null = continua aguardando o PCP */
  liberar: Date | null;
}

export function simularFabrica(
  e0: Estado,
  pedidos: PedidoSimulado[],
  inicio: Date,
  agora: Date,
  r: () => number,
  podeProduzir: (o: OP) => boolean,
  pctEstoque = 0.2,
): Estado {
  let e = e0;
  const fer = e.config.feriados;
  const escolha = <T,>(l: T[]) => l[Math.floor(r() * l.length)];
  const pend = pedidos.filter((p) => p.liberar && p.liberar < agora).sort((a, b) => a.liberar!.getTime() - b.liberar!.getTime());
  const liberarAte = (t: Date) => {
    while (pend.length && pend[0].liberar! <= t) {
      const p = pend.shift()!;
      const ped = e.pedidos.find((x) => x.id === p.id)!;
      // uma parte dos itens sai do estoque, o resto vira OP
      const estoque = ped.itens.filter(() => r() < pctEstoque).map((i) => i.id);
      e = decidirItens(e, p.id, ped.itens.map((i) => i.id), 'op');
      if (estoque.length < ped.itens.length) e = decidirItens(e, p.id, estoque, 'estoque');
      e = liberarPedido(e, p.id, p.liberar!, 'Teste');
    }
  };
  // horário em que cada um dos 2 postos fica livre; null = ocupado com uma OP que segue em produção agora
  const postos: (Date | null)[] = [inicio, somarExpediente(inicio, 45, fer)];
  for (let passo = 0; passo < 800; passo++) {
    const livres = postos.map((d, i) => [d, i] as const).filter((x): x is readonly [Date, number] => x[0] !== null);
    if (!livres.length) break;
    const k = livres.reduce((m, x) => (x[0] < m[0] ? x : m))[1];
    const t = proximoExpediente(postos[k]!, fer);
    if (t >= agora) {
      postos[k] = null;
      continue;
    }
    liberarAte(t);
    const prox = filaOrdenada(e).find(podeProduzir);
    if (!prox) {
      if (!pend.length || pend[0].liberar! >= agora) {
        postos[k] = null; // posto parado: não há mais o que produzir
        continue;
      }
      postos[k] = pend[0].liberar!;
      continue;
    }
    const sorte = r();
    const fator = sorte < 0.62 ? 0.82 + r() * 0.24 : sorte < 0.85 ? 1.12 + r() * 0.2 : 1.35 + r() * 0.5;
    const fim = somarExpediente(t, Math.round(prox.tempoPadraoMin * fator), fer);
    e = mudarStatusOP(e, prox.id, 'iniciar', t, { por: 'Teste' }, t);
    if (fim < subtrairExpediente(agora, 10, fer)) {
      const passou = fator > 1 + e.config.toleranciaPct / 100;
      e = mudarStatusOP(e, prox.id, 'finalizar', fim, { motivo: passou ? escolha(MOTIVOS.slice(0, 6)) : undefined, por: 'Teste' }, fim);
      postos[k] = somarExpediente(fim, 15, fer);
    } else {
      postos[k] = null; // continua produzindo agora
    }
  }
  liberarAte(agora);
  return e;
}

/** Marca como expedidos metade dos pedidos que ficaram prontos (3h depois de ficarem prontos). */
export function expedirMetade(e0: Estado, agora: Date, ehDoTeste: (numero: string) => boolean): Estado {
  let e = e0;
  const fer = e.config.feriados;
  const prontos = e.pedidos.filter((p) => ehDoTeste(p.numero) && p.prontoEm && !p.expedidoEm);
  prontos.forEach((p, i) => {
    const em = somarExpediente(new Date(p.prontoEm!), 180, fer);
    if (i % 2 === 0 && em < agora) e = expedirPedido(e, p.id, em, 'Teste');
  });
  return e;
}
