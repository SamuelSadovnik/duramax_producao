import { describe, expect, it } from 'vitest';
import { calcularAgenda, liberarPedido, mudarStatusOP, planejar, statusPedido, ErroRegra } from '../shared/engine';
import { decidirItens, definirPrioridade, expedirPedido, importarPedidos, atualizarProduto } from '../shared/acoes';
import type { Estado } from '../shared/types';
import type { PedidoLido } from '../shared/parse';
import { deISOlocal } from '../shared/tz';

const agora = deISOlocal('2026-10-19', '09:00');
const vazio = (): Estado => ({ versao: 0, produtos: {}, pedidos: [], ops: [], prioridade: [], config: { capacidade: 2, toleranciaPct: 10, feriados: [] }, seqOP: 100 });
const item = (codFab: string, qtde: number, embalagem: number, nome: string) => ({
  codigo: '0', descricao: nome, codFab, qtde, embalagem, produtoId: codFab.split('.').slice(0, -1).join('.'), produtoNome: nome,
});
const lido = (numero: string, itens: ReturnType<typeof item>[]): PedidoLido => ({
  numero, cliente: 'C', fantasia: 'F', cidade: 'X', uf: 'PR', vendedor: 'V', transportadora: 'T', emissao: '2026-10-19', previsao: '2026-10-19', hora: '', itens, avisos: [],
});

function cenario() {
  let e = vazio();
  e = importarPedidos(e, [
    { pedido: lido('1', [item('600.1000.4', 144, 3.6, 'Branco BR'), item('600.1000.18', 4, 18, 'Branco BR'), item('600.8550.4', 10, 3.6, 'Preto BR')]), prazo: '2026-10-23' },
    { pedido: lido('2', [item('600.1000.4', 20, 3.6, 'Branco BR')]), prazo: '2026-10-23' },
  ], agora, 'Samuel').estado;
  return e;
}

describe('importação', () => {
  it('cria pedidos, produtos e coloca no fim da fila', () => {
    const e = cenario();
    expect(e.pedidos.map((p) => p.numero)).toEqual(['1', '2']);
    expect(e.prioridade).toEqual(['p1', 'p2']);
    expect(Object.keys(e.produtos).sort()).toEqual(['600.1000', '600.8550']);
    expect(e.produtos['600.1000'].pendente).toBe(true);
  });
  it('recusa pedido duplicado', () => {
    expect(() => importarPedidos(cenario(), [{ pedido: lido('1', [item('600.1.4', 1, 3.6, 'x')]), prazo: '' }], agora)).toThrow(ErroRegra);
  });
});

describe('PCP e OPs', () => {
  it('agrupa embalagens do mesmo produto em lotes', () => {
    let e = cenario();
    e = decidirItens(e, 'p1', e.pedidos[0].itens.map((i) => i.id), 'op');
    const plano = planejar(e, e.pedidos[0]);
    const branco = plano.find((l) => l.produtoId === '600.1000')!;
    expect(branco.necessidade).toBeCloseTo(144 * 3.6 + 72);
    expect(branco.novas).toHaveLength(1); // lote sugerido de 600 L
    expect(branco.sobra).toBeCloseTo(600 - 590.4);
  });

  it('aproveita a sobra de OP que ainda não começou', () => {
    let e = cenario();
    e = decidirItens(e, 'p1', e.pedidos[0].itens.map((i) => i.id), 'op');
    e = liberarPedido(e, 'p1', agora);
    expect(e.ops).toHaveLength(2);
    e = decidirItens(e, 'p2', e.pedidos[1].itens.map((i) => i.id), 'op');
    const plano = planejar(e, e.pedidos[1]);
    expect(plano[0].aproveita[0].volume).toBeCloseTo(9.6);
    expect(plano[0].novas).toHaveLength(1);
  });

  it('não libera com item pendente', () => {
    expect(() => liberarPedido(cenario(), 'p1', agora)).toThrow(/sem decisão/);
  });

  it('pedido só com estoque fica pronto na hora', () => {
    let e = cenario();
    e = decidirItens(e, 'p2', e.pedidos[1].itens.map((i) => i.id), 'estoque');
    e = liberarPedido(e, 'p2', agora);
    expect(statusPedido(e, e.pedidos[1])).toBe('pronto');
    e = expedirPedido(e, 'p2', agora);
    expect(statusPedido(e, e.pedidos[1])).toBe('expedido');
    expect(e.prioridade).toEqual(['p1']);
  });

  it('iniciar → finalizar libera o pedido e calcula o tempo real', () => {
    let e = cenario();
    e = decidirItens(e, 'p1', e.pedidos[0].itens.map((i) => i.id), 'op');
    e = liberarPedido(e, 'p1', agora);
    const [a, b] = e.ops;
    e = mudarStatusOP(e, a.id, 'iniciar', agora, { por: 'João' });
    expect(() => mudarStatusOP(e, a.id, 'iniciar', agora)).toThrow(ErroRegra);
    e = mudarStatusOP(e, a.id, 'finalizar', deISOlocal('2026-10-19', '15:12'), {}, agora);
    expect(e.ops[0].realMin).toBe(180 + 120); // 09:00–12:00 + 13:12–15:12
    expect(statusPedido(e, e.pedidos[0])).toBe('producao');
    e = mudarStatusOP(e, b.id, 'iniciar', agora);
    e = mudarStatusOP(e, b.id, 'finalizar', deISOlocal('2026-10-19', '10:00'), {}, agora);
    expect(statusPedido(e, e.pedidos[0])).toBe('pronto');
    e = mudarStatusOP(e, b.id, 'reabrir', agora);
    expect(statusPedido(e, e.pedidos[0])).toBe('producao');
  });

  it('prioridade muda a estimativa', () => {
    let e = cenario();
    for (const id of ['p1', 'p2']) {
      e = decidirItens(e, id, e.pedidos.find((p) => p.id === id)!.itens.map((i) => i.id), 'op');
      e = liberarPedido(e, id, agora);
    }
    e = { ...e, config: { ...e.config, capacidade: 1 } };
    const antes = calcularAgenda(e, agora).pedidos;
    const depois = calcularAgenda(definirPrioridade(e, ['p2', 'p1']), agora).pedidos;
    expect(depois.get('p1')!.getTime()).toBeGreaterThanOrEqual(antes.get('p1')!.getTime());
  });

  it('novo tempo padrão vale para OPs na fila', () => {
    let e = cenario();
    e = decidirItens(e, 'p1', e.pedidos[0].itens.map((i) => i.id), 'op');
    e = liberarPedido(e, 'p1', agora);
    e = atualizarProduto(e, '600.1000', { tempoMin: 400 });
    expect(e.ops.find((o) => o.produtoId === '600.1000')!.tempoPadraoMin).toBe(400);
    expect(e.produtos['600.1000'].pendente).toBe(false);
  });
});
