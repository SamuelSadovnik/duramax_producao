import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from './store';
import { Icon, Modal, PrazoChip, Vazio, nomeOP, useTip } from './ui';
import { dataCurta, dataISOparaBR, diaSemana, fmtDur, fmtVol, hora, mesmoDia, nf, quando, titulo } from '../shared/fmt';
import { LINHAS, nomeLinha } from '../shared/catalog';
import { prazoDoPedido, situacaoPrazo, statusPedido } from '../shared/engine';
import {
  acimaDaTolerancia,
  carteira,
  tempoSuspeito,
  evolucaoSemanal,
  indicadores,
  intervalos,
  linhaDe,
  opsConcluidas,
  paretoMotivos,
  porLinha,
  volumePorDia,
  type PeriodoK,
} from '../shared/metricas';

/*
 * Desempenho no mesmo estilo do Duramax BI: painel escuro, linhas suaves com área em degradê,
 * valor e variação em cada ponto, barras finas e rosca fina. Os gráficos são desenhados na
 * largura real da tela, então o texto fica sempre do mesmo tamanho.
 */

const PERIODOS: { k: PeriodoK; l: string; ant: string }[] = [
  { k: 'hoje', l: 'Hoje', ant: '' },
  { k: '7', l: '7 dias', ant: 'vs 7 dias anteriores' },
  { k: '30', l: '30 dias', ant: 'vs 30 dias anteriores' },
  { k: 'tudo', l: 'Tudo', ant: '' },
];

// Cor fixa por linha de produto (a cor acompanha a linha em todos os gráficos).
const ORDEM_LINHAS = ['600', '610', '800', '400', '200'];
// paleta dos gráficos do sistema (testada para daltonismo), nas duas versões, clara e escura
const CORES_LINHA = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const corLinha = (l: string) => {
  const i = ORDEM_LINHAS.indexOf(l);
  return CORES_LINHA[i >= 0 ? i : 5 + ([...l].reduce((s, c) => s + c.charCodeAt(0), 0) % 3)];
};

/** Largura real do elemento. */
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

