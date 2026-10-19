import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { decidirItens, excluirPedido, expedirPedido, importarPedidos, type Importacao } from '../../shared/acoes.js';
import { liberarPedido, statusPedido } from '../../shared/engine.js';
import type { Decisao } from '../../shared/types.js';
import { exigir, type Vars } from '../auth.js';
import { mutar } from '../estado.js';

export const rotasPedidos = new Hono<{ Variables: Vars }>();

rotasPedidos.post('/importar', exigir('comercial', 'pcp'), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const lista = b.pedidos as Importacao[];
  if (!Array.isArray(lista) || !lista.length || lista.length > 50) throw new HTTPException(400, { message: 'Envie de 1 a 50 pedidos.' });
  const por = c.get('usuario').nome;
  const r = await mutar<{ novosProdutos: number; importados: string[] }>((e, agora) => importarPedidos(e, lista, agora, por));
  return c.json(r);
});

rotasPedidos.post('/:id/decisoes', exigir('pcp'), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (!Array.isArray(b.itens) || !b.itens.every((x: unknown) => typeof x === 'string')) throw new HTTPException(400, { message: 'Itens inválidos.' });
  const r = await mutar((e) => decidirItens(e, c.req.param('id'), b.itens, b.decisao as Decisao));
  return c.json(r);
});

rotasPedidos.post('/:id/liberar', exigir('pcp'), async (c) => {
  const por = c.get('usuario').nome;
  const r = await mutar((e, agora) => liberarPedido(e, c.req.param('id'), agora, por));
  return c.json(r);
});

rotasPedidos.post('/:id/expedir', exigir('comercial', 'pcp'), async (c) => {
  const por = c.get('usuario').nome;
  const r = await mutar((e, agora) => expedirPedido(e, c.req.param('id'), agora, por));
  return c.json(r);
});

rotasPedidos.delete('/:id', exigir('comercial', 'pcp'), async (c) => {
  const id = c.req.param('id');
  const r = await mutar((e) => {
    const p = e.pedidos.find((x) => x.id === id);
    if (!p) throw new HTTPException(404, { message: 'Pedido não encontrado.' });
    if (statusPedido(e, p) === 'expedido') throw new HTTPException(400, { message: 'Pedido já expedido não pode ser excluído.' });
    return excluirPedido(e, id);
  });
  return c.json(r);
});

