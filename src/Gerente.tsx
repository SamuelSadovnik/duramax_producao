import { useState } from 'react';
import { useApp, useRelogio } from './store';
import { Icon, Modal, Vazio, nomeOP } from './ui';
import { filaOrdenada, MOTIVOS, opsDoPedido } from '../shared/engine';
import { paraInputLocal, deInputLocal } from '../shared/tz';
import { api } from './api';
import { pode } from './store';
import { expedienteEntre, situacaoTurno } from '../shared/calendar';
import { fmtDur, fmtVol, hora, mesmoDia, quando, titulo } from '../shared/fmt';
import type { Estado, OP, Pedido } from '../shared/types';

type Acao = { tipo: 'iniciar' | 'finalizar'; op: OP } | null;
type Aba = 'prod' | 'fila' | 'prontas';

const paraInput = paraInputLocal;

/** Pedidos que ficam completos quando esta OP terminar. */
function liberaAoTerminar(e: Estado, op: OP): Pedido[] {
  return op.alocacoes
    .map((a) => e.pedidos.find((p) => p.id === a.pedidoId))
    .filter((p): p is Pedido => !!p && !p.prontoEm && !!p.pcpEm)
    .filter((p) => opsDoPedido(e, p.id).every((o) => o.id === op.id || o.status === 'concluida'));
}

const pedidosDa = (e: Estado, op: OP) =>
  op.alocacoes.map((a) => e.pedidos.find((p) => p.id === a.pedidoId)).filter(Boolean) as Pedido[];

