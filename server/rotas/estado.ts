import { Hono } from 'hono';
import { exigir, type Vars } from '../auth.js';
import { db } from '../db.js';
import { carregar } from '../estado.js';

export const rotasEstado = new Hono<{ Variables: Vars }>();

/** Estado completo para as telas (pedidos ativos e dos últimos meses, OPs, produtos, configuração). */
rotasEstado.get('/estado', exigir(), async (c) => {
  const { estado } = await carregar(db());
  return c.json({ estado });
});

/** Consulta leve feita a cada poucos segundos: as telas só recarregam quando a versão muda. */
rotasEstado.get('/versao', exigir(), async (c) => {
  const r = await db().query('select versao from config where id = 1');
  return c.json({ versao: r.rows[0].versao });
});
