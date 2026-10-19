import { useMemo, useState } from 'react';
import { pode, useApp } from './store';
import { Icon, PrazoChip, ProgressoOPs, estimativaTexto, nomeOP, useTip } from './ui';
import { calcularAgenda, prazoDoPedido, situacaoPrazo, statusPedido, volumePedido, type Agenda } from '../shared/engine';
import { expedienteEntre, MIN_DIA, proximoExpediente, somarExpediente, diaUtil } from '../shared/calendar';
import { dataCurta, dataISOparaBR, diaSemana, fmtDur, fmtVol, quando, titulo } from '../shared/fmt';
import type { Estado, Pedido } from '../shared/types';
import { api } from './api';
import { inicioDoDia, somarDias } from '../shared/tz';

const SITUACAO: Record<string, { t: string; c: string }> = {
  pcp: { t: 'Aguardando PCP', c: 'warn' },
  fila: { t: 'Na fila', c: '' },
  producao: { t: 'Em produção', c: 'info' },
};

export function FilaView() {
  const { e, executar, agora, agenda, abrirPedido, perfil } = useApp();
  const podeMexer = pode.prioridade(perfil);
  const ativos = useMemo(
    () =>
      e.prioridade
        .map((id) => e.pedidos.find((p) => p.id === id))
        .filter((p): p is Pedido => !!p && ['pcp', 'fila', 'producao'].includes(statusPedido(e, p))),
    [e],
  );
  const [rascunho, setRascunho] = useState<string[] | null>(null);
  const ordem = rascunho ?? ativos.map((p) => p.id);
  const [arr, setArr] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);

  const prioridadeCompleta = (o: string[]) => [...o, ...e.prioridade.filter((id) => !o.includes(id))];
  const agendaSim: Agenda = useMemo(
    () => (rascunho ? calcularAgenda(e, agora, prioridadeCompleta(rascunho)) : agenda),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rascunho, e, agora, agenda],
  );

  const mover = (id: string, para: number) => {
    const o = ordem.filter((x) => x !== id);
    o.splice(Math.max(0, Math.min(para, o.length)), 0, id);
    const igual = o.every((x, i) => x === ativos[i]?.id);
    setRascunho(igual ? null : o);
  };

  const deltas = useMemo(() => {
    const m = new Map<string, number>();
    if (!rascunho) return m;
    for (const p of ativos) {
      const a = agenda.pedidos.get(p.id);
      const b = agendaSim.pedidos.get(p.id);
      if (!a || !b) continue;
      const d = b > a ? expedienteEntre(a, b, e.config.feriados) : -expedienteEntre(b, a, e.config.feriados);
      if (Math.abs(d) >= 1) m.set(p.id, d);
    }
    return m;
  }, [rascunho, agenda, agendaSim, ativos, e.config.feriados]);

  const piores = [...deltas.values()].filter((d) => d > 0).length;
  const melhores = [...deltas.values()].filter((d) => d < 0).length;
  const novosAtrasos = rascunho
    ? ativos.filter((p) => {
        const a = situacaoPrazo(e, p, agenda.pedidos.get(p.id), agora).tipo;
        const b = situacaoPrazo(e, p, agendaSim.pedidos.get(p.id), agora).tipo;
        return a !== 'atrasado' && b === 'atrasado';
      })
    : [];

  const aplicar = async () => {
    const nova = prioridadeCompleta(rascunho!);
    const anterior = e.prioridade;
    const ok = await executar(() => api.prioridade(nova), {
      texto: 'Nova prioridade aplicada. TV da produção e estimativas atualizadas.',
      tipo: 'ok',
      desfazer: () => executar(() => api.prioridade(anterior), 'Prioridade anterior restaurada.'),
    });
    if (ok) setRascunho(null);
  };

  const cont = { pcp: 0, fila: 0, producao: 0, atraso: 0 };
  for (const p of ativos) {
    cont[statusPedido(e, p) as 'pcp' | 'fila' | 'producao']++;
    if (situacaoPrazo(e, p, agenda.pedidos.get(p.id), agora).tipo === 'atrasado') cont.atraso++;
  }
  const temOps = agendaSim.ops.size > 0;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Fila e previsão</h1>
          <p>Ordem em que os pedidos serão produzidos. Arraste ou use as setas; antes de aplicar, a simulação mostra quem adianta e quem atrasa.</p>
        </div>
        <div className="acts fila-cont">
          <span><b className="num">{cont.producao}</b> em produção</span>
          <span><b className="num">{cont.fila}</b> na fila</span>
          <span><b className="num">{cont.pcp}</b> aguardando PCP</span>
          <span className={cont.atraso ? 'mal' : ''}><b className="num">{cont.atraso}</b> com atraso</span>
        </div>
      </div>

      {rascunho && (
        <div className="sim-band" role="status">
          <Icon n="info" s={18} />
          <span>
            <b>Simulação:</b> {piores} pedido{piores === 1 ? '' : 's'} atrasa{piores === 1 ? '' : 'm'}, {melhores} adianta{melhores === 1 ? '' : 'm'}
            {novosAtrasos.length > 0 && (
              <>
                {' '}· <b style={{ color: 'var(--crit)' }}>{novosAtrasos.map((p) => `#${p.numero}`).join(', ')} passa{novosAtrasos.length > 1 ? 'm' : ''} a estourar o prazo</b>
              </>
            )}
          </span>
          <div className="acts">
            <button className="btn sm" onClick={() => setRascunho(null)}>Descartar</button>
            <button className="btn sm pri" onClick={aplicar}>Aplicar prioridade</button>
          </div>
        </div>
      )}

      <section className="panel fila-tab" aria-label="Prioridade dos pedidos">
        <div className="scroll-x">
          <table className="t fila-t">
            <thead>
              <tr>
                <th aria-label="Arrastar" />
                <th>Pos.</th>
                <th>Pedido</th>
                <th>Situação</th>
                <th className="r">Volume</th>
                <th style={{ minWidth: 130 }}>OPs</th>
                <th>Estimativa</th>
                <th>Prazo</th>
                {rascunho && <th>Mudança</th>}
                {podeMexer && <th className="r">Mover</th>}
              </tr>
            </thead>
            <tbody>
              {ordem.map((id, i) => {
                const p = e.pedidos.find((x) => x.id === id)!;
                const est = agendaSim.pedidos.get(id);
                const d = deltas.get(id);
                const moved = rascunho && ativos[i]?.id !== id;
                const st = statusPedido(e, p);
                return (
                  <tr
                    key={id}
                    className={`${arr === id ? 'drag' : ''}${sobre === id && arr !== id ? ' over' : ''}${moved ? ' moved' : ''}`}
                    draggable={podeMexer}
                    onDragStart={(ev) => {
                      setArr(id);
                      ev.dataTransfer.effectAllowed = 'move';
                      ev.dataTransfer.setData('text/plain', id);
                    }}
                    onDragEnd={() => {
                      setArr(null);
                      setSobre(null);
                    }}
                    onDragOver={(ev) => {
                      ev.preventDefault();
                      setSobre(id);
                    }}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      const de = ev.dataTransfer.getData('text/plain');
                      if (de && de !== id) mover(de, ordem.filter((x) => x !== de).indexOf(id));
                      setArr(null);
                      setSobre(null);
                    }}
                    onMouseEnter={() => setDestaque(id)}
                    onMouseLeave={() => setDestaque(null)}
                  >
                    <td className="grip">{podeMexer && <Icon n="grip" s={16} w={3} />}</td>
                    <td><span className="prio">{i + 1}º</span></td>
                    <td className="fila-ped">
                      <button onClick={() => abrirPedido(id)}>
                        <span className="mono">#{p.numero}</span>
                        <b>{titulo(p.fantasia)}</b>
                      </button>
                    </td>
                    <td><span className={`chip ${SITUACAO[st].c}`}>{SITUACAO[st].t}</span></td>
                    <td className="r num">{fmtVol(volumePedido(p))}</td>
                    <td>{st === 'pcp' ? <span className="muted">—</span> : <ProgressoOPs e={e} p={p} />}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{st === 'pcp' ? <span className="muted">após o PCP</span> : <b>{estimativaTexto(e, p, est, agora)}</b>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="num muted" style={{ marginRight: 6 }}>{dataISOparaBR(prazoDoPedido(e, p)).slice(0, 5)}</span>
                      <PrazoChip p={p} />
                    </td>
                    {rascunho && (
                      <td>{d !== undefined ? <span className={`delta ${d > 0 ? 'pior' : 'melhor'}`}>{d > 0 ? '+' : '−'}{fmtDur(Math.abs(d))}</span> : <span className="muted">—</span>}</td>
                    )}
                    {podeMexer && (
                      <td className="r">
                        <span className="mv">
                          <button aria-label="Mover para o topo" title="Para o topo" disabled={i === 0} onClick={() => mover(id, 0)}><Icon n="top" s={13} /></button>
                          <button aria-label="Subir" disabled={i === 0} onClick={() => mover(id, i - 1)}><Icon n="up" s={13} /></button>
                          <button aria-label="Descer" disabled={i === ordem.length - 1} onClick={() => mover(id, i + 1)}><Icon n="down" s={13} /></button>
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!ordem.length && (
                <tr><td colSpan={10} className="empty"><b>Fila vazia</b>Nenhum pedido aguardando produção.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ minWidth: 0 }}>
        <div className="panel-head">
          <h2>Linha do tempo das OPs</h2>
          {rascunho && <span className="chip info">simulação</span>}
          {temOps ? (
            <div className="legend sp">
              <span><i style={{ background: 'var(--info)' }} />Em produção</span>
              <span><i style={{ background: 'var(--crit)' }} />Acima do tempo</span>
              <span><i style={{ background: 'var(--pri)' }} />Na fila</span>
            </div>
          ) : (
            <span className="sp muted" style={{ fontSize: 13 }}>Aparece quando o PCP liberar pedidos e houver OPs abertas.</span>
          )}
        </div>
        {temOps && <Gantt e={e} agenda={agendaSim} destaque={destaque} />}
      </section>
    </main>
  );
}

function Gantt({ e, agenda, destaque }: { e: Estado; agenda: Agenda; destaque: string | null }) {
  const { agora, abrirPedido } = useApp();
  const tip = useTip();
  const fer = e.config.feriados;
  const ops = [...agenda.ops.entries()]
    .map(([id, pv]) => ({ op: e.ops.find((o) => o.id === id)!, pv }))
    .filter((x) => x.op)
    .sort((a, b) => a.pv.inicio.getTime() - b.pv.inicio.getTime());
  if (!ops.length) return <div className="empty"><b>Nenhuma OP aberta</b>Libere pedidos no PCP para montar a agenda.</div>;

  const inicio0 = new Date(Math.min(proximoExpediente(agora, fer).getTime(), ...ops.map((o) => o.pv.inicio.getTime())));
  const ini = proximoExpediente(inicioDoDia(inicio0), fer);
  const fimMax = new Date(Math.max(...ops.map((o) => o.pv.fim.getTime())));
  const total = Math.max(MIN_DIA * 3, Math.ceil(expedienteEntre(ini, fimMax, fer) / MIN_DIA) * MIN_DIA);
  const x = (d: Date) => (Math.max(0, expedienteEntre(ini, d, fer)) / total) * 100;
  const dias: Date[] = [];
  let d = new Date(ini);
  while (dias.length < total / MIN_DIA) {
    if (diaUtil(d, fer)) dias.push(new Date(d));
    d = somarDias(d, 1);
  }
  const larg = Math.max(640, dias.length * 130);
  const xNow = x(agora < ini ? ini : agora);

  return (
    <div className="scroll-x" style={{ maxHeight: 620, overflowY: 'auto' }}>
      <div className="gantt" style={{ minWidth: larg + 230 }}>
        <div className="gantt-days" style={{ paddingLeft: 230 }}>
          {dias.map((dd) => (
            <div key={dd.toISOString()} style={{ width: `${100 / dias.length}%` }}>
              {diaSemana(dd)} {dataCurta(dd)}
            </div>
          ))}
        </div>
        {ops.map(({ op, pv }) => {
          const l = x(pv.inicio);
          const w = Math.max(0.6, x(pv.fim) - l);
          const late = op.status === 'producao' && pv.atrasada;
          const hl = destaque && op.alocacoes.some((a) => a.pedidoId === destaque);
          const peds = op.alocacoes.map((a) => e.pedidos.find((p) => p.id === a.pedidoId)).filter(Boolean) as Pedido[];
          return (
            <div className="gantt-row" key={op.id}>
              <div className="lbl">
                <b title={nomeOP(e, op)}>{nomeOP(e, op)}</b>
                <span className="mono">OP {op.numero}</span> <span>· {fmtVol(op.lote)}</span>
              </div>
              <div className="gantt-track">
                <div className="gantt-grid">
                  {dias.map((_, k) => <i key={k} style={{ left: `${(k / dias.length) * 100}%` }} />)}
                </div>
                <div className="gantt-now" style={{ left: `${xNow}%` }} />
                <button
                  className={`gantt-bar${op.status === 'producao' ? ' run' : ''}${late ? ' late' : ''}${hl ? ' hl' : ''}`}
                  style={{ left: `${l}%`, width: `${w}%` }}
                  onClick={() => peds[0] && abrirPedido(peds[0].id)}
                  {...tip.bind(
                    <>
                      <b>OP {op.numero} · {nomeOP(e, op)}</b>
                      {fmtVol(op.lote)} · padrão {fmtDur(op.tempoPadraoMin)}
                      <br />
                      {op.status === 'producao' ? 'Iniciou' : 'Início previsto'} {quando(pv.inicio, agora)}
                      <br />
                      Fim previsto {quando(pv.fim, agora)}
                      {late && <><br />Já passou do tempo padrão</>}
                      <br />
                      Pedidos: {peds.map((p) => `#${p.numero}`).join(', ')}
                    </>,
                  )}
                >
                  {w > 7 ? `OP ${op.numero}` : ''}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {tip.el}
      <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
        Eixo em horas de expediente: noites, almoço, fins de semana e feriados não aparecem. Linha vermelha = agora. Começa em {quando(somarExpediente(ini, 0, fer), agora)}.
      </div>
    </div>
  );
}