/** Curva suave que não "passa do ponto" (interpolação monotônica de Fritsch–Carlson). */
function curva(pts: [number, number][]) {
  const n = pts.length;
  if (n < 2) return '';
  if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3;
    d += `C${pts[i][0] + c},${pts[i][1] + t[i] * c} ${pts[i + 1][0] - c},${pts[i + 1][1] - t[i + 1] * c} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

export function DashboardView() {
  const { e, agora, agenda, abrirPedido } = useApp();
  const [periodo, setPeriodo] = useState<PeriodoK>('30');
  const [linha, setLinha] = useState('');
  const [filtro, setFiltro] = useState<{ tipo: 'motivo' | 'produto'; valor: string; rotulo: string } | null>(null);
  const [soAcima, setSoAcima] = useState(false);
  const [limite, setLimite] = useState(12);
  const [opAberta, setOpAberta] = useState<string | null>(null);
  const [volPor, setVolPor] = useState<'dia' | 'semana'>('dia');

  const per = PERIODOS.find((p) => p.k === periodo)!;
  const d = useMemo(() => {
    const iv = intervalos(periodo, agora);
    return {
      atual: indicadores(e, iv.atual, linha),
      anterior: iv.anterior ? indicadores(e, iv.anterior, linha) : null,
      ops: opsConcluidas(e, iv.atual, linha),
      diasSerie: volumePorDia(e, agora, 15, linha),
      semanas: evolucaoSemanal(e, agora, 8, linha),
      pareto: paretoMotivos(e, iv.atual, linha),
      linhas: porLinha(e, iv.atual),
      cart: carteira(e, agora, (p) => statusPedido(e, p)),
    };
  }, [e, periodo, linha, agora]);

  // eficiência por produto no período: os mais lentos primeiro
  const lentos = useMemo(() => {
    const m = new Map<string, { padrao: number; real: number; n: number }>();
    for (const o of d.ops) {
      if (tempoSuspeito(o)) continue;
      const v = m.get(o.produtoId) ?? { padrao: 0, real: 0, n: 0 };
      v.padrao += o.tempoPadraoMin;
      v.real += o.realMin ?? 0;
      v.n++;
      m.set(o.produtoId, v);
    }
    return [...m]
      .filter(([, v]) => v.real > 0)
      .map(([pid, v]) => ({ pid, nome: e.produtos[pid]?.nome ?? pid, n: v.n, ef: (v.padrao / v.real) * 100 }))
      .sort((a, b) => a.ef - b.ef)
      .slice(0, 8);
  }, [d.ops, e.produtos]);

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
    setLimite(12);
    setTimeout(() => document.getElementById('lista-ops')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };

  const a = d.atual;
  const b = d.anterior;
  const semDados = !a.nOps && !a.pedidosProntos;
  const hoje = new Date();

  const serieVolume: Ponto[] =
    volPor === 'dia'
      ? d.diasSerie.map((s) => ({ rotulo: mesmoDia(s.d, hoje) ? 'hoje' : dataCurta(s.d), sub: diaSemana(s.d), v: s.total, dica: `${s.nOps} OP${s.nOps === 1 ? '' : 's'} concluída${s.nOps === 1 ? '' : 's'}` }))
      : d.semanas.map((s) => ({ rotulo: s.atual ? 'atual' : dataCurta(s.inicio), sub: s.atual ? 'semana' : 'semana de', v: s.volume, dica: `${s.nOps} OP${s.nOps === 1 ? '' : 's'} concluída${s.nOps === 1 ? '' : 's'}` }));
  const comVolume = serieVolume.filter((p) => (p.v ?? 0) > 0);
  const mediaVolume = comVolume.length ? comVolume.reduce((s, p) => s + (p.v ?? 0), 0) / comVolume.length : 0;
  const serieEf: Ponto[] = d.semanas.map((s) => ({ rotulo: s.atual ? 'atual' : dataCurta(s.inicio), sub: s.atual ? 'semana' : 'semana de', v: s.eficiencia, dica: `${s.nOps} OP${s.nOps === 1 ? '' : 's'} · ${fmtDur(s.perdidoMin)} perdidos` }));
  const seriePz: Ponto[] = d.semanas.map((s) => ({ rotulo: s.atual ? 'atual' : dataCurta(s.inicio), sub: s.atual ? 'semana' : 'semana de', v: s.pctPrazo, dica: `${s.noPrazo} de ${s.pedidosProntos} pedidos no prazo` }));
  const mediaDe = (l: Ponto[]) => {
    const v = l.map((p) => p.v).filter((x): x is number => x !== null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };

  return (
    <main className="page dash bi">
      <div className="page-head">
        <div>
          <h1>Desempenho da produção</h1>
          <p>Entregas, volume, eficiência e perdas. Os indicadores comparam com o período anterior de mesmo tamanho.</p>
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

      <div className="bi-kpis">
        <Kpi
          destaque
          titulo="Entregas no prazo"
          valor={pct(a.pctPrazo)}
          sub={a.pedidosProntos ? `${a.noPrazo} de ${a.pedidosProntos} pedidos prontos dentro dos ${e.config.prazoDiasUteis} dias úteis` : 'nenhum pedido ficou pronto no período'}
          barra={a.pctPrazo}
          delta={b && a.pctPrazo !== null && b.pctPrazo !== null ? { v: a.pctPrazo - b.pctPrazo, txt: `${nf(Math.abs(a.pctPrazo - b.pctPrazo), 1)} p.p.`, bom: 'subir' } : null}
          ant={per.ant}
        />
        <Kpi titulo="Lead time" valor={dias(a.leadTimeDias)} unidade={a.leadTimeDias === null ? '' : 'dias úteis'} sub="da entrada no sistema até ficar pronto" delta={b && a.leadTimeDias !== null && b.leadTimeDias !== null ? { v: a.leadTimeDias - b.leadTimeDias, txt: `${nf(Math.abs(a.leadTimeDias - b.leadTimeDias), 1)} dia`, bom: 'cair' } : null} ant={per.ant} />
        <Kpi titulo="Volume produzido" valor={litros(a.volume)} unidade="L" sub={`${a.nOps} lote${a.nOps === 1 ? '' : 's'} concluído${a.nOps === 1 ? '' : 's'}`} delta={b && b.volume ? { v: a.volume - b.volume, txt: `${nf(Math.abs((a.volume / b.volume - 1) * 100), 1)}%`, bom: 'subir' } : null} ant={per.ant} />
        <Kpi titulo="Eficiência" valor={pct(a.eficiencia)} sub={a.nSuspeitas ? `padrão ÷ real · ${a.nSuspeitas} OP${a.nSuspeitas === 1 ? '' : 's'} com tempo curto demais fora da conta` : 'tempo padrão ÷ tempo real das OPs'} delta={b && a.eficiencia !== null && b.eficiencia !== null ? { v: a.eficiencia - b.eficiencia, txt: `${nf(Math.abs(a.eficiencia - b.eficiencia), 1)} p.p.`, bom: 'subir' } : null} ant={per.ant} />
        <Kpi titulo="Tempo perdido" valor={a.perdidoMin ? fmtDur(a.perdidoMin) : '0'} sub={`acima do padrão em ${a.nAcima} de ${a.nOps} OPs`} delta={b ? { v: a.perdidoMin - b.perdidoMin, txt: fmtDur(Math.abs(a.perdidoMin - b.perdidoMin)), bom: 'cair' } : null} ant={per.ant} />
        <Kpi titulo="Tempo no PCP" valor={horas(a.pcpHoras)} sub="da entrada até a liberação (expediente)" delta={b && a.pcpHoras !== null && b.pcpHoras !== null ? { v: a.pcpHoras - b.pcpHoras, txt: horas(Math.abs(a.pcpHoras - b.pcpHoras)), bom: 'cair' } : null} ant={per.ant} />
      </div>

      <div className="bi-g2">
        <Cartao
          titulo="Volume produzido"
          sub={mediaVolume ? `Média ${volPor === 'dia' ? 'dos dias' : 'das semanas'} com produção: ${fmtVol(Math.round(mediaVolume))}` : 'Litros dos lotes concluídos'}
          acoes={
            <div className="seg" role="group" aria-label="Agrupar por">
              <button aria-pressed={volPor === 'dia'} onClick={() => setVolPor('dia')}>Por dia</button>
              <button aria-pressed={volPor === 'semana'} onClick={() => setVolPor('semana')}>Por semana</button>
            </div>
          }
          tabela={<TabelaSerie pontos={serieVolume} coluna="Litros" fmt={(v) => fmtVol(v)} />}
        >
          <LinhaArea pontos={serieVolume} cor="var(--c-vol)" fmt={(v) => fmtVol(v)} eixo={(v) => litros(v)} deltaFmt="pct" zeroComoLacuna={false} />
        </Cartao>
        <Cartao titulo="Carteira agora" sub={`Pedidos abertos às ${hora(agora)}`}>
          <Carteira c={d.cart} capacidade={e.config.capacidade} criticos={criticos.filter((x) => x.s.tipo === 'atrasado').length} risco={criticos.filter((x) => x.s.tipo === 'risco').length} />
        </Cartao>
      </div>

      <div className="bi-g2 iguais">
        <Cartao
          titulo="Eficiência por semana"
          sub={mediaDe(serieEf) !== null ? `Média do período: ${pct(mediaDe(serieEf))} · 100% = no tempo padrão` : '100% = no tempo padrão'}
          tabela={<TabelaSerie pontos={serieEf} coluna="Eficiência" fmt={(v) => pct(v)} />}
        >
          <LinhaArea pontos={serieEf} cor="var(--c-ef)" fmt={(v) => pct(v)} eixo={(v) => `${nf(v)}%`} deltaFmt="pp" referencia={{ v: 100, rotulo: 'meta' }} />
        </Cartao>
        <Cartao
          titulo="Entregas no prazo por semana"
          sub={mediaDe(seriePz) !== null ? `Média do período: ${pct(mediaDe(seriePz))} dos pedidos prontos no prazo` : 'Pedidos prontos dentro do prazo'}
          tabela={<TabelaSerie pontos={seriePz} coluna="No prazo" fmt={(v) => pct(v)} />}
        >
          <LinhaArea pontos={seriePz} cor="var(--c-pz)" fmt={(v) => pct(v)} eixo={(v) => `${nf(v)}%`} deltaFmt="pp" referencia={{ v: 100, rotulo: 'meta' }} />
        </Cartao>
      </div>

      {semDados ? (
        <div className="bi-card">
          <Vazio icone="grafico" titulo={`Nenhuma OP concluída ${periodo === 'hoje' ? 'hoje' : 'neste período'}`}>
            Os gráficos de perdas e eficiência aparecem quando o gerente finalizar OPs no chão de fábrica.
          </Vazio>
        </div>
      ) : (
        <div className="bi-g3">
          <Cartao titulo="Onde o tempo foi perdido" sub="Horas acima do padrão, por motivo · clique para ver as OPs">
            {d.pareto.length ? (
              <BarrasH
                itens={d.pareto.map((x) => ({ k: x.k, rotulo: x.k, v: x.min, valor: `${fmtDur(x.min)} · ${x.n} OP${x.n > 1 ? 's' : ''}`, cor: 'var(--c-barra)' }))}
                eixo={(v) => fmtDur(v)}
                ativo={filtro?.tipo === 'motivo' ? filtro.valor : null}
                onClick={(k) => filtrar({ tipo: 'motivo', valor: k, rotulo: k })}
              />
            ) : (
              <Vazio compacto icone="check" titulo="Nenhum atraso no período">Todas as OPs ficaram dentro da tolerância.</Vazio>
            )}
          </Cartao>
          <Cartao titulo="Produtos mais lentos" sub="Eficiência no período · 100% = no tempo padrão">
            {lentos.length ? (
              <BarrasH
                itens={lentos.map((x) => ({ k: x.pid, rotulo: x.nome, v: x.ef, valor: `${nf(x.ef)}%`, cor: x.ef >= 100 ? 'var(--ok)' : x.ef >= 90 ? 'var(--warn)' : 'var(--crit)' }))}
                eixo={(v) => `${nf(v)}%`}
                referencia={100}
                ativo={filtro?.tipo === 'produto' ? filtro.valor : null}
                onClick={(k) => filtrar({ tipo: 'produto', valor: k, rotulo: e.produtos[k]?.nome ?? k })}
              />
            ) : (
              <Vazio compacto icone="grafico" titulo="Sem OPs concluídas" />
            )}
          </Cartao>
          <Cartao titulo="Produção por linha" sub={`Participação no volume · ${per.l.toLowerCase()}`}>
            <RoscaLinhas linhas={d.linhas} />
          </Cartao>
        </div>
      )}

      <section className="bi-card flush">
        <div className="bi-card-cab">
          <div>
            <h2>Pedidos atrasados ou em risco</h2>
            <p>Pela estimativa da fila atual</p>
          </div>
          <div className="bi-card-acoes">
            <span className="chip crit">{criticos.filter((x) => x.s.tipo === 'atrasado').length} atrasados</span>
            <span className="chip warn">{criticos.filter((x) => x.s.tipo === 'risco').length} em risco</span>
          </div>
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

      <section className="bi-card flush" id="lista-ops">
        <div className="bi-card-cab">
          <div>
            <h2>OPs concluídas</h2>
            <p>Tempo real de cada lote comparado com o tempo padrão</p>
          </div>
          <div className="bi-card-acoes">
            {filtro && (
              <button className="chip info" onClick={() => setFiltro(null)}>
                {filtro.tipo === 'motivo' ? 'Motivo' : 'Produto'}: {filtro.rotulo} <Icon n="x" s={12} />
              </button>
            )}
            <div className="seg" role="group" aria-label="Quais OPs">
              <button aria-pressed={!soAcima} onClick={() => setSoAcima(false)}>Todas</button>
              <button aria-pressed={soAcima} onClick={() => setSoAcima(true)}>Acima da tolerância</button>
            </div>
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

      <div className="rodape-nota">Considera os pedidos dos últimos 120 dias. As OPs que o gerente finalizar entram aqui na hora. Atualizado {hora(agora)}.</div>
      {opAberta && <DetalheOP id={opAberta} onClose={() => setOpAberta(null)} />}
    </main>
  );
}

/* ------------------------------------------------------------------ peças do painel */

/** Cartão de gráfico: título, subtítulo e, quando há, o botão Tabela (troca o gráfico pelos números). */
function Cartao({ titulo, sub, acoes, tabela, children }: { titulo: string; sub?: string; acoes?: ReactNode; tabela?: ReactNode; children: ReactNode }) {
  const [verTabela, setVerTabela] = useState(false);
  return (
    <section className="bi-card">
      <div className="bi-card-cab">
        <div>
          <h2>{titulo}</h2>
          {sub && <p>{sub}</p>}
        </div>
        <div className="bi-card-acoes">
          {acoes}
          {tabela && (
            <button className={`bi-btn${verTabela ? ' on' : ''}`} onClick={() => setVerTabela((x) => !x)} aria-pressed={verTabela}>
              <Icon n={verTabela ? 'grafico' : 'pedidos'} s={13} /> {verTabela ? 'Gráfico' : 'Tabela'}
            </button>
          )}
        </div>
      </div>
      {verTabela ? tabela : children}
    </section>
  );
}

function Kpi({ titulo, valor, unidade, sub, delta, ant, destaque, barra }: {
  titulo: string;
  valor: string;
  unidade?: string;
  sub: string;
  delta: { v: number; txt: string; bom: 'subir' | 'cair' } | null;
  ant: string;
  destaque?: boolean;
  barra?: number | null;
}) {
  const igual = delta && Math.abs(delta.v) < 0.05;
  const melhor = delta && !igual && (delta.bom === 'subir' ? delta.v > 0 : delta.v < 0);
  return (
    <div className={`bi-kpi${destaque ? ' destaque' : ''}`}>
      <span className="bi-kpi-t">{titulo}</span>
      <div className="bi-kpi-v">{valor}{unidade && <small>{unidade}</small>}</div>
      <div className="bi-kpi-s">{sub}</div>
      {barra !== undefined && (
        <div className="bi-kpi-barra" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, barra ?? 0))}%` }} /></div>
      )}
      <div className="bi-kpi-d">
        {delta && ant ? (
          igual ? <span>= igual {ant}</span> : <span className={melhor ? 'bom' : 'ruim'}>{delta.v > 0 ? '↗' : '↘'} {delta.txt} <em>{ant}</em></span>
        ) : (
          <span className="muted">{ant ? 'sem dados no período anterior' : 'sem comparação'}</span>
        )}
      </div>
    </div>
  );
}

