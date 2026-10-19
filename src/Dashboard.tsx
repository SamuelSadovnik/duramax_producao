import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './store';
import { Icon, Modal, PrazoChip, Vazio, nomeOP, useTip } from './ui';
import { dataCurta, dataISOparaBR, diaSemana, fmtDur, fmtVol, hora, mesmoDia, nf, quando, titulo } from '../shared/fmt';
import { LINHAS, nomeLinha } from '../shared/catalog';
import type { OP } from '../shared/types';
import { prazoDoPedido, situacaoPrazo, statusPedido } from '../shared/engine';
import {
  acimaDaTolerancia,
  carteira,
  evolucaoSemanal,
  indicadores,
  intervalos,
  linhaDe,
  opsConcluidas,
  paretoMotivos,
  porLinha,
  produtosQueEstouram,
  volumePorDia,
  type PeriodoK,
} from '../shared/metricas';
import { api } from './api';
import { pode } from './store';

const PERIODOS: { k: PeriodoK; l: string; ant: string }[] = [
  { k: 'hoje', l: 'Hoje', ant: '' },
  { k: '7', l: '7 dias', ant: 'vs 7 dias anteriores' },
  { k: '30', l: '30 dias', ant: 'vs 30 dias anteriores' },
  { k: 'tudo', l: 'Tudo', ant: '' },
];

/** Uma cor fixa por linha de produto, igual em todos os gráficos. */
const CORES: Record<string, string> = { '600': 'var(--pri)', '610': '#2a9d8f', '400': '#e2a03f', '800': '#8a63c9', '200': '#d7343a' };
const EXTRAS = ['#5b8def', '#c9577e', '#7f8c3a', '#8a93ad'];
const corLinha = (l: string) => CORES[l] ?? EXTRAS[[...l].reduce((s, c) => s + c.charCodeAt(0), 0) % EXTRAS.length];
const ordemLinhas = (ls: string[]) => [...new Set(ls)].sort((a, b) => (a in LINHAS ? 0 : 1) - (b in LINHAS ? 0 : 1) || a.localeCompare(b));

