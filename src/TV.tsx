import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useApp, useRelogio } from './store';
import { Icon, nomeOP } from './ui';
import { filaOrdenada } from '../shared/engine';
import { expedienteEntre, situacaoTurno } from '../shared/calendar';
import { dataCurta, diaSemanaLongo, fmtDur, fmtVol, hora, mesmoDia, quando, titulo } from '../shared/fmt';
const logo = '/logo-h-white.png';

/**
 * Lista que rola sozinha para cima quando não cabe na coluna (como painel de aeroporto).
 * Se couber, fica parada. O conteúdo é repetido para a volta ficar contínua.
 */
function Rolagem({ children, pxPorSeg = 28 }: { children: ReactNode; pxPorSeg?: number }) {
  const caixa = useRef<HTMLDivElement>(null);
  const bloco = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState(0);
  const [anda, setAnda] = useState(false);
  useLayoutEffect(() => {
    const medir = () => {
      const c = caixa.current;
      const b = bloco.current;
      if (!c || !b) return;
      const h = b.offsetHeight;
      // só troca a velocidade quando a altura muda de verdade, para a animação não pular
      setAltura((x) => (Math.abs(x - h) > 6 ? h : x));
      setAnda(h > c.clientHeight + 4);
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (caixa.current) ro.observe(caixa.current);
    if (bloco.current) ro.observe(bloco.current);
    return () => ro.disconnect();
  }, []);
  const estilo = anda ? ({ '--dist': `${altura}px`, animationDuration: `${Math.max(12, altura / pxPorSeg)}s` } as CSSProperties) : undefined;
  return (
    <div className={`tv-rola${anda ? ' anda' : ''}`} ref={caixa}>
      <div className="tv-rola-in" style={estilo}>
        <div className="tv-rola-bloco" ref={bloco}>{children}</div>
        {anda && <div className="tv-rola-bloco" aria-hidden="true">{children}</div>}
      </div>
    </div>
  );
}

/** Faixa que corre para o lado o tempo todo; se o texto for curto, ele se repete até encher a tela. */
function Letreiro({ rotulo, itens }: { rotulo: string; itens: string[] }) {
  const caixa = useRef<HTMLDivElement>(null);
  const trilho = useRef<HTMLDivElement>(null);
  const [larg, setLarg] = useState(0);
  const [reps, setReps] = useState(1);
  useLayoutEffect(() => {
    const medir = () => {
      const c = caixa.current;
      const t = trilho.current;
      if (!c || !t || !t.offsetWidth) return;
      setLarg(t.offsetWidth);
      setReps(Math.max(1, Math.ceil(c.clientWidth / t.offsetWidth)));
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (caixa.current) ro.observe(caixa.current);
    if (trilho.current) ro.observe(trilho.current);
    return () => ro.disconnect();
  }, [itens.join('|')]);
  const dist = larg * reps;
  const estilo = larg ? ({ '--dist': `${dist}px`, animationDuration: `${Math.max(16, dist / 70)}s` } as CSSProperties) : undefined;
  const copias = larg ? reps * 2 : 1;
  return (
    <div className="tv-ticker">
      <span className="lab">{rotulo}</span>
      <div className={`tv-letreiro${larg ? ' anda' : ''}`} ref={caixa}>
        <div className="tv-letreiro-in" style={estilo}>
          {Array.from({ length: copias }, (_, k) => (
            <div key={k} className="tv-letreiro-trilho" ref={k === 0 ? trilho : undefined} aria-hidden={k > 0 || undefined}>
              {itens.map((t, j) => <span key={j}>{t}</span>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TVView({ sair, rotuloSair = 'Sair da TV' }: { sair?: () => void; rotuloSair?: string }) {
  const { e, agenda } = useApp();
  const agora = useRelogio(1000);
  const fer = e.config.feriados;
  const turno = situacaoTurno(agora, fer);

  // mantém a tela ligada enquanto a TV estiver aberta
  useEffect(() => {
    let lock: any = null;
    const pedir = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen');
      } catch {
        /* não suportado */
      }
    };
    pedir();
    const vis = () => document.visibilityState === 'visible' && pedir();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      lock?.release?.().catch?.(() => {});
    };
  }, []);

  const emProd = e.ops.filter((o) => o.status === 'producao').sort((a, b) => a.inicio!.localeCompare(b.inicio!));
  const fila = filaOrdenada(e);
  const hoje = e.ops.filter((o) => o.status === 'concluida' && o.fim && mesmoDia(new Date(o.fim), agora)).sort((a, b) => b.fim!.localeCompare(a.fim!));
  const liberadosHoje = e.pedidos.filter((p) => p.prontoEm && !p.expedidoEm && mesmoDia(new Date(p.prontoEm), agora));
  const aguardandoExp = e.pedidos.filter((p) => p.prontoEm && !p.expedidoEm);
  const volHoje = hoje.reduce((s, o) => s + o.lote, 0);
  const atrasadas = emProd.filter((o) => expedienteEntre(new Date(o.inicio!), agora, fer) > o.tempoPadraoMin).length;

  const turnoTxt = turno === 'producao' ? 'Em expediente' : turno === 'almoco' ? 'Almoço · volta 13:12' : 'Fora do expediente';
  const tela = () => {
    const el = document.documentElement as any;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="tv" role="region" aria-label="Painel da produção">
      <header className="tv-head">
        <img src={logo} alt="Duramax Tintas e Vernizes" />
        <div className="ttl">PRODUÇÃO</div>
        <div className="tv-stats">
          <div><b>{emProd.length}</b><span>produzindo</span></div>
          <div><b>{fila.length}</b><span>na fila</span></div>
          <div><b style={{ color: 'var(--tv-ok)' }}>{fmtVol(volHoje)}</b><span>prontos hoje</span></div>
          {atrasadas > 0 && <div><b style={{ color: 'var(--tv-late)' }}>{atrasadas}</b><span>acima do tempo</span></div>}
        </div>
        <div className="clk">
          <b>{hora(agora)}</b>
          <span>
            {diaSemanaLongo(agora)}, {dataCurta(agora)} · <span style={{ display: 'inline', color: turno === 'producao' ? 'var(--tv-ok)' : 'var(--tv-warn)' }}>{turnoTxt}</span>
          </span>
        </div>
      </header>

      <div className="tv-cols">
        <section className="tv-col">
          <h2><i style={{ background: 'var(--tv-run)' }} />EM PRODUÇÃO<span className="n">{emProd.length}</span></h2>
          <Rolagem>
          {emProd.map((o) => {
            const dec = expedienteEntre(new Date(o.inicio!), agora, fer);
            const late = dec > o.tempoPadraoMin;
            const peds = o.alocacoes.map((a) => e.pedidos.find((p) => p.id === a.pedidoId)).filter(Boolean);
            return (
              <div key={o.id} className={`tv-run${late ? ' late' : ''}`}>
                <div className="r1">
                  <span className="op">OP {o.numero}</span>
                  <span>{fmtVol(o.lote)}</span>
                  <span className="sp">{peds.map((p) => `#${p!.numero}`).join('  ')}</span>
                </div>
                <div className="pn">{nomeOP(e, o)}</div>
                <div className="r3">
                  <b>{fmtDur(dec)}</b>
                  <span>de {fmtDur(o.tempoPadraoMin)}</span>
                  {late ? <span className="lt">+{fmtDur(dec - o.tempoPadraoMin)} ACIMA</span> : <span style={{ marginLeft: 'auto' }}>faltam {fmtDur(o.tempoPadraoMin - dec)}</span>}
                </div>
                <div className="tv-bar"><i style={{ width: `${Math.min(100, (dec / o.tempoPadraoMin) * 100)}%` }} /></div>
              </div>
            );
          })}
          {!emProd.length && <div className="tv-empty">Nenhuma OP em produção. Próxima: {fila[0] ? nomeOP(e, fila[0]) : '—'}</div>}
          </Rolagem>
        </section>

        <section className="tv-col">
          <h2><i style={{ background: 'var(--tv-warn)' }} />PRÓXIMAS<span className="n">{fila.length}</span></h2>
          <Rolagem>
          {fila.map((o, i) => {
            const pv = agenda.ops.get(o.id);
            const peds = o.alocacoes.map((a) => e.pedidos.find((p) => p.id === a.pedidoId)).filter(Boolean);
            return (
              <div key={o.id} className={`tv-next${i === 0 ? ' first' : ''}`}>
                <span className="k">{i + 1}</span>
                <span className="pn">{nomeOP(e, o)}</span>
                <span className="vol">{fmtVol(o.lote)}</span>
                <span className="sub">OP {o.numero} · {peds.map((p) => `#${p!.numero}`).join(' ')}</span>
                <span className="at">{pv ? quando(pv.inicio, agora) : ''}</span>
              </div>
            );
          })}
          {!fila.length && <div className="tv-empty">Fila vazia.</div>}
          </Rolagem>
        </section>

        <section className="tv-col">
          <h2><i style={{ background: 'var(--tv-ok)' }} />PRONTAS HOJE<span className="n">{hoje.length}</span></h2>
          <Rolagem>
          {hoje.map((o) => (
            <div key={o.id} className="tv-done">
              <Icon n="check" s={24} w={3} />
              <span className="pn">{nomeOP(e, o)}<small>OP {o.numero} · {fmtVol(o.lote)}</small></span>
              <span className="h">{hora(new Date(o.fim!))}</span>
            </div>
          ))}
          {!hoje.length && <div className="tv-empty">Nada concluído hoje ainda.</div>}
          </Rolagem>
          <div className="tv-sub">PEDIDOS LIBERADOS P/ EXPEDIÇÃO · {aguardandoExp.length}</div>
          <Rolagem pxPorSeg={22}>
          {aguardandoExp.map((p) => (
            <div key={p.id} className="tv-ped">
              <b>#{p.numero} {titulo(p.fantasia)}</b>
              <span>{titulo(p.cidade)}/{p.uf}</span>
            </div>
          ))}
          {!aguardandoExp.length && <div className="tv-empty">Nenhum pedido esperando expedição.</div>}
          </Rolagem>
        </section>
      </div>

      {liberadosHoje.length > 0 && (
        <Letreiro rotulo="LIBERADOS HOJE" itens={liberadosHoje.map((p) => `#${p.numero} ${titulo(p.fantasia)} → ${titulo(p.transportadora).split(' ')[0]}`)} />
      )}

      <div className="tv-exit">
        <button onClick={tela}><Icon n="expand" s={13} /> Tela cheia</button>
        {sair && <button onClick={sair}>{rotuloSair}</button>}
      </div>
    </div>
  );
}
