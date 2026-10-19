import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { atualizarConfig, atualizarProduto, definirPrioridade } from '../../shared/acoes.js';
import { exigir, type Vars } from '../auth.js';
import { mutar } from '../estado.js';

export const rotasCadastros = new Hono<{ Variables: Vars }>();

rotasCadastros.put('/prioridade', exigir('comercial', 'pcp'), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!Array.isArray(b.ids) || !b.ids.every((x: unknown) => typeof x === 'string')) throw new HTTPException(400, { message: 'Lista de pedidos inválida.' });
  const r = await mutar((e) => definirPrioridade(e, b.ids));
  return c.json(r);
});

rotasCadastros.patch('/produtos/:id', exigir('pcp'), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const patch: { lote?: number; tempoMin?: number; nome?: string } = {};
  if (b.lote !== undefined) patch.lote = Number(b.lote);
  if (b.tempoMin !== undefined) patch.tempoMin = Number(b.tempoMin);
  if (typeof b.nome === 'string') patch.nome = b.nome;
  const r = await mutar((e) => atualizarProduto(e, c.req.param('id'), patch));
  return c.json(r);
});

rotasCadastros.patch('/config', exigir('pcp'), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const r = await mutar((e) => atualizarConfig(e, { capacidade: b.capacidade, toleranciaPct: b.toleranciaPct, prazoDiasUteis: b.prazoDiasUteis, feriados: b.feriados }));
  return c.json(r);
});
