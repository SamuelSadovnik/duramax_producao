import { describe, expect, it } from 'vitest';
import { liberarPedido, mudarStatusOP, statusPedido } from '../shared/engine';
import { atualizarProduto, decidirItens, importarPedidos } from '../shared/acoes';
import { carteira, evolucaoSemanal, indicadores, intervalos, paretoMotivos, volumePorDia } from '../shared/metricas';
import type { Estado } from '../shared/types';
import type { PedidoLido } from '../shared/parse';
import { deISOlocal } from '../shared/tz';

const vazio = (): Estado => ({ versao: 0, produtos: {}, pedidos: [], ops: [], prioridade: [], config: { capacidade: 2, toleranciaPct: 10, prazoDiasUteis: 7, feriados: [] }, seqOP: 0 });
const lido = (numero: string, codFab: string, qtde: number): PedidoLido => ({
  numero, cliente: 'C', fantasia: 'F', cidade: 'X', uf: 'PR', vendedor: 'V', transportadora: 'T', emissao: '2026-10-12', previsao: '2026-10-12', hora: '', avisos: [],
  itens: [{ codigo: '0', descricao: 'x', codFab, qtde, embalagem: 18, produtoId: codFab.split('.').slice(0, -1).join('.'), produtoNome: 'P' }],
});

/** Dois pedidos (valores de teste): um termina no tempo, outro passa 2h do padrão. */
function cenario() {
  const entrada = deISOlocal('2026-10-12', '08:00'); // segunda
  let e = importarPedidos(vazio(), [{ pedido: lido('1', '600.1.18', 20) }, { pedido: lido('2', '610.2.18', 20) }], entrada).estado;
  e = atualizarProduto(e, '600.1', { lote: 400, tempoMin: 300 });
  e = atualizarProduto(e, '610.2', { lote: 400, tempoMin: 300 });
  for (const id of ['p1', 'p2']) {
    e = decidirItens(e, id, e.pedidos.find((p) => p.id === id)!.itens.map((i) => i.id), 'op');
    e = liberarPedido(e, id, deISOlocal('2026-10-12', '10:00'));
  }
  const [o1, o2] = e.ops;
  e = mudarStatusOP(e, o1.id, 'iniciar', deISOlocal('2026-10-13', '07:30'));
  e = mudarStatusOP(e, o1.id, 'finalizar', deISOlocal('2026-10-13', '13:42'), {}, deISOlocal('2026-10-13', '13:42')); // 4h30 + 30min = 5h00
  e = mudarStatusOP(e, o2.id, 'iniciar', deISOlocal('2026-10-14', '07:30'));
  e = mudarStatusOP(e, o2.id, 'finalizar', deISOlocal('2026-10-14', '15:42'), { motivo: 'Falta de matéria-prima' }, deISOlocal('2026-10-14', '15:42')); // 7h00
  return e;
}

describe('métricas de desempenho', () => {
  const agora = deISOlocal('2026-10-16', '12:00');
  it('calcula eficiência, OPs no tempo, tempo perdido e entregas', () => {
    const e = cenario();
    const i = indicadores(e, intervalos('7', agora).atual);
    expect(i.nOps).toBe(2);
    expect(i.volume).toBe(800);
    expect(i.eficiencia).toBeCloseTo((600 / 720) * 100, 5);
    expect(i.pctNoTempo).toBe(50);
    expect(i.perdidoMin).toBe(120);
    expect(i.pedidosProntos).toBe(2);
    expect(i.pctPrazo).toBe(100);
    expect(i.pcpHoras).toBeCloseTo(2, 5);
  });
  it('filtra por linha de produto', () => {
    const i = indicadores(cenario(), intervalos('7', agora).atual, '610');
    expect(i.nOps).toBe(1);
    expect(i.pctNoTempo).toBe(0);
    expect(i.pedidosProntos).toBe(1);
  });
  it('monta o Pareto de motivos com acumulado', () => {
    const p = paretoMotivos(cenario(), intervalos('7', agora).atual);
    expect(p).toEqual([{ k: 'Falta de matéria-prima', n: 1, min: 120, pct: 100, acumulado: 100 }]);
  });
  it('soma volume por dia útil e por linha', () => {
    const s = volumePorDia(cenario(), agora, 5);
    expect(s.map((x) => x.total)).toEqual([0, 400, 400, 0, 0]);
    expect(s[2].porLinha).toEqual({ '610': 400 });
  });
  it('agrupa por semana começando na segunda', () => {
    const s = evolucaoSemanal(cenario(), agora, 2);
    expect(s[1].nOps).toBe(2);
    expect(s[0].nOps).toBe(0);
  });
  it('mede a carteira em dias de fábrica', () => {
    let e = importarPedidos(vazio(), [{ pedido: lido('3', '600.1.18', 20) }], agora).estado;
    e = atualizarProduto(e, '600.1', { lote: 400, tempoMin: 528 });
    e = decidirItens(e, 'p3', e.pedidos[0].itens.map((i) => i.id), 'op');
    e = liberarPedido(e, 'p3', agora);
    const c = carteira(e, agora, (p) => statusPedido(e, p));
    expect(c.etapas.fila).toEqual({ n: 1, volume: 360 });
    expect(c.horas).toBeCloseTo(8.8, 5);
    expect(c.diasFabrica).toBeCloseTo(0.5, 5);
  });
});