/** Largura real do elemento: os gráficos são desenhados no tamanho da tela, sem esticar texto. */
function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([en]) => setW(Math.floor(en.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function passoBonito(max: number, partes = 4) {
  const bruto = max / partes;
  const p = Math.pow(10, Math.floor(Math.log10(bruto || 1)));
  const n = bruto / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const litros = (v: number) => (v >= 1000 ? `${nf(v / 1000, v >= 10000 || v % 1000 === 0 ? 0 : 1)} mil` : nf(v));
const pct = (v: number | null, d = 0) => (v === null ? '—' : `${nf(v, d)}%`);
const dias = (v: number | null) => (v === null ? '—' : nf(v, 1));
const horas = (v: number | null) => (v === null ? '—' : v < 1 ? `${Math.round(v * 60)}min` : fmtDur(v * 60));

/** Barra com os cantos de cima arredondados. */
const barraTopo = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};

export function DashboardView() {
  const { e, executar, agora, agenda, perfil, abrirPedido } = useApp();
  const [periodo, setPeriodo] = useState<PeriodoK>('30');
  const [linha, setLinha] = useState('');
  const [filtro, setFiltro] = useState<{ tipo: 'motivo' | 'produto'; valor: string; rotulo: string } | null>(null);
  const [soAcima, setSoAcima] = useState(false);
  const [limite, setLimite] = useState(15);
  const [opAberta, setOpAberta] = useState<string | null>(null);
  const [todosProd, setTodosProd] = useState(false);

  const per = PERIODOS.find((p) => p.k === periodo)!;
  const d = useMemo(() => {
    const iv = intervalos(periodo, agora);
    return {
      iv,
      atual: indicadores(e, iv.atual, linha),
      anterior: iv.anterior ? indicadores(e, iv.anterior, linha) : null,
      ops: opsConcluidas(e, iv.atual, linha),
      diasSerie: volumePorDia(e, agora, 15, linha),
      semanas: evolucaoSemanal(e, agora, 8, linha),
      pareto: paretoMotivos(e, iv.atual, linha),
      produtos: produtosQueEstouram(e, iv.atual, linha),
      linhas: porLinha(e, iv.atual),
      cart: carteira(e, agora, (p) => statusPedido(e, p)),
    };
  }, [e, periodo, linha, agora]);

  // pedidos ativos atrasados ou em risco, do mais atrasado para o menos
  const criticos = useMemo(
    () =>
      e.pedidos
        .filter((p) => ['pcp', 'fila', 'producao'].includes(statusPedido(e, p)))
        .map((p) => ({ p, s: situacaoPrazo(e, p, agenda.pedidos.get(p.id), agora), est: agenda.pedidos.get(p.id) }))
        .filter((x) => x.s.tipo === 'atrasado' || x.s.tipo === 'risco')
        .sort((a, b) => b.s.dias - a.s.dias || (a.s.tipo === 'atrasado' ? -1 : 1)),
    [e, agenda, agora],
  );

  const listaOps = d.ops
    .filter((o) => !soAcima || acimaDaTolerancia(e, o))
    .filter((o) => !filtro || (filtro.tipo === 'motivo' ? (o.motivo ?? 'Sem motivo informado') === filtro.valor && acimaDaTolerancia(e, o) : o.produtoId === filtro.valor));

  const filtrar = (f: NonNullable<typeof filtro>) => {
    setFiltro((x) => (x && x.tipo === f.tipo && x.valor === f.valor ? null : f));
    setLimite(15);
    setTimeout(() => document.getElementById('lista-ops')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };

  const usarMedia = (pid: string, min: number) => {
    const novo = Math.max(5, Math.round(min / 5) * 5);
    executar(() => api.produto(pid, { tempoMin: novo }), `Tempo padrão de ${e.produtos[pid]?.nome} agora é ${fmtDur(novo)}. Estimativas recalculadas.`);
  };

  const padraoProdutos = useMemo(() => {
    const m = new Map<string, OP[]>();
    for (const o of d.ops) m.set(o.produtoId, [...(m.get(o.produtoId) ?? []), o]);
    return [...m]
      .map(([pid, l]) => {
        const reais = l.map((o) => o.realMin ?? 0);
        const media = reais.reduce((s, x) => s + x, 0) / l.length;
        const padrao = e.produtos[pid]?.tempoMin ?? l[0].tempoPadraoMin;
        return { pid, nome: e.produtos[pid]?.nome ?? pid, n: l.length, padrao, media, min: Math.min(...reais), max: Math.max(...reais), noTempo: l.filter((o) => !acimaDaTolerancia(e, o)).length, desvio: media / padrao - 1 };
      })
      .sort((a, b) => {
        const sa = a.n >= 3 && Math.abs(a.desvio) > 0.15 ? 1 : 0;
        const sb = b.n >= 3 && Math.abs(b.desvio) > 0.15 ? 1 : 0;
        return sb - sa || b.desvio - a.desvio;
      });
  }, [d.ops, e]);

  const a = d.atual;
  const b = d.anterior;
  const semDados = !a.nOps && !a.pedidosProntos;

  return (
    <main className="page dash">
      <div className="page-head">
        <div>
          <h1>Desempenho da produção</h1>
          <p>Entregas, produção, eficiência e perdas. Os números do topo comparam com o período anterior de mesmo tamanho.</p>
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

      <div className="kpis kpis6">
        <Kpi icone="truck" titulo="Entregas no prazo" valor={pct(a.pctPrazo)} sub={a.pedidosProntos ? `${a.noPrazo} de ${a.pedidosProntos} pedidos prontos` : 'nenhum pedido ficou pronto'} delta={b && a.pctPrazo !== null && b.pctPrazo !== null ? { v: a.pctPrazo - b.pctPrazo, txt: `${nf(Math.abs(a.pctPrazo - b.pctPrazo))} p.p.`, bom: 'subir' } : null} ant={per.ant} tom={a.pctPrazo === null ? '' : a.pctPrazo >= 90 ? 'ok' : a.pctPrazo >= 75 ? 'warn' : 'crit'} />
        <Kpi icone="clock" titulo="Lead time" valor={dias(a.leadTimeDias)} unidade={a.leadTimeDias === null ? '' : 'dias úteis'} sub="da entrada no sistema até ficar pronto" delta={b && a.leadTimeDias !== null && b.leadTimeDias !== null ? { v: a.leadTimeDias - b.leadTimeDias, txt: `${nf(Math.abs(a.leadTimeDias - b.leadTimeDias), 1)} dia`, bom: 'cair' } : null} ant={per.ant} tom={a.leadTimeDias === null ? '' : a.leadTimeDias <= e.config.prazoDiasUteis ? 'ok' : 'crit'} />
        <Kpi icone="pcp" titulo="Tempo no PCP" valor={horas(a.pcpHoras)} sub="da entrada até a liberação (expediente)" delta={b && a.pcpHoras !== null && b.pcpHoras !== null ? { v: a.pcpHoras - b.pcpHoras, txt: horas(Math.abs(a.pcpHoras - b.pcpHoras)), bom: 'cair' } : null} ant={per.ant} />
        <Kpi icone="flask" titulo="Volume produzido" valor={litros(a.volume)} unidade="L" sub={`${a.nOps} lote${a.nOps === 1 ? '' : 's'} concluído${a.nOps === 1 ? '' : 's'}`} delta={b && b.volume ? { v: a.volume - b.volume, txt: `${nf(Math.abs((a.volume / b.volume - 1) * 100))}%`, bom: 'subir' } : null} ant={per.ant} />
        <Kpi icone="bolt" titulo="Eficiência" valor={pct(a.eficiencia)} sub="tempo padrão ÷ tempo real das OPs" delta={b && a.eficiencia !== null && b.eficiencia !== null ? { v: a.eficiencia - b.eficiencia, txt: `${nf(Math.abs(a.eficiencia - b.eficiencia))} p.p.`, bom: 'subir' } : null} ant={per.ant} tom={a.eficiencia === null ? '' : a.eficiencia >= 95 ? 'ok' : a.eficiencia >= 85 ? 'warn' : 'crit'} />
        <Kpi icone="alert" titulo="Tempo perdido" valor={a.perdidoMin ? fmtDur(a.perdidoMin) : '0'} sub={`acima do padrão · ${a.nAcima} de ${a.nOps} OPs (${pct(a.pctNoTempo === null ? null : 100 - a.pctNoTempo)})`} delta={b ? { v: a.perdidoMin - b.perdidoMin, txt: fmtDur(Math.abs(a.perdidoMin - b.perdidoMin)), bom: 'cair' } : null} ant={per.ant} tom={a.perdidoMin ? 'crit' : a.nOps ? 'ok' : ''} />
      </div>

      <div className="dash-g2">
        <section className="panel">
          <div className="panel-head">
            <h2>Volume produzido por dia</h2>
            <span className="sp nota">litros dos lotes concluídos · últimos 15 dias úteis</span>
          </div>
          <GraficoDias serie={d.diasSerie} />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Carteira agora</h2><span className="sp nota">{hora(agora)}</span></div>
          <Carteira c={d.cart} capacidade={e.config.capacidade} criticos={criticos.filter((x) => x.s.tipo === 'atrasado').length} risco={criticos.filter((x) => x.s.tipo === 'risco').length} />
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Evolução semanal</h2>
          <span className="sp nota">últimas 8 semanas · semana de segunda a domingo</span>
        </div>
        <GraficoSemanas semanas={d.semanas} />
      </section>

      {semDados ? (
        <div className="panel">
          <Vazio icone="grafico" titulo={`Nenhuma OP concluída ${periodo === 'hoje' ? 'hoje' : 'neste período'}`}>
            Os gráficos de perdas e eficiência aparecem quando o gerente finalizar OPs no chão de fábrica.
          </Vazio>
        </div>
      ) : (
        <>
          <div className="dash-g3">
            <section className="panel">
              <div className="panel-head"><h2>Por que atrasou</h2><span className="sp nota">Pareto · horas acima do padrão</span></div>
              <Pareto itens={d.pareto} ativo={filtro?.tipo === 'motivo' ? filtro.valor : null} onClick={(k) => filtrar({ tipo: 'motivo', valor: k, rotulo: k })} />
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Produtos que mais estouram</h2><span className="sp nota">horas perdidas</span></div>
              <Estouram itens={d.produtos.map((x) => ({ ...x, nome: e.produtos[x.pid]?.nome ?? x.pid }))} ativo={filtro?.tipo === 'produto' ? filtro.valor : null} onClick={(pid) => filtrar({ tipo: 'produto', valor: pid, rotulo: e.produtos[pid]?.nome ?? pid })} />
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Produção por linha</h2><span className="sp nota">{per.l.toLowerCase()}</span></div>
              <RoscaLinhas linhas={d.linhas} />
            </section>
          </div>
        </>
      )}

      <section className="panel flush">
        <div className="panel-head">
          <h2>Pedidos atrasados ou em risco</h2>
          <span className="chip crit">{criticos.filter((x) => x.s.tipo === 'atrasado').length} atrasados</span>
          <span className="chip warn">{criticos.filter((x) => x.s.tipo === 'risco').length} em risco</span>
          <span className="sp nota">pela estimativa da fila atual</span>
        </div>
        <div className="scroll-x">
          <table className="t cartoes" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Pedido</th>
                <th>Cliente</th>
                <th style={{ width: 150 }}>Situação</th>
                <th style={{ width: 110 }}>Prazo</th>
                <th style={{ width: 150 }}>Estimativa</th>
                <th style={{ width: 200 }}>Atraso</th>
              </tr>
            </thead>
            <tbody>
              {criticos.slice(0, 10).map(({ p, est }) => {
                const st = statusPedido(e, p);
                return (
                  <tr key={p.id} className="click" onClick={() => abrirPedido(p.id)}>
                    <td className="mono cel-oculta">#{p.numero}</td>
                    <td className="cel-tit"><span className="nome">{titulo(p.fantasia)}</span><span className="sub"><span className="so-cel mono">#{p.numero} · </span>{titulo(p.cidade)}/{p.uf}</span></td>
                    <td data-l="Situação"><span className={`chip ${st === 'producao' ? 'info' : st === 'pcp' ? 'warn' : ''}`}>{st === 'producao' ? 'Em produção' : st === 'pcp' ? 'Aguardando PCP' : 'Na fila'}</span></td>
                    <td className="num" data-l="Prazo">{dataISOparaBR(prazoDoPedido(e, p)).slice(0, 5)}</td>
                    <td className="num nw" data-l="Estimativa">{st === 'pcp' ? <span className="muted">após o PCP</span> : est ? quando(est, agora) : '—'}</td>
                    <td data-l="Atraso"><PrazoChip p={p} /></td>
                  </tr>
                );
              })}
              {!criticos.length && (
                <tr><td colSpan={6} className="vazio-td"><Vazio compacto icone="check" titulo="Nenhum pedido atrasado ou em risco">Pela fila atual, todos ficam prontos dentro do prazo.</Vazio></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {criticos.length > 10 && <div className="panel-pe nota">e mais {criticos.length - 10} pedidos — veja todos em Fila e previsão.</div>}
      </section>

      <section className="panel flush" id="lista-ops">
        <div className="panel-head">
          <h2>OPs concluídas</h2>
          {filtro && (
            <button className="chip info" onClick={() => setFiltro(null)}>
              {filtro.tipo === 'motivo' ? 'Motivo' : 'Produto'}: {filtro.rotulo} <Icon n="x" s={12} />
            </button>
          )}
          <div className="sp seg" role="group" aria-label="Quais OPs">
            <button aria-pressed={!soAcima} onClick={() => setSoAcima(false)}>Todas</button>
            <button aria-pressed={soAcima} onClick={() => setSoAcima(true)}>Acima da tolerância</button>
          </div>
        </div>
        <div className="scroll-x">
          <table className="t cartoes" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Terminou</th>
                <th>Produto</th>
                <th className="r" style={{ width: 90 }}>Lote</th>
                <th className="r" style={{ width: 90 }}>Padrão</th>
                <th className="r" style={{ width: 90 }}>Real</th>
                <th style={{ width: 170 }}>Desvio</th>
                <th style={{ width: 240 }}>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {listaOps.slice(0, limite).map((o) => {
                const real = o.realMin ?? 0;
                const dif = real - o.tempoPadraoMin;
                const p = o.tempoPadraoMin ? dif / o.tempoPadraoMin : 0;
                const ruim = acimaDaTolerancia(e, o);
                const tom = ruim ? 'crit' : dif > 0 ? 'warn' : 'ok';
                return (
                  <tr key={o.id} className="click" onClick={() => setOpAberta(o.id)}>
                    <td className="num nw" data-l="Terminou">{quando(new Date(o.fim!), agora)}</td>
                    <td className="cel-tit"><span className="nome">{nomeOP(e, o)}</span><span className="sub mono">OP {o.numero} · {nomeLinha(linhaDe(o.produtoId))}</span></td>
                    <td className="r num" data-l="Lote">{fmtVol(o.lote)}</td>
                    <td className="r num" data-l="Padrão">{fmtDur(o.tempoPadraoMin)}</td>
                    <td className={`r num forte ${tom}`} data-l="Real">{fmtDur(real)}</td>
                    <td data-l="Desvio">
                      <span className="desvio">
                        <span className="desvio-barra" aria-hidden="true">
                          <i className={tom} style={dif >= 0 ? { left: '50%', width: `${Math.min(1, Math.abs(p)) * 50}%` } : { right: '50%', width: `${Math.min(1, Math.abs(p)) * 50}%` }} />
                        </span>
                        <b className={`num ${tom}`}>{dif >= 0 ? '+' : '−'}{nf(Math.abs(p) * 100)}%</b>
                      </span>
                    </td>
                    <td className="cel-larga" data-l="Motivo">{ruim ? <span className="motivo">{o.motivo ?? 'Sem motivo informado'}</span> : <span className="muted">{dif > 0 ? 'dentro da tolerância' : 'no tempo'}</span>}</td>
                  </tr>
                );
              })}
              {!listaOps.length && <tr><td colSpan={7} className="vazio-td"><Vazio compacto icone="ops" titulo="Nenhuma OP aqui">Mude o período ou o filtro.</Vazio></td></tr>}
            </tbody>
          </table>
        </div>
        {listaOps.length > limite && (
          <div className="panel-pe"><button className="btn" onClick={() => setLimite((x) => x + 30)}>Mostrar mais ({listaOps.length - limite})</button></div>
        )}
      </section>

      <section className="panel flush">
        <div className="panel-head">
          <h2>Tempo padrão está certo?</h2>
          <span className="sp nota">média real de cada produto no período · sugestão a partir de 3 OPs</span>
        </div>
        <div className="scroll-x">
          <table className="t cartoes" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="r" style={{ width: 70 }}>OPs</th>
                <th className="r" style={{ width: 90 }}>Padrão</th>
                <th className="r" style={{ width: 100 }}>Média real</th>
                <th className="hide-tab" style={{ width: 200 }}>Menor e maior tempo</th>
                <th className="r" style={{ width: 90 }}>No tempo</th>
                <th style={{ width: 250 }}>Sugestão</th>
              </tr>
            </thead>
            <tbody>
              {(todosProd ? padraoProdutos : padraoProdutos.slice(0, 8)).map((p) => {
                const escalaP = Math.max(p.max, p.padrao) * 1.05;
                const sugere = p.n >= 3 && Math.abs(p.desvio) > 0.15;
                const ruim = p.media > p.padrao * (1 + e.config.toleranciaPct / 100);
                return (
                  <tr key={p.pid} className="click" onClick={() => filtrar({ tipo: 'produto', valor: p.pid, rotulo: p.nome })}>
                    <td className="cel-tit"><span className="nome">{p.nome}</span></td>
                    <td className="r num" data-l="OPs">{p.n}</td>
                    <td className="r num" data-l="Padrão">{fmtDur(p.padrao)}</td>
                    <td className={`r num forte ${ruim ? 'crit' : ''}`} data-l="Média real">{fmtDur(p.media)}</td>
                    <td className="hide-tab">
                      <span className="range" title={`${fmtDur(p.min)} a ${fmtDur(p.max)}`}>
                        <i className="rg" style={{ left: `${(p.min / escalaP) * 100}%`, width: `${Math.max(1, ((p.max - p.min) / escalaP) * 100)}%` }} />
                        <i className="pd" style={{ left: `${(p.padrao / escalaP) * 100}%` }} />
                        <i className={`md ${ruim ? 'bad' : ''}`} style={{ left: `${(p.media / escalaP) * 100}%` }} />
                      </span>
                      <span className="muted num" style={{ fontSize: 11.5 }}>{fmtDur(p.min)} a {fmtDur(p.max)}</span>
                    </td>
                    <td className="r num" data-l="No tempo">{Math.round((p.noTempo / p.n) * 100)}%</td>
                    <td className="cel-larga" data-l="Sugestão" onClick={(ev) => ev.stopPropagation()}>
                      {sugere ? (
                        <span className="linha-ctl">
                          <span className={`chip ${p.desvio > 0 ? 'warn' : 'info'}`}>Padrão parece {p.desvio > 0 ? 'curto' : 'longo'}</span>
                          {pode.parametros(perfil) && <button className="btn sm" onClick={() => usarMedia(p.pid, p.media)}>Usar {fmtDur(Math.round(p.media / 5) * 5)}</button>}
                        </span>
                      ) : (
                        <span className="muted">{p.n < 3 ? 'poucas OPs para avaliar' : 'ok'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!padraoProdutos.length && <tr><td colSpan={7} className="vazio-td"><Vazio compacto icone="grafico" titulo="Sem OPs concluídas no período" /></td></tr>}
            </tbody>
          </table>
        </div>
        {padraoProdutos.length > 8 && (
          <div className="panel-pe">
            <button className="btn" onClick={() => setTodosProd((x) => !x)}>{todosProd ? 'Mostrar só os 8 primeiros' : `Mostrar todos os ${padraoProdutos.length} produtos`}</button>
          </div>
        )}
      </section>

      <div className="rodape-nota">Considera os pedidos dos últimos 120 dias. As OPs que o gerente finalizar entram aqui na hora. Atualizado {hora(agora)}.</div>
      {opAberta && <DetalheOP id={opAberta} onClose={() => setOpAberta(null)} />}
    </main>
  );
}

/* ------------------------------------------------------------------ cartões */

function Kpi({ icone, titulo, valor, unidade, sub, delta, ant, tom = '' }: {
  icone: string;
  titulo: string;
  valor: string;
  unidade?: string;
  sub: string;
  delta: { v: number; txt: string; bom: 'subir' | 'cair' } | null;
  ant: string;
  tom?: string;
}) {
  const igual = delta && Math.abs(delta.v) < 0.05;
  const melhor = delta && !igual && (delta.bom === 'subir' ? delta.v > 0 : delta.v < 0);
  return (
    <div className={`kpi2 ${tom}`}>
      <div className="kpi2-topo">
        <span className="kpi2-ic"><Icon n={icone} s={15} /></span>
        <span className="kpi2-t">{titulo}</span>
      </div>
      <div className="kpi2-v num">{valor}{unidade && <small>{unidade}</small>}</div>
      <div className="kpi2-s">{sub}</div>
      <div className="kpi2-d">
        {delta && ant ? (
          igual ? (
            <span className="delta2">= igual</span>
          ) : (
            <span className={`delta2 ${melhor ? 'bom' : 'ruim'}`}>{delta.v > 0 ? '▲' : '▼'} {delta.txt}</span>
          )
        ) : (
          <span className="delta2">—</span>
        )}
        {ant && <span>{ant}</span>}
      </div>
    </div>
  );
}

function Carteira({ c, capacidade, criticos, risco }: { c: ReturnType<typeof carteira>; capacidade: number; criticos: number; risco: number }) {
  const ETAPAS = [
    { k: 'pcp' as const, l: 'Aguardando PCP', cor: 'var(--warn)' },
    { k: 'fila' as const, l: 'Na fila', cor: 'var(--muted)' },
    { k: 'producao' as const, l: 'Em produção', cor: 'var(--info)' },
    { k: 'pronto' as const, l: 'Pronto p/ expedir', cor: 'var(--ok)' },
  ];
  const total = ETAPAS.reduce((s, x) => s + c.etapas[x.k].volume, 0);
  return (
    <div className="cart">
      <div className="cart-dest">
        <div>
          <b className="num">{nf(c.diasFabrica, 1)}</b>
          <span>dias de fábrica na fila</span>
        </div>
        <p>{c.opsFila} OP{c.opsFila === 1 ? '' : 's'} aguardando + o que falta das em produção = {horas(c.horas)} de trabalho, com {capacidade} OP{capacidade === 1 ? '' : 's'} ao mesmo tempo.</p>
      </div>
      <div className="cart-barra" aria-hidden="true">
        {ETAPAS.map((x) => c.etapas[x.k].volume > 0 && <i key={x.k} style={{ width: `${(c.etapas[x.k].volume / total) * 100}%`, background: x.cor }} />)}
      </div>
      <ul className="cart-lista">
        {ETAPAS.map((x) => (
          <li key={x.k}>
            <i style={{ background: x.cor }} />
            <span>{x.l}</span>
            <span className="num muted">{c.etapas[x.k].n} ped.</span>
            <b className="num">{fmtVol(c.etapas[x.k].volume)}</b>
          </li>
        ))}
      </ul>
      <div className="cart-alerta">
        <span className={`chip ${criticos ? 'crit' : 'ok'}`}>{criticos ? <Icon n="alert" s={12} /> : <Icon n="check" s={12} w={2.6} />} {criticos} atrasado{criticos === 1 ? '' : 's'}</span>
        <span className={`chip ${risco ? 'warn' : ''}`}>{risco} em risco</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ gráficos */

function GraficoDias({ serie }: { serie: ReturnType<typeof volumePorDia> }) {
  const [ref, W] = useLargura<HTMLDivElement>();
  const tip = useTip();
  const H = 270;
  const M = { e: 46, d: 8, t: 22, b: 40 };
  const linhas = ordemLinhas(serie.flatMap((s) => Object.keys(s.porLinha)));
  const max = Math.max(1, ...serie.map((s) => s.total));
  const passo = passoBonito(max);
  const topo = Math.ceil(max / passo) * passo;
  const ticks: number[] = [];
  for (let t = 0; t <= topo + 1e-6; t += passo) ticks.push(t);
  const comVolume = serie.filter((s) => s.total > 0);
  const media = comVolume.length ? comVolume.reduce((s, x) => s + x.total, 0) / comVolume.length : 0;
  const iw = Math.max(0, W - M.e - M.d);
  const ih = H - M.t - M.b;
  const bw = iw / serie.length;
  const larg = Math.min(34, bw * 0.62);
  const y = (v: number) => M.t + ih - (v / topo) * ih;
  const hoje = new Date();
  return (
    <div className="graf" ref={ref}>
      <div className="legend graf-leg">
        {linhas.map((l) => <span key={l}><i style={{ background: corLinha(l) }} />{nomeLinha(l)}</span>)}
        {media > 0 && <span><i className="leg-traco" />média {fmtVol(Math.round(media))}/dia</span>}
      </div>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label="Litros produzidos por dia útil, por linha de produto">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.e} x2={W - M.d} y1={y(t)} y2={y(t)} className={t ? 'g-grade' : 'g-base'} />
              <text x={M.e - 8} y={y(t) + 4} textAnchor="end" className="g-eixo">{litros(t)}</text>
            </g>
          ))}
          {media > 0 && <line x1={M.e} x2={W - M.d} y1={y(media)} y2={y(media)} className="g-media" />}
          {serie.map((s, i) => {
            const cx = M.e + i * bw + bw / 2;
            const x = cx - larg / 2;
            let acum = 0;
            const segs = linhas.filter((l) => s.porLinha[l]);
            const ehHoje = mesmoDia(s.d, hoje);
            return (
              <g
                key={i}
                {...tip.bind(
                  <>
                    <b>{diaSemana(s.d)} {dataCurta(s.d)}</b>
                    {s.total ? `${fmtVol(s.total)} em ${s.nOps} OP${s.nOps === 1 ? '' : 's'}` : 'Nada concluído'}
                    {segs.map((l) => <div key={l}>{nomeLinha(l)}: {fmtVol(s.porLinha[l])}</div>)}
                    {s.acima > 0 && <div>{s.acima} OP{s.acima === 1 ? '' : 's'} acima do tempo</div>}
                  </>,
                )}
              >
                <rect x={M.e + i * bw} y={M.t} width={bw} height={ih} className="g-hit" />
                {segs.map((l, k) => {
                  const v = s.porLinha[l];
                  const y0 = y(acum + v);
                  const h = y(acum) - y0;
                  acum += v;
                  const ultimo = k === segs.length - 1;
                  return ultimo ? (
                    <path key={l} d={barraTopo(x, y0, larg, Math.max(0, h - (k ? 1 : 0)), 5)} fill={corLinha(l)} />
                  ) : (
                    <rect key={l} x={x} y={y0 + 1} width={larg} height={Math.max(0, h - 1)} fill={corLinha(l)} />
                  );
                })}
                {s.total > 0 && bw >= 30 && <text x={cx} y={y(s.total) - 6} textAnchor="middle" className="g-valor">{litros(s.total)}</text>}
                {bw >= 34 && <text x={cx} y={H - 22} textAnchor="middle" className={`g-eixo${ehHoje ? ' forte' : ''}`}>{diaSemana(s.d)}</text>}
                {(bw >= 34 || ehHoje || (serie.length - 1 - i) % (bw >= 20 ? 2 : 3) === 0) && (
                  <text x={cx} y={H - (bw >= 34 ? 8 : 16)} textAnchor="middle" className={`g-eixo peq${ehHoje ? ' forte' : ''}`}>{ehHoje ? 'hoje' : bw >= 34 ? dataCurta(s.d) : dataCurta(s.d).slice(0, 5)}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {tip.el}
    </div>
  );
}

function GraficoSemanas({ semanas }: { semanas: ReturnType<typeof evolucaoSemanal> }) {
  const [ref, W] = useLargura<HTMLDivElement>();
  const tip = useTip();
  const H = 250;
  const M = { e: 46, d: 46, t: 26, b: 34 };
  const iw = Math.max(0, W - M.e - M.d);
  const ih = H - M.t - M.b;
  // eixo de % em passos de 25, sempre passando por 100% (a meta)
  const topoP = Math.max(125, Math.ceil(Math.max(0, ...semanas.map((s) => s.eficiencia ?? 0), ...semanas.map((s) => s.pctPrazo ?? 0)) / 25) * 25);
  const bw = iw / semanas.length;
  const larg = Math.min(44, bw * 0.5);
  const yV = (v: number) => M.t + ih - (v / (topoV || 1)) * ih;
  const yP = (v: number) => M.t + ih - (v / topoP) * ih;
  const cx = (i: number) => M.e + i * bw + bw / 2;
  const linha = (k: 'eficiencia' | 'pctPrazo') => {
    const pts = semanas.map((s, i) => (s[k] === null ? null : [cx(i), yP(s[k]!)] as const)).filter((p): p is readonly [number, number] => !!p);
    return pts.length > 1 ? pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('') : '';
  };
  const ticksP: number[] = [];
  const passoP = topoP <= 150 ? 25 : 50;
  for (let t = 0; t <= topoP; t += passoP) ticksP.push(t);
  // volume usa as mesmas linhas de grade, com valores redondos
  const nTicks = ticksP.length - 1;
  const passoV = passoBonito(Math.max(1, ...semanas.map((s) => s.volume)), nTicks);
  const topoV = passoV * nTicks;
  return (
    <div className="graf" ref={ref}>
      <div className="legend graf-leg">
        <span><i className="leg-barra" />Volume produzido (L)</span>
        <span><i className="leg-linha ef" />Eficiência</span>
        <span><i className="leg-linha pz" />Entregas no prazo</span>
        <span><i className="leg-traco" />Meta 100%</span>
      </div>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label="Volume, eficiência e entregas no prazo por semana">
          {ticksP.map((t, k) => (
            <g key={t}>
              <line x1={M.e} x2={W - M.d} y1={yP(t)} y2={yP(t)} className={k ? 'g-grade' : 'g-base'} />
              <text x={W - M.d + 8} y={yP(t) + 4} className="g-eixo">{nf(t)}%</text>
              <text x={M.e - 8} y={yP(t) + 4} textAnchor="end" className="g-eixo">{litros(passoV * k)}</text>
            </g>
          ))}
          <line x1={M.e} x2={W - M.d} y1={yP(100)} y2={yP(100)} className="g-media" />
          {semanas.map((s, i) => (
            <g
              key={i}
              {...tip.bind(
                <>
                  <b>Semana de {dataCurta(s.inicio)}{s.atual ? ' (atual)' : ''}</b>
                  {fmtVol(s.volume)} em {s.nOps} OP{s.nOps === 1 ? '' : 's'}
                  <div>Eficiência: {pct(s.eficiencia)}</div>
                  <div>Entregas no prazo: {pct(s.pctPrazo)} ({s.noPrazo}/{s.pedidosProntos})</div>
                  <div>Tempo perdido: {fmtDur(s.perdidoMin)}</div>
                </>,
              )}
            >
              <rect x={M.e + i * bw} y={M.t} width={bw} height={ih} className="g-hit" />
              {s.volume > 0 && <path d={barraTopo(cx(i) - larg / 2, yV(s.volume), larg, yV(0) - yV(s.volume), 5)} className={`g-barra-sem${s.atual ? ' atual' : ''}`} />}
              {(s.atual || bw >= 52 || (semanas.length - 1 - i) % 2 === 0) && (
                <text x={cx(i)} y={H - 12} textAnchor="middle" className={`g-eixo${s.atual ? ' forte' : ''}`}>{s.atual ? (bw >= 70 ? 'esta semana' : 'atual') : dataCurta(s.inicio)}</text>
              )}
            </g>
          ))}
          <path d={linha('pctPrazo')} className="g-linha pz" />
          <path d={linha('eficiencia')} className="g-linha ef" />
          {semanas.map((s, i) => (
            <g key={i} pointerEvents="none">
              {s.pctPrazo !== null && <circle cx={cx(i)} cy={yP(s.pctPrazo)} r={4} className="g-ponto pz" />}
              {s.eficiencia !== null && (
                <>
                  <circle cx={cx(i)} cy={yP(s.eficiencia)} r={4.5} className="g-ponto ef" />
                  {bw >= 54 && <text x={cx(i)} y={yP(s.eficiencia) - 10} textAnchor="middle" className="g-valor ef">{nf(s.eficiencia)}%</text>}
                </>
              )}
            </g>
          ))}
        </svg>
      )}
      {tip.el}
    </div>
  );
}

function Pareto({ itens, ativo, onClick }: { itens: ReturnType<typeof paretoMotivos>; ativo: string | null; onClick: (k: string) => void }) {
  if (!itens.length) return <Vazio compacto icone="check" titulo="Nenhum atraso no período">Todas as OPs ficaram dentro da tolerância.</Vazio>;
  const max = itens[0].min;
  return (
    <div className="hb">
      {itens.map((x) => (
        <button key={x.k} className={`hb-l${ativo === x.k ? ' on' : ''}`} onClick={() => onClick(x.k)} title="Ver estas OPs na lista">
          <span className="hb-t">{x.k}</span>
          <span className="hb-v num"><b>{fmtDur(x.min)}</b> · {x.n} OP{x.n > 1 ? 's' : ''}</span>
          <span className="hb-trilho"><i className="crit" style={{ width: `${Math.max(3, (x.min / max) * 100)}%` }} /></span>
          <span className="hb-ac num" title="Percentual acumulado">{nf(x.acumulado)}%</span>
        </button>
      ))}
      <div className="hb-nota">A última coluna é o acumulado: resolvendo os primeiros motivos, some essa parte do atraso.</div>
    </div>
  );
}

function Estouram({ itens, ativo, onClick }: { itens: (ReturnType<typeof produtosQueEstouram>[number] & { nome: string })[]; ativo: string | null; onClick: (pid: string) => void }) {
  if (!itens.length) return <Vazio compacto icone="check" titulo="Nenhum produto estourou o tempo" />;
  const max = itens[0].min;
  return (
    <div className="hb">
      {itens.map((x) => (
        <button key={x.pid} className={`hb-l${ativo === x.pid ? ' on' : ''}`} onClick={() => onClick(x.pid)} title="Ver as OPs deste produto">
          <span className="hb-t">{x.nome}</span>
          <span className="hb-v num"><b>{fmtDur(x.min)}</b> · {x.acima} de {x.n} OPs</span>
          <span className="hb-trilho"><i style={{ width: `${Math.max(3, (x.min / max) * 100)}%`, background: corLinha(linhaDe(x.pid)) }} /></span>
          <span className="hb-ac num" title="Eficiência do produto no período">{nf(x.eficiencia)}%</span>
        </button>
      ))}
      <div className="hb-nota">A última coluna é a eficiência do produto no período (100% = no tempo padrão).</div>
    </div>
  );
}

function RoscaLinhas({ linhas }: { linhas: ReturnType<typeof porLinha> }) {
  if (!linhas.length) return <Vazio compacto icone="grafico" titulo="Nada produzido no período" />;
  const R = 58;
  const C = 2 * Math.PI * R;
  const total = linhas.reduce((s, l) => s + l.volume, 0);
  let acum = 0;
  return (
    <div className="rosca2">
      <div className="rosca2-g">
        <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
          <circle cx="80" cy="80" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="20" />
          {linhas.map((l) => {
            const len = (l.volume / total) * C;
            const el = <circle key={l.linha} cx="80" cy="80" r={R} fill="none" stroke={corLinha(l.linha)} strokeWidth="20" strokeDasharray={`${Math.max(0.1, len - (linhas.length > 1 ? 2 : 0))} ${C}`} strokeDashoffset={-acum} transform="rotate(-90 80 80)" />;
            acum += len;
            return el;
          })}
        </svg>
        <div className="rosca2-c"><b className="num">{litros(total)}</b><span>litros</span></div>
      </div>
      <table className="rosca2-t">
        <thead><tr><th>Linha</th><th className="r">Volume</th><th className="r">Efic.</th></tr></thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.linha}>
              <td><i style={{ background: corLinha(l.linha) }} />{nomeLinha(l.linha)}</td>
              <td className="r num">{nf(l.pct)}%</td>
              <td className={`r num ${l.eficiencia !== null && l.eficiencia < 90 ? 'crit' : ''}`}>{pct(l.eficiencia)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <div className="modal-topo">
        <div>
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
      <dl className="kv">
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
