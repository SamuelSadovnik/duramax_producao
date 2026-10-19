import { useMemo, useState } from 'react';
import { useApp } from './store';
import { Icon, Modal, nomeOP, useTip } from './ui';
import { fimDoDia, diaUtil } from '../shared/calendar';
import { dataCurta, diaSemana, fmtDur, fmtVol, hora, nf, quando, titulo } from '../shared/fmt';
import { LINHAS, nomeLinha } from '../shared/catalog';
import type { OP } from '../shared/types';
import { api } from './api';
import { inicioDoDia, iso, somarDias } from '../shared/tz';
import { pode } from './store';

const PERIODOS = [
  { k: 'hoje', l: 'Hoje' },
  { k: '7', l: '7 dias' },
  { k: '30', l: '30 dias' },
  { k: 'tudo', l: 'Tudo' },
] as const;
type Periodo = (typeof PERIODOS)[number]['k'];
type Filtro = { tipo: 'motivo' | 'produto'; valor: string; rotulo: string } | null;

export function DashboardView() {
  const { e, executar, agora, perfil } = useApp();
  const [periodo, setPeriodo] = useState<Periodo>('30');
  const [linha, setLinha] = useState('');
  const [filtro, setFiltro] = useState<Filtro>(null);
  const [soAtrasadas, setSoAtrasadas] = useState(false);
  const [limite, setLimite] = useState(20);
  const [opAberta, setOpAberta] = useState<string | null>(null);
  const [todosProd, setTodosProd] = useState(false);
  const tol = 1 + e.config.toleranciaPct / 100;
  const atrasou = (o: OP) => (o.realMin ?? 0) > o.tempoPadraoMin * tol;
  const perda = (o: OP) => Math.max(0, (o.realMin ?? 0) - o.tempoPadraoMin);

  const d = useMemo(() => {
    const desde =
      periodo === 'hoje'
        ? inicioDoDia(agora)
        : periodo === 'tudo'
          ? new Date(0)
          : new Date(agora.getTime() - Number(periodo) * 86400_000);
    const ops = e.ops
      .filter((o) => o.status === 'concluida' && o.fim && new Date(o.fim) >= desde && (!linha || o.produtoId.split('.')[0] === linha))
      .sort((a, b) => b.fim!.localeCompare(a.fim!));
    const late = ops.filter(atrasou);
    const horasPerdidas = late.reduce((s, o) => s + perda(o), 0);
    const vol = ops.reduce((s, o) => s + o.lote, 0);
    const prontos = e.pedidos.filter((p) => p.prontoEm && new Date(p.prontoEm) >= desde && p.previsao);
    const pedNoPrazo = prontos.filter((p) => new Date(p.prontoEm!) <= fimDoDia(p.previsao)).length;

    const agrupar = (chave: (o: OP) => string | undefined) => {
      const m = new Map<string, { n: number; min: number }>();
      for (const o of late) {
        const k = chave(o);
        if (!k) continue;
        const v = m.get(k) ?? { n: 0, min: 0 };
        v.n++;
        v.min += perda(o);
        m.set(k, v);
      }
      return [...m].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.min - a.min);
    };
    const porMotivo = agrupar((o) => o.motivo ?? 'Sem motivo informado');
    const porProdutoPerda = agrupar((o) => o.produtoId).slice(0, 7);

    const m = new Map<string, OP[]>();
    for (const o of ops) m.set(o.produtoId, [...(m.get(o.produtoId) ?? []), o]);
    const produtos = [...m]
      .map(([pid, l]) => {
        const reais = l.map((o) => o.realMin ?? 0);
        const media = reais.reduce((s, x) => s + x, 0) / l.length;
        const padrao = e.produtos[pid]?.tempoMin ?? l[0].tempoPadraoMin;
        return {
          pid,
          nome: e.produtos[pid]?.nome ?? pid,
          n: l.length,
          padrao,
          media,
          min: Math.min(...reais),
          max: Math.max(...reais),
          noTempo: l.filter((o) => !atrasou(o)).length,
          desvio: media / padrao - 1,
        };
      })
      .sort((a, b) => {
        const sa = a.n >= 3 && Math.abs(a.desvio) > 0.15 ? 1 : 0;
        const sb = b.n >= 3 && Math.abs(b.desvio) > 0.15 ? 1 : 0;
        return sb - sa || b.desvio - a.desvio;
      });

    // volume por dia útil
    const dias: Date[] = [];
    let c = inicioDoDia(agora);
    while (dias.length < 15) {
      if (diaUtil(c, e.config.feriados)) dias.unshift(new Date(c));
      c = somarDias(c, -1);
    }
    const ch = (x: Date) => iso(x);
    const vd = new Map(dias.map((x) => [ch(x), { v: 0, n: 0, late: 0 }]));
    for (const o of e.ops)
      if (o.status === 'concluida' && o.fim && (!linha || o.produtoId.split('.')[0] === linha)) {
        const k = vd.get(ch(new Date(o.fim)));
        if (k) {
          k.v += o.lote;
          k.n++;
          if (atrasou(o)) k.late++;
        }
      }
    const serie = dias.map((x) => ({ d: x, ...vd.get(ch(x))! }));
    return { ops, late, horasPerdidas, vol, prontos, pedNoPrazo, porMotivo, porProdutoPerda, produtos, serie };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, periodo, linha, agora, tol]);

  const listaOps = d.ops
    .filter((o) => !soAtrasadas || atrasou(o))
    .filter((o) => !filtro || (filtro.tipo === 'motivo' ? (o.motivo ?? 'Sem motivo informado') === filtro.valor && atrasou(o) : o.produtoId === filtro.valor));
  const escala = Math.max(1, ...listaOps.slice(0, limite).map((o) => Math.max(o.realMin ?? 0, o.tempoPadraoMin)));
  const maxPerda = Math.max(1, ...d.porMotivo.map((x) => x.min), ...d.porProdutoPerda.map((x) => x.min));
  const pctNoTempo = d.ops.length ? Math.round(((d.ops.length - d.late.length) / d.ops.length) * 100) : 0;
  const pctPrazo = d.prontos.length ? Math.round((d.pedNoPrazo / d.prontos.length) * 100) : 0;
  const nomePeriodo = { hoje: 'Hoje', '7': 'Nos últimos 7 dias', '30': 'Nos últimos 30 dias', tudo: 'Desde o início' }[periodo];
  const topMotivo = d.porMotivo[0];

  const usarMedia = (pid: string, min: number) => {
    const novo = Math.max(5, Math.round(min / 5) * 5);
    executar(() => api.produto(pid, { tempoMin: novo }), `Tempo padrão de ${e.produtos[pid]?.nome} agora é ${fmtDur(novo)}. Estimativas recalculadas.`);
  };

  const filtrar = (f: NonNullable<Filtro>) => {
    setFiltro((x) => (x && x.tipo === f.tipo && x.valor === f.valor ? null : f));
    setLimite(20);
    setTimeout(() => document.getElementById('lista-ops')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Desempenho da produção</h1>
          <p>Quanto cada OP demorou de verdade comparado com o tempo padrão, e o motivo quando passou do tempo.</p>
        </div>
        <div className="acts">
          <select id="dash-linha" className="select" value={linha} onChange={(ev) => setLinha(ev.target.value)} aria-label="Linha de produto">
            <option value="">Todas as linhas</option>
            {Object.keys(LINHAS).map((l) => <option key={l} value={l}>{nomeLinha(l)}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Período">
            {PERIODOS.map((p) => <button key={p.k} aria-pressed={periodo === p.k} onClick={() => setPeriodo(p.k)}>{p.l}</button>)}
          </div>
        </div>
      </div>

      <section className="resumo">
        {d.ops.length ? (
          <p>
            {nomePeriodo}, a fábrica concluiu <b>{d.ops.length} OPs</b> ({fmtVol(d.vol)}).{' '}
            <b className="ok-t">{d.ops.length - d.late.length} ficaram dentro do tempo</b>
            {d.late.length > 0 && (
              <>
                {' '}e <b className="crit-t">{d.late.length} passaram do padrão</b>, somando <b className="crit-t">{fmtDur(d.horasPerdidas)} a mais</b>
                {topMotivo && <>. A principal causa foi <b>{topMotivo.k.toLowerCase()}</b> ({fmtDur(topMotivo.min)})</>}
              </>
            )}
            .
          </p>
        ) : (
          <p>{nomePeriodo} nenhuma OP foi concluída{linha ? ` na linha ${nomeLinha(linha)}` : ''}.</p>
        )}
      </section>

      <div className="kpis kpis4">
        <div className="kpi">
          <span className="l">OPs dentro do tempo</span>
          <span className="v">{d.ops.length - d.late.length}<small>de {d.ops.length}</small></span>
          <div className="meter" aria-hidden="true">
            <i className="okb" style={{ width: `${pctNoTempo}%` }} />
            <i className="crb" style={{ width: `${100 - pctNoTempo}%` }} />
          </div>
          <span className="s">{pctNoTempo}% · tolerância de {e.config.toleranciaPct}%</span>
        </div>
        <div className="kpi">
          <span className="l">Tempo perdido</span>
          <span className="v" style={{ color: d.horasPerdidas ? 'var(--crit)' : undefined }}>{d.horasPerdidas ? '+' : ''}{fmtDur(d.horasPerdidas)}</span>
          <span className="s">acima do padrão, em {d.late.length} OP{d.late.length === 1 ? '' : 's'}</span>
        </div>
        <div className="kpi">
          <span className="l">Pedidos prontos no prazo</span>
          <span className="v">{d.pedNoPrazo}<small>de {d.prontos.length}</small></span>
          <div className="meter" aria-hidden="true">
            <i className="okb" style={{ width: `${pctPrazo}%` }} />
            <i className="crb" style={{ width: `${d.prontos.length ? 100 - pctPrazo : 0}%` }} />
          </div>
          <span className="s">{pctPrazo}% liberados até a data prometida</span>
        </div>
        <div className="kpi">
          <span className="l">Volume produzido</span>
          <span className="v">{d.vol >= 10000 ? nf(d.vol / 1000, 1) : nf(d.vol)}<small>{d.vol >= 10000 ? 'mil L' : 'L'}</small></span>
          <span className="s">{d.ops.length} lote{d.ops.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className="perdas">
        <section className="panel">
          <div className="panel-head"><h2>Onde o tempo foi perdido: por motivo</h2></div>
          <RankBarras
            itens={d.porMotivo.map((x) => ({ k: x.k, rotulo: x.k, n: x.n, min: x.min }))}
            max={maxPerda}
            ativo={filtro?.tipo === 'motivo' ? filtro.valor : null}
            onClick={(k) => filtrar({ tipo: 'motivo', valor: k, rotulo: k })}
          />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Por produto</h2><span className="sp muted" style={{ fontSize: 12 }}>os 7 que mais perderam tempo</span></div>
          <RankBarras
            itens={d.porProdutoPerda.map((x) => ({ k: x.k, rotulo: e.produtos[x.k]?.nome ?? x.k, n: x.n, min: x.min }))}
            max={maxPerda}
            ativo={filtro?.tipo === 'produto' ? filtro.valor : null}
            onClick={(k) => filtrar({ tipo: 'produto', valor: k, rotulo: e.produtos[k]?.nome ?? k })}
          />
        </section>
      </div>

      <section className="panel" id="lista-ops">
        <div className="panel-head">
          <h2>Previsto × realizado, OP por OP</h2>
          {filtro && (
            <button className="chip info" style={{ border: 0, cursor: 'pointer' }} onClick={() => setFiltro(null)}>
              {filtro.tipo === 'motivo' ? 'Motivo' : 'Produto'}: {filtro.rotulo} <Icon n="x" s={12} />
            </button>
          )}
          <div className="sp seg" role="group" aria-label="Quais OPs">
            <button aria-pressed={!soAtrasadas} onClick={() => setSoAtrasadas(false)}>Todas</button>
            <button aria-pressed={soAtrasadas} onClick={() => setSoAtrasadas(true)}>Só as que atrasaram</button>
          </div>
        </div>
        <div className="pr-legend legend">
          <span><i className="lg-std" />Tempo padrão</span>
          <span><i style={{ background: 'var(--ok)' }} />Real dentro do tempo</span>
          <span><i style={{ background: 'var(--crit)' }} />Real acima do tempo</span>
        </div>
        <div className="pr-list">
          {listaOps.slice(0, limite).map((o) => {
            const real = o.realMin ?? 0;
            const ruim = atrasou(o);
            const dif = real - o.tempoPadraoMin;
            return (
              <button key={o.id} className={`pr-row${ruim ? ' bad' : ''}`} onClick={() => setOpAberta(o.id)}>
                <span className="pr-when num">{quando(new Date(o.fim!), agora)}</span>
                <span className="pr-name">
                  <b>{nomeOP(e, o)}</b>
                  <span className="mono">OP {o.numero}</span>
                </span>
                <span className="pr-bars" aria-hidden="true">
                  <i className="std" style={{ width: `${(o.tempoPadraoMin / escala) * 100}%` }} />
                  <i className={`real ${ruim ? 'bad' : 'ok'}`} style={{ width: `${(real / escala) * 100}%` }} />
                </span>
                <span className="pr-nums num">
                  <span className="muted">{fmtDur(o.tempoPadraoMin)} →</span> <b>{fmtDur(real)}</b>
                  <span className={`chip ${ruim ? 'crit' : 'ok'}`}>{dif >= 0 ? '+' : '−'}{fmtDur(Math.abs(dif))}</span>
                </span>
                <span className="pr-why">{ruim ? o.motivo ?? 'Sem motivo informado' : ''}</span>
              </button>
            );
          })}
          {!listaOps.length && <div className="empty"><b>Nenhuma OP aqui</b>Mude o período ou o filtro.</div>}
        </div>
        {listaOps.length > limite && (
          <button className="btn" style={{ marginTop: 10 }} onClick={() => setLimite((x) => x + 30)}>
            Mostrar mais ({listaOps.length - limite})
          </button>
        )}
      </section>

      <section className="panel" style={{ padding: 0 }}>
        <div className="panel-head" style={{ padding: '16px 16px 0' }}>
          <h2>Tempo padrão está certo?</h2>
          <span className="sp muted" style={{ fontSize: 12 }}>média real de cada produto no período</span>
        </div>
        <div className="scroll-x">
          <table className="t">
            <thead>
              <tr>
                <th>Produto</th><th className="r">OPs</th><th className="r">Padrão</th><th className="r">Média real</th><th style={{ minWidth: 180 }}>Menor e maior tempo</th><th className="r">No tempo</th><th>Sugestão</th>
              </tr>
            </thead>
            <tbody>
              {(todosProd ? d.produtos : d.produtos.slice(0, 10)).map((p) => {
                const escalaP = Math.max(p.max, p.padrao) * 1.05;
                const sugere = p.n >= 3 && Math.abs(p.desvio) > 0.15;
                return (
                  <tr key={p.pid} className="click" onClick={() => filtrar({ tipo: 'produto', valor: p.pid, rotulo: p.nome })}>
                    <td style={{ minWidth: 220 }}><b style={{ fontWeight: 600 }}>{p.nome}</b></td>
                    <td className="r num">{p.n}</td>
                    <td className="r num">{fmtDur(p.padrao)}</td>
                    <td className="r num" style={{ color: p.media > p.padrao * tol ? 'var(--crit)' : undefined, fontWeight: 650 }}>{fmtDur(p.media)}</td>
                    <td>
                      <span className="range" title={`${fmtDur(p.min)} a ${fmtDur(p.max)}`}>
                        <i className="rg" style={{ left: `${(p.min / escalaP) * 100}%`, width: `${Math.max(1, ((p.max - p.min) / escalaP) * 100)}%` }} />
                        <i className="pd" style={{ left: `${(p.padrao / escalaP) * 100}%` }} />
                        <i className={`md ${p.media > p.padrao * tol ? 'bad' : ''}`} style={{ left: `${(p.media / escalaP) * 100}%` }} />
                      </span>
                      <span className="muted num" style={{ fontSize: 11.5 }}>{fmtDur(p.min)} a {fmtDur(p.max)}</span>
                    </td>
                    <td className="r num">{Math.round((p.noTempo / p.n) * 100)}%</td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      {sugere ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className={`chip ${p.desvio > 0 ? 'warn' : 'info'}`}>Padrão parece {p.desvio > 0 ? 'curto' : 'longo'}</span>
                          {pode.parametros(perfil) && (
                            <button className="btn sm" onClick={() => usarMedia(p.pid, p.media)}>Usar {fmtDur(Math.round(p.media / 5) * 5)}</button>
                          )}
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>{p.n < 3 ? 'poucas OPs para avaliar' : 'ok'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!d.produtos.length && <tr><td colSpan={7} className="empty">Sem OPs concluídas no período.</td></tr>}
            </tbody>
          </table>
        </div>
        {d.produtos.length > 10 && (
          <div style={{ padding: '10px 16px 14px' }}>
            <button className="btn" onClick={() => setTodosProd((x) => !x)}>{todosProd ? 'Mostrar só os 10 primeiros' : `Mostrar todos os ${d.produtos.length} produtos`}</button>
          </div>
        )}
      </section>

      <section className="panel chart">
        <div className="panel-head"><h2>Produção por dia</h2><span className="sp muted" style={{ fontSize: 12 }}>litros dos lotes concluídos · últimos 15 dias úteis</span></div>
        <Colunas serie={d.serie} />
      </section>

      <div className="muted" style={{ fontSize: 11.5 }}>Considera as OPs concluídas nos últimos 120 dias. As OPs que o gerente finalizar entram aqui na hora. Atualizado {hora(agora)}.</div>
      {opAberta && <DetalheOP id={opAberta} onClose={() => setOpAberta(null)} />}
    </main>
  );
}

function RankBarras({ itens, max, ativo, onClick }: { itens: { k: string; rotulo: string; n: number; min: number }[]; max: number; ativo: string | null; onClick: (k: string) => void }) {
  if (!itens.length) return <div className="empty"><b>Nenhum atraso no período</b>Todas as OPs ficaram dentro da tolerância.</div>;
  const total = itens.reduce((s, x) => s + x.min, 0);
  return (
    <div className="rank">
      {itens.map((x) => (
        <button key={x.k} className={`rank-row${ativo === x.k ? ' on' : ''}`} onClick={() => onClick(x.k)} title="Ver estas OPs na lista">
          <span className="rank-l">{x.rotulo}</span>
          <span className="rank-bar"><i style={{ width: `${(x.min / max) * 100}%` }} /></span>
          <span className="rank-v num"><b>{fmtDur(x.min)}</b> <span className="muted">· {x.n} OP{x.n > 1 ? 's' : ''} · {Math.round((x.min / total) * 100)}%</span></span>
        </button>
      ))}
    </div>
  );
}

function DetalheOP({ id, onClose }: { id: string; onClose: () => void }) {
  const { e, agora, abrirPedido } = useApp();
  const o = e.ops.find((x) => x.id === id);
  if (!o) return null;
  const real = o.realMin ?? 0;
  const tol = 1 + e.config.toleranciaPct / 100;
  const ruim = real > o.tempoPadraoMin * tol;
  const esc = Math.max(real, o.tempoPadraoMin) * 1.05;
  const peds = o.alocacoes.map((a) => ({ a, p: e.pedidos.find((p) => p.id === a.pedidoId) })).filter((x) => x.p);
  return (
    <Modal onClose={onClose} label={`OP ${o.numero}`}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div className="eyebrow">OP {o.numero} · {nomeLinha(o.produtoId.split('.')[0])}</div>
          <h2 style={{ marginTop: 4 }}>{nomeOP(e, o)}</h2>
        </div>
        <button className="btn ghost icon" onClick={onClose} aria-label="Fechar"><Icon n="x" /></button>
      </div>
      <div className="big-stat">
        <div><b>{fmtDur(o.tempoPadraoMin)}</b><span>tempo padrão</span></div>
        <div><b style={{ color: ruim ? 'var(--crit)' : 'var(--ok)' }}>{fmtDur(real)}</b><span>tempo real ({real >= o.tempoPadraoMin ? '+' : '−'}{fmtDur(Math.abs(real - o.tempoPadraoMin))})</span></div>
      </div>
      <div className="op-compare" aria-hidden="true">
        <div><span>Padrão</span><i className="std" style={{ width: `${(o.tempoPadraoMin / esc) * 100}%` }} /></div>
        <div><span>Real</span><i className={ruim ? 'bad' : 'ok'} style={{ width: `${(real / esc) * 100}%` }} /></div>
      </div>
      <dl className="kv" style={{ margin: 0 }}>
        <div><dt>Início</dt><dd>{o.inicio ? quando(new Date(o.inicio), agora) : '—'}</dd></div>
        <div><dt>Fim</dt><dd>{o.fim ? quando(new Date(o.fim), agora) : '—'}</dd></div>
        <div><dt>Lote</dt><dd>{fmtVol(o.lote)}</dd></div>
      </dl>
      <div className={`op-why${ruim ? ' bad' : ''}`}>
        <div className="eyebrow">O que aconteceu</div>
        {ruim ? (
          <>
            <b>{o.motivo ?? 'Motivo não informado'}</b>
            {o.obs && <p>{o.obs}</p>}
          </>
        ) : (
          <b>Dentro da tolerância de {e.config.toleranciaPct}%.</b>
        )}
      </div>
      {peds.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Pedidos atendidos</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {peds.map(({ a, p }) => (
              <button key={p!.id} className="btn" style={{ justifyContent: 'space-between' }} onClick={() => { onClose(); abrirPedido(p!.id); }}>
                <span>#{p!.numero} · {titulo(p!.fantasia)}</span>
                <span className="muted num">{fmtVol(a.volume)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Colunas({ serie }: { serie: { d: Date; v: number; n: number; late: number }[] }) {
  const tip = useTip();
  const W = 900;
  const H = 180;
  const B = 22;
  const max = Math.max(1, ...serie.map((s) => s.v));
  const topo = Math.ceil(max / 500) * 500;
  const media = serie.reduce((s, x) => s + x.v, 0) / serie.length;
  const bw = (W - 46) / serie.length;
  const y = (v: number) => H - B - (v / topo) * (H - B - 12);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Litros produzidos por dia útil">
        {[0, topo / 2, topo].map((t) => (
          <g key={t}>
            <line x1={42} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={36} y={y(t) + 4} textAnchor="end">{t >= 1000 ? `${nf(t / 1000, t % 1000 ? 1 : 0)} mil` : nf(t)}</text>
          </g>
        ))}
        {serie.map((s, i) => {
          const hx = 46 + i * bw;
          return (
            <g key={i} {...tip.bind(<><b>{diaSemana(s.d)} {dataCurta(s.d)}</b>{fmtVol(s.v)} em {s.n} OP{s.n === 1 ? '' : 's'}{s.late ? ` · ${s.late} acima do tempo` : ''}</>)}>
              <rect x={hx} y={8} width={bw} height={H - B - 8} fill="transparent" />
              {s.v > 0 && <rect x={hx + 4} y={y(s.v)} width={bw - 8} height={H - B - y(s.v)} rx={4} fill="var(--pri)" />}
              <text x={hx + bw / 2} y={H - 6} textAnchor="middle">{dataCurta(s.d)}</text>
            </g>
          );
        })}
        <line x1={42} x2={W} y1={y(media)} y2={y(media)} stroke="var(--fg-2)" strokeDasharray="4 4" strokeWidth={1.5} />
        <text x={50} y={y(media) - 6} className="lbl-strong" style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 5, strokeLinejoin: 'round' }}>
          média {fmtVol(media)}/dia
        </text>
      </svg>
      {tip.el}
    </div>
  );
}
