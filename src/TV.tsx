import { useEffect } from 'react';
import { useApp, useRelogio } from './store';
import { Icon, nomeOP } from './ui';
import { filaOrdenada } from '../shared/engine';
import { expedienteEntre, situacaoTurno } from '../shared/calendar';
import { dataCurta, diaSemanaLongo, fmtDur, fmtVol, hora, mesmoDia, quando, titulo } from '../shared/fmt';
const logo = '/logo-h-white.png';


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
        </section>

        <section className="tv-col">
          <h2><i style={{ background: 'var(--tv-warn)' }} />PRÓXIMAS<span className="n">{fila.length}</span></h2>
          {fila.slice(0, 7).map((o, i) => {
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
          {fila.length > 7 && <div className="tv-empty">+ {fila.length - 7} na fila</div>}
          {!fila.length && <div className="tv-empty">Fila vazia.</div>}
        </section>

        <section className="tv-col">
          <h2><i style={{ background: 'var(--tv-ok)' }} />PRONTAS HOJE<span className="n">{hoje.length}</span></h2>
          {hoje.slice(0, 6).map((o) => (
            <div key={o.id} className="tv-done">
              <Icon n="check" s={24} w={3} />
              <span className="pn">{nomeOP(e, o)}<small>OP {o.numero} · {fmtVol(o.lote)}</small></span>
              <span className="h">{hora(new Date(o.fim!))}</span>
            </div>
          ))}
          {!hoje.length && <div className="tv-empty">Nada concluído hoje ainda.</div>}
          <div className="tv-sub">PEDIDOS LIBERADOS P/ EXPEDIÇÃO · {aguardandoExp.length}</div>
          {aguardandoExp.slice(0, 5).map((p) => (
            <div key={p.id} className="tv-ped">
              #{p.numero} {titulo(p.fantasia).slice(0, 22)}
              <span>{titulo(p.cidade)}/{p.uf}</span>
            </div>
          ))}
        </section>
      </div>

      {liberadosHoje.length > 0 && (
        <div className="tv-ticker">
          <span className="lab">LIBERADOS HOJE</span>
          {liberadosHoje.map((p) => (
            <span key={p.id}>#{p.numero} {titulo(p.fantasia)} → {titulo(p.transportadora).split(' ')[0]}</span>
          ))}
        </div>
      )}

      <div className="tv-exit">
        <button onClick={tela}><Icon n="expand" s={13} /> Tela cheia</button>
        {sair && <button onClick={sair}>{rotuloSair}</button>}
      </div>
    </div>
  );
}