export function GerenteView() {
  const { e, agenda } = useApp();
  const agora = useRelogio(5000);
  const [acao, setAcao] = useState<Acao>(null);
  const [aba, setAba] = useState<Aba>('prod');
  const fer = e.config.feriados;
  const turno = situacaoTurno(agora, fer);

  const emProd = e.ops.filter((o) => o.status === 'producao').sort((a, b) => a.inicio!.localeCompare(b.inicio!));
  const fila = filaOrdenada(e);
  const hoje = e.ops
    .filter((o) => o.status === 'concluida' && o.fim && mesmoDia(new Date(o.fim), agora))
    .sort((a, b) => b.fim!.localeCompare(a.fim!));
  const decorrido = (o: OP) => expedienteEntre(new Date(o.inicio!), agora, fer);
  const acima = emProd.filter((o) => decorrido(o) > o.tempoPadraoMin).length;
  const volHoje = hoje.reduce((s, o) => s + o.lote, 0);
  const produtosNoTanque = new Set(emProd.map((o) => o.produtoId));

  return (
    <main className="page floor2">
      <div className="fl-top">
        <div className="fl-clock">
          <b className="num">{hora(agora)}</b>
          <span className={`turno-pill ${turno}`}>
            <i />
            {turno === 'producao' ? 'Em expediente' : turno === 'almoco' ? 'Almoço até 13:12' : 'Fora do expediente'}
          </span>
        </div>
        <div className="fl-stats">
          <button className={`fl-stat${aba === 'prod' ? ' on' : ''}`} onClick={() => setAba('prod')}>
            <b className="num">{emProd.length}</b><span>produzindo</span>
          </button>
          <button className={`fl-stat${aba === 'fila' ? ' on' : ''}`} onClick={() => setAba('fila')}>
            <b className="num">{fila.length}</b><span>na fila</span>
          </button>
          <button className={`fl-stat${aba === 'prontas' ? ' on' : ''}`} onClick={() => setAba('prontas')}>
            <b className="num">{hoje.length}</b><span>prontas hoje · {fmtVol(volHoje)}</span>
          </button>
          <div className={`fl-stat${acima ? ' bad' : ''}`}>
            <b className="num">{acima}</b><span>acima do tempo</span>
          </div>
        </div>
      </div>

      <div className="fl-grid">
        <section className={`fl-col fl-prod${aba === 'prod' ? ' show' : ''}`} aria-label="Produzindo agora">
          <h2 className="fl-h">Produzindo agora</h2>
          {emProd.map((o) => {
            const dec = decorrido(o);
            const late = dec > o.tempoPadraoMin;
            const libera = liberaAoTerminar(e, o);
            return (
              <article key={o.id} className={`run-tile${late ? ' late' : ''}`}>
                <Anel dec={dec} padrao={o.tempoPadraoMin} />
                <div className="run-body">
                  <div className="run-r1">
                    <span className="mono">OP {o.numero}</span>
                    <span>{fmtVol(o.lote)}</span>
                    <span>início {quando(new Date(o.inicio!), agora)}</span>
                  </div>
                  <div className="run-prod">{nomeOP(e, o)}</div>
                  <div className="run-r3">
                    {late ? (
                      <span className="chip crit"><Icon n="alert" s={13} /> {fmtDur(dec - o.tempoPadraoMin)} acima do padrão de {fmtDur(o.tempoPadraoMin)}</span>
                    ) : (
                      <span className="chip info"><Icon n="clock" s={13} /> faltam {fmtDur(o.tempoPadraoMin - dec)} · padrão {fmtDur(o.tempoPadraoMin)}</span>
                    )}
                    {libera.map((p) => (
                      <span key={p.id} className="chip ok"><Icon n="truck" s={13} /> libera #{p.numero} ao terminar</span>
                    ))}
                  </div>
                  <div className="run-peds">Pedidos: {pedidosDa(e, o).map((p) => `#${p.numero} ${titulo(p.fantasia)}`).join(' · ')}</div>
                </div>
                <button className="fl-btn ok" onClick={() => setAcao({ tipo: 'finalizar', op: o })}>
                  <Icon n="check" s={22} w={2.8} />
                  <span>Finalizar</span>
                </button>
              </article>
            );
          })}
          {!emProd.length && (
            <div className="fl-caixa">
              <Vazio icone="fabrica" titulo="Nada em produção">
                {fila[0] ? <>Próxima da fila: <b style={{ fontSize: 13 }}>{nomeOP(e, fila[0])}</b></> : 'A fila está vazia.'}
              </Vazio>
            </div>
          )}

        </section>

        <section className={`fl-col fl-done${aba === 'prontas' ? ' show' : ''}`} aria-label="Prontas hoje">
          <h2 className="fl-h">Prontas hoje</h2>
          {hoje.length > 0 ? (
          <div className="done-list">
            {hoje.map((o) => {
              const real = o.realMin ?? 0;
              const ruim = real > o.tempoPadraoMin * (1 + e.config.toleranciaPct / 100);
              return (
                <div key={o.id} className="done-row">
                  <span className="done-ic"><Icon n="check" s={16} w={3} /></span>
                  <div className="done-txt">
                    <b>{nomeOP(e, o)}</b>
                    <span>OP {o.numero} · {fmtVol(o.lote)} · terminou {hora(new Date(o.fim!))}{o.motivo ? ` · ${o.motivo}` : ''}</span>
                  </div>
                  <span className={`chip ${ruim ? 'crit' : 'ok'}`}>{fmtDur(real)} de {fmtDur(o.tempoPadraoMin)}</span>
                  <BotaoReabrir op={o} />
                </div>
              );
            })}
          </div>
          ) : (
            <div className="fl-caixa"><Vazio compacto icone="check" titulo="Nenhuma OP concluída hoje" /></div>
          )}
        </section>

        <section className={`fl-col fl-fila${aba === 'fila' ? ' show' : ''}`} aria-label="Fila">
          <h2 className="fl-h">Fila <span className="muted">na ordem de prioridade</span></h2>
          <div className="q2">
            {fila.map((o, i) => {
              const pv = agenda.ops.get(o.id);
              const peds = pedidosDa(e, o);
              const libera = liberaAoTerminar(e, o);
              const mesmo = produtosNoTanque.has(o.produtoId);
              return (
                <div key={o.id} className={`q2-row${i === 0 ? ' first' : ''}`}>
                  <span className="q2-n num">{i + 1}</span>
                  <div className="q2-txt">
                    <b>{nomeOP(e, o)}</b>
                    <span>
                      OP {o.numero} · {fmtVol(o.lote)} · {fmtDur(o.tempoPadraoMin)} · {peds.map((p) => `#${p.numero}`).join(' ')}
                    </span>
                    <div className="q2-chips">
                      {i === 0 && <span className="chip warn">próxima</span>}
                      {mesmo && <span className="chip info">mesmo produto em andamento</span>}
                      {libera.map((p) => <span key={p.id} className="chip ok">fecha o pedido #{p.numero}</span>)}
                      {pv && <span className="chip">prev. {quando(pv.inicio, agora)}</span>}
                    </div>
                  </div>
                  <button className={`fl-btn ${i === 0 ? 'pri' : 'sec'}`} onClick={() => setAcao({ tipo: 'iniciar', op: o })}>
                    <Icon n="play" s={18} />
                    <span>Iniciar</span>
                  </button>
                </div>
              );
            })}
            {!fila.length && <div className="fl-caixa"><Vazio icone="fila" titulo="Fila vazia">Nenhuma OP aguardando. Quando o PCP liberar um pedido, as OPs aparecem aqui.</Vazio></div>}
          </div>
        </section>
      </div>
      {acao && <Confirmar acao={acao} onClose={() => setAcao(null)} />}
    </main>
  );
}

function Anel({ dec, padrao }: { dec: number; padrao: number }) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const late = dec > padrao;
  const p = Math.min(1, dec / padrao);
  return (
    <div className={`ring${late ? ' late' : ''}`} aria-label={`${fmtDur(dec)} de ${fmtDur(padrao)}`}>
      <svg viewBox="0 0 108 108" width="108" height="108" aria-hidden="true">
        <circle cx="54" cy="54" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
        <circle
          cx="54"
          cy="54"
          r={R}
          fill="none"
          stroke={late ? 'var(--crit)' : 'var(--info)'}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${C * p} ${C}`}
          transform="rotate(-90 54 54)"
        />
      </svg>
      <div className="ring-txt">
        <b className="num">{fmtDur(dec)}</b>
        <span>{Math.round((dec / padrao) * 100)}%</span>
      </div>
    </div>
  );
}

function BotaoReabrir({ op }: { op: OP }) {
  const { executar, perfil } = useApp();
  if (!pode.operarOP(perfil)) return null;
  return (
    <button
      className="btn ghost icon"
      title="Desfazer conclusão (volta para produzindo)"
      aria-label={`Desfazer conclusão da OP ${op.numero}`}
      onClick={() => executar(() => api.op(op.id, 'reabrir'), { texto: `OP ${op.numero} voltou para produzindo.` })}
    >
      <Icon n="undo" s={16} />
    </button>
  );
}

function Confirmar({ acao, onClose }: { acao: NonNullable<Acao>; onClose: () => void }) {
  const { e, executar, toast } = useApp();
  const op = acao.op;
  const [enviando, setEnviando] = useState(false);
  const agora = new Date();
  const [quandoStr, setQuando] = useState(paraInput(agora));
  const [inicioStr, setInicio] = useState(op.inicio ? paraInput(new Date(op.inicio)) : '');
  const [corrigir, setCorrigir] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [obs, setObs] = useState('');
  const fer = e.config.feriados;
  const quandoD = corrigir ? deInputLocal(quandoStr) : agora;
  const inicioD = inicioStr ? deInputLocal(inicioStr) : null;
  const real = acao.tipo === 'finalizar' && inicioD ? expedienteEntre(inicioD, quandoD, fer) : 0;
  const limite = op.tempoPadraoMin * (1 + e.config.toleranciaPct / 100);
  const precisaMotivo = acao.tipo === 'finalizar' && real > limite;
  const invalido = isNaN(quandoD.getTime()) || (acao.tipo === 'finalizar' && (!inicioD || quandoD <= inicioD)) || quandoD > new Date(Date.now() + 60_000);
  const nome = nomeOP(e, op);
  const libera = acao.tipo === 'finalizar' ? liberaAoTerminar(e, op) : [];

  const ok = async () => {
    setEnviando(true);
    const antes = e;
    let liberados: Pedido[] = [];
    const feito = await executar(
      async () => {
        const r = await api.op(op.id, acao.tipo, {
          quando: corrigir ? quandoD.toISOString() : undefined,
          inicio: corrigir && acao.tipo === 'finalizar' && inicioD ? inicioD.toISOString() : undefined,
          motivo: motivo ?? undefined,
          obs: obs.trim() || undefined,
        });
        liberados = r.estado.pedidos.filter((p) => p.prontoEm && !antes.pedidos.find((q) => q.id === p.id)?.prontoEm);
        return r;
      },
      {
        texto:
          acao.tipo === 'iniciar'
            ? `OP ${op.numero} iniciada às ${hora(quandoD)}.`
            : `OP ${op.numero} concluída.`,
        tipo: 'ok',
        desfazer: () => executar(() => api.op(op.id, acao.tipo === 'iniciar' ? 'voltar' : 'reabrir'), 'Desfeito.'),
      },
    );
    setEnviando(false);
    if (feito) {
      onClose();
      if (liberados.length) setTimeout(() => toastLib(liberados), 50);
    }
  };
  const toastLib = (ls: Pedido[]) => toast({ texto: `Pedido ${ls.map((p) => `#${p.numero}`).join(', ')} liberado para expedição.`, tipo: 'ok' });

  return (
    <Modal onClose={onClose} label={acao.tipo === 'iniciar' ? 'Iniciar OP' : 'Finalizar OP'}>
      <div className="modal-topo"><div>
        <div className="eyebrow">{acao.tipo === 'iniciar' ? 'Iniciar produção' : 'Finalizar produção'} · OP {op.numero}</div>
        <h2 style={{ fontSize: 22, marginTop: 4 }}>{nome}</h2>
        <div className="fg2" style={{ marginTop: 4 }}>Lote {fmtVol(op.lote)} · tempo padrão {fmtDur(op.tempoPadraoMin)}</div>
      </div></div>

      {acao.tipo === 'finalizar' && (
        <div className="big-stat">
          <div><b style={{ color: precisaMotivo ? 'var(--crit)' : 'var(--ok)' }}>{fmtDur(real)}</b><span>tempo real (expediente)</span></div>
          <div><b>{real > op.tempoPadraoMin ? '+' : ''}{fmtDur(real - op.tempoPadraoMin)}</b><span>em relação ao padrão</span></div>
        </div>
      )}
      {libera.length > 0 && (
        <div className="aviso ok">
          <Icon n="truck" s={14} /> <span>Ao confirmar, o pedido {libera.map((p) => `#${p.numero} (${titulo(p.fantasia)})`).join(', ')} vai para a expedição.</span>
        </div>
      )}

      {corrigir ? (
        <div className="time-fix">
          {acao.tipo === 'finalizar' && (
            <label>Início <input id="corr-inicio" type="datetime-local" value={inicioStr} onChange={(ev) => setInicio(ev.target.value)} /></label>
          )}
          <label>{acao.tipo === 'iniciar' ? 'Início' : 'Término'} <input id="corr-fim" type="datetime-local" value={quandoStr} onChange={(ev) => setQuando(ev.target.value)} /></label>
        </div>
      ) : (
        <div className="fg2" style={{ fontSize: 13.5 }}>
          {acao.tipo === 'iniciar' ? 'Início' : 'Término'} registrado agora, às <b>{hora(quandoD)}</b>.{' '}
          <button className="btn ghost sm" onClick={() => setCorrigir(true)}>Corrigir horário</button>
        </div>
      )}

      {precisaMotivo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 650 }}>Passou {fmtDur(real - op.tempoPadraoMin)} do padrão. O que aconteceu?</div>
          <div className="sheet-chips" role="group" aria-label="Motivo do atraso">
            {MOTIVOS.map((m) => (
              <button key={m} aria-pressed={motivo === m} onClick={() => setMotivo(m)}>{m}</button>
            ))}
          </div>
          <textarea id="obs-atraso" className="input" rows={2} placeholder="Observação (opcional)" value={obs} onChange={(ev) => setObs(ev.target.value)} />
        </div>
      )}
      {invalido && <div className="aviso crit"><Icon n="alert" s={14} /> <span>Confira os horários: o término precisa ser depois do início e não pode estar no futuro.</span></div>}

      <div className="modal-acts">
        <button className="btn lg" style={{ minHeight: 52 }} onClick={onClose}>Cancelar</button>
        <button
          className={`btn lg ${acao.tipo === 'iniciar' ? 'pri' : 'ok'}`}
          style={{ minHeight: 52, minWidth: 200, fontSize: 16 }}
          disabled={invalido || enviando || (precisaMotivo && !motivo)}
          onClick={ok}
        >
          {acao.tipo === 'iniciar' ? <><Icon n="play" s={16} /> Confirmar início</> : <><Icon n="check" s={18} w={2.6} /> Confirmar término</>}
        </button>
      </div>
    </Modal>
  );
}
