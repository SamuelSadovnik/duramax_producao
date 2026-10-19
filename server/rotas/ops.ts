import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { expedienteEntre } from '../../shared/calendar.js';
import { mudarStatusOP, MOTIVOS, type AcaoOP } from '../../shared/engine.js';
import { exigir, type Vars } from '../auth.js';
import { mutar } from '../estado.js';

export const rotasOps = new Hono<{ Variables: Vars }>();

function data(v: unknown, nome: string): Date | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) throw new HTTPException(400, { message: `Data de ${nome} inválida.` });
  const agora = Date.now();
  if (d.getTime() > agora + 2 * 60_000) throw new HTTPException(400, { message: `O horário de ${nome} não pode estar no futuro.` });
  if (d.getTime() < agora - 45 * 86_400_000) throw new HTTPException(400, { message: `O horário de ${nome} é antigo demais.` });
  return d;
}

rotasOps.post('/:id/:acao{iniciar|finalizar|voltar|reabrir}', exigir('gerente', 'pcp'), async (c) => {
  const acao = c.req.param('acao') as AcaoOP;
  const b = await c.req.json().catch(() => ({}));
  const quando = data(b.quando, acao === 'iniciar' ? 'início' : 'término') ?? new Date();
  const inicio = data(b.inicio, 'início');
  const motivo = typeof b.motivo === 'string' && b.motivo ? b.motivo : undefined;
  if (motivo && !MOTIVOS.includes(motivo)) throw new HTTPException(400, { message: 'Motivo inválido.' });
  const obs = typeof b.obs === 'string' ? b.obs.trim().slice(0, 500) || undefined : undefined;
  const por = c.get('usuario').nome;

  const r = await mutar((e, agora) => {
    if (acao === 'finalizar') {
      const op = e.ops.find((o) => o.id === c.req.param('id'));
      if (op?.status === 'producao') {
        const ini = inicio ?? new Date(op.inicio!);
        const real = expedienteEntre(ini, quando, e.config.feriados);
        if (real > op.tempoPadraoMin * (1 + e.config.toleranciaPct / 100) && !motivo) {
          throw new HTTPException(400, { message: 'A OP passou do tempo padrão: informe o motivo do atraso.' });
        }
      }
    }
    return mudarStatusOP(e, c.req.param('id'), acao, quando, { motivo, obs, inicio, por }, agora);
  });
  return c.json(r);
});