interface Ponto {
  rotulo: string;
  sub?: string;
  v: number | null;
  dica?: string;
}

function TabelaSerie({ pontos, coluna, fmt }: { pontos: Ponto[]; coluna: string; fmt: (v: number) => string }) {
  return (
    <div className="bi-tabela">
      <table className="t">
        <thead><tr><th>Período</th><th className="r">{coluna}</th><th className="r">Variação</th><th>Detalhe</th></tr></thead>
        <tbody>
          {pontos.map((p, i) => {
            const ant = pontos.slice(0, i).reverse().find((x) => x.v !== null);
            const dv = p.v !== null && ant && ant.v !== null ? p.v - ant.v : null;
            return (
              <tr key={i}>
                <td>{p.sub ? `${p.sub} ` : ''}{p.rotulo}</td>
                <td className="r num forte">{p.v === null ? '—' : fmt(p.v)}</td>
                <td className={`r num ${dv === null || dv === 0 ? 'muted' : dv > 0 ? 'ok' : 'crit'}`}>{dv === null ? '—' : `${dv > 0 ? '+' : '−'}${fmt(Math.abs(dv))}`}</td>
                <td className="muted">{p.dica ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Linha suave com área em degradê, como no BI: valor em cima de cada ponto e variação embaixo.
 * Com muitos pontos, o rótulo fica só no primeiro, no maior, no menor e no último (o resto no tooltip).
 * Período sem dado aparece como lacuna.
 */
function LinhaArea({ pontos, cor, fmt, eixo, deltaFmt, referencia, zeroComoLacuna = true }: {
  pontos: Ponto[];
  cor: string;
  fmt: (v: number) => string;
  eixo: (v: number) => string;
  deltaFmt: 'pct' | 'pp';
  referencia?: { v: number; rotulo: string };
  zeroComoLacuna?: boolean;
}) {
  const [ref, W] = useLargura<HTMLDivElement>();
  const tip = useTip();
  const id = useRef(`g${Math.random().toString(36).slice(2, 8)}`).current;
  const vals = pontos.map((p) => (p.v === null || (zeroComoLacuna && p.v === 0) ? null : p.v));
  const validos = vals.filter((v): v is number => v !== null);
  if (!validos.length) return <Vazio compacto icone="grafico" titulo="Ainda sem dados neste período" />;

  const H = 250;
  const M = { e: 62, d: 28, t: 40, b: 34 };
  const iw = Math.max(0, W - M.e - M.d);
  const ih = H - M.t - M.b;
  const maxV = Math.max(...validos, referencia?.v ?? 0);
  const passo = passoBonito(maxV * 1.12 || 1);
  const topo = Math.ceil((maxV * 1.12) / passo) * passo || passo;
  const ticks: number[] = [];
  for (let t = 0; t <= topo + 1e-9; t += passo) ticks.push(t);
  const n = pontos.length;
  const x = (i: number) => M.e + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => M.t + ih - (v / topo) * ih;

  // trechos contínuos (lacunas quebram a linha)
  const trechos: [number, number][][] = [];
  let atual: [number, number][] = [];
  vals.forEach((v, i) => {
    if (v === null) {
      if (atual.length) trechos.push(atual);
      atual = [];
    } else atual.push([x(i), y(v)]);
  });
  if (atual.length) trechos.push(atual);

  const iMax = vals.indexOf(Math.max(...validos));
  const iMin = vals.indexOf(Math.min(...validos));
  const primeiro = vals.findIndex((v) => v !== null);
  const ultimo = vals.length - 1 - [...vals].reverse().findIndex((v) => v !== null);
  // com pouco espaço por ponto, o rótulo fica só nos pontos que contam a história
  const rotular = (i: number) => (n <= 9 && iw / Math.max(1, n - 1) >= 70) || i === iMax || i === ultimo || (iw >= 500 && (i === iMin || i === primeiro));
  const cadaN = Math.ceil(n / Math.max(1, Math.floor(iw / 72)));

  return (
    <div className="graf bi-graf" ref={ref}>
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label="Gráfico de linha">
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: cor, stopOpacity: 0.22 }} />
              <stop offset="100%" style={{ stopColor: cor, stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.e} x2={W - M.d} y1={y(t)} y2={y(t)} className="bi-grade" />
              <text x={M.e - 10} y={y(t) + 4} textAnchor="end" className="bi-eixo">{eixo(t)}</text>
            </g>
          ))}
          {referencia && (
            <g>
              <line x1={M.e} x2={W - M.d} y1={y(referencia.v)} y2={y(referencia.v)} className="bi-ref" />
              <text x={W - M.d + 4} y={y(referencia.v) + 4} className="bi-eixo">{referencia.rotulo}</text>
            </g>
          )}
          {trechos.map((t, k) => (
            <g key={k}>
              {t.length > 1 && <path d={`${curva(t)}L${t[t.length - 1][0]},${y(0)}L${t[0][0]},${y(0)}Z`} fill={`url(#${id})`} />}
              <path d={curva(t)} fill="none" stroke={cor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
          {pontos.map((p, i) => {
            const v = vals[i];
            const anterior = vals.slice(0, i).reverse().find((z) => z !== null);
            const dv = v !== null && anterior !== undefined && anterior !== null ? (deltaFmt === 'pct' ? (anterior ? ((v - anterior) / anterior) * 100 : null) : v - anterior) : null;
            const mostra = v !== null && rotular(i);
            const xi = x(i);
            const ancora = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
            return (
              <g
                key={i}
                {...tip.bind(
                  <>
                    <b>{p.sub ? `${p.sub} ` : ''}{p.rotulo}</b>
                    {v === null ? 'sem dados' : fmt(v)}
                    {dv !== null && <div>{dv >= 0 ? '▲' : '▼'} {nf(Math.abs(dv), 1)}{deltaFmt === 'pct' ? '%' : ' p.p.'} vs anterior</div>}
                    {p.dica && <div>{p.dica}</div>}
                  </>,
                )}
              >
                <rect x={xi - (iw / Math.max(1, n - 1)) / 2} y={M.t - 30} width={iw / Math.max(1, n - 1)} height={ih + 30} className="g-hit" />
                {v !== null && <circle cx={xi} cy={y(v)} r={3.5} fill={cor} className="bi-ponto" />}
                {mostra && (
                  <>
                    <text x={xi} y={y(v!) - 12} textAnchor={ancora} className="bi-valor">{fmt(v!)}</text>
                    {dv !== null && Math.abs(dv) >= 0.05 && (
                      <text x={xi} y={y(v!) + 20} textAnchor={ancora} className={`bi-delta ${dv > 0 ? 'sobe' : 'desce'}`}>
                        {dv > 0 ? '▲' : '▼'} {dv > 0 ? '+' : '−'}{nf(Math.abs(dv), 1)}{deltaFmt === 'pct' ? '%' : ' p.p.'}
                      </text>
                    )}
                  </>
                )}
                {(n - 1 - i) % cadaN === 0 && (
                  <text x={xi} y={H - 10} textAnchor={ancora} className={`bi-eixo${p.rotulo === 'hoje' || p.rotulo === 'atual' ? ' forte' : ''}`}>{p.rotulo}</text>
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

/** Barras horizontais finas com rótulo à esquerda e escala embaixo (como "Quem mais faturou" no BI). */
function BarrasH({ itens, eixo, referencia, ativo, onClick }: {
  itens: { k: string; rotulo: string; v: number; valor: string; cor: string }[];
  eixo: (v: number) => string;
  referencia?: number;
  ativo: string | null;
  onClick: (k: string) => void;
}) {
  // a escala vai além do maior valor para o número caber sempre à direita da barra
  const max = Math.max(...itens.map((x) => x.v), referencia ?? 0);
  const passo = passoBonito(max * 1.45 || 1, 4);
  const topo = Math.ceil((max * 1.45) / passo) * passo || passo;
  const ticks: number[] = [];
  for (let t = 0; t <= topo + 1e-9; t += passo) ticks.push(t);
  const p = (v: number) => `${(v / topo) * 100}%`;
  return (
    <div className="hbar">
      <div className="hbar-grade" aria-hidden="true">
        {ticks.map((t) => <i key={t} style={{ left: p(t) }} />)}
        {referencia !== undefined && <i className="ref" style={{ left: p(referencia) }} />}
      </div>
      {itens.map((x) => (
        <button key={x.k} className={`hbar-l${ativo === x.k ? ' on' : ''}`} onClick={() => onClick(x.k)} title={`${x.rotulo}: ${x.valor}`}>
          <span className="hbar-r">{x.rotulo}</span>
          <span className="hbar-trilho">
            <i style={{ width: p(x.v), background: x.cor }} />
            <em style={{ left: `calc(${p(x.v)} + 8px)` }}>{x.valor}</em>
          </span>
        </button>
      ))}
      <div className="hbar-eixo" aria-hidden="true">
        <span />
        <span className="hbar-ticks">{ticks.map((t) => <b key={t} style={{ left: p(t) }}>{eixo(t)}</b>)}</span>
      </div>
    </div>
  );
}

/** Rosca fina com legenda ao lado, como "Composição do faturamento" no BI. */
function RoscaLinhas({ linhas }: { linhas: ReturnType<typeof porLinha> }) {
  if (!linhas.length) return <Vazio compacto icone="grafico" titulo="Nada produzido no período" />;
  const R = 66;
  const C = 2 * Math.PI * R;
  const total = linhas.reduce((s, l) => s + l.volume, 0);
  let acum = 0;
  return (
    <div className="bi-rosca">
      <div className="bi-rosca-g">
        <svg width="172" height="172" viewBox="0 0 172 172" aria-hidden="true">
          <circle cx="86" cy="86" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="18" />
          {linhas.map((l) => {
            const len = (l.volume / total) * C;
            const gap = linhas.length > 1 ? 3 : 0;
            const el = <circle key={l.linha} cx="86" cy="86" r={R} fill="none" stroke={corLinha(l.linha)} strokeWidth="18" strokeDasharray={`${Math.max(0.1, len - gap)} ${C}`} strokeDashoffset={-acum} transform="rotate(-90 86 86)" />;
            acum += len;
            return el;
          })}
        </svg>
        <div className="bi-rosca-c"><b>{litros(total)}</b><span>litros</span></div>
      </div>
      <ul className="bi-rosca-leg">
        {linhas.map((l) => (
          <li key={l.linha}>
            <i style={{ background: corLinha(l.linha) }} />
            <span>{nomeLinha(l.linha)}</span>
            <b className="num">{nf(l.pct)}%</b>
            <em className="num">{fmtVol(l.volume)}</em>
          </li>
        ))}
      </ul>
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
