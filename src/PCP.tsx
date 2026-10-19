import { useEffect, useMemo, useState } from 'react';
import { useApp } from './store';
import { Icon, PrazoChip } from './ui';
import { calcularAgenda, liberarPedido, planejar, situacaoPrazo, statusPedido, volumePedido } from '../shared/engine';
import { fmtDur, fmtVol, nf, quando, titulo } from '../shared/fmt';
import type { Decisao, Pedido } from '../shared/types';
import { nomeLinha } from '../shared/catalog';
import { api } from './api';
import { pode } from './store';

export function PCPView() {
  const { e, executar, abrirPedido, perfil, agora, toast } = useApp();
  const pend = useMemo(() => {
    const pos = new Map(e.prioridade.map((id, i) => [id, i]));
    return e.pedidos.filter((p) => statusPedido(e, p) === 'pcp').sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  }, [e]);
  const [selId, setSel] = useState<string | null>(pend[0]?.id ?? null);
  useEffect(() => {
    if (!pend.find((p) => p.id === selId)) setSel(pend[0]?.id ?? null);
  }, [pend, selId]);
  const sel = pend.find((p) => p.id === selId);
  const somenteVer = !pode.decidirPCP(perfil);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Análise do PCP</h1>
          <p>Para cada item, decida se sai do estoque ou se vira OP. O sistema agrupa as embalagens do mesmo produto em lotes e aproveita OPs que ainda não começaram.</p>
        </div>
      </div>
      {!pend.length ? (
        <div className="panel empty">
          <b>Nenhum pedido aguardando análise</b>
          Quando o comercial importar um PDF, ele aparece aqui.
        </div>
      ) : (
        <div className="pcp">
          <div className="pcp-list">
            <div className="eyebrow" style={{ padding: '0 2px' }}>{pend.length} aguardando</div>
            {pend.map((p) => (
              <button key={p.id} className={`pcard${p.id === selId ? ' sel' : ''}`} onClick={() => setSel(p.id)}>
                <div className="pcard-top">
                  <span className="nped">#{p.numero}</span>
                  
                  <span className="sp muted num" style={{ fontSize: 12 }}>{fmtVol(volumePedido(p))}</span>
                </div>
                <div className="cli">{titulo(p.fantasia)}</div>
                <div className="meta">
                  <span>{p.itens.length} itens</span>
                  <span>chegou {quando(new Date(p.importadoEm), agora)}</span>
                </div>
                <div className="est"><PrazoChip p={p} /></div>
              </button>
            ))}
          </div>
          {sel && (
            <Analise
              key={sel.id}
              p={sel}
              somenteVer={somenteVer}
              onLiberar={async () => {
                const antes = e.ops.length;
                let n = 0;
                const ok = await executar(async () => {
                  const r = await api.liberar(sel.id);
                  n = r.estado.ops.length - antes;
                  return r;
                });
                if (ok) toast({ texto: `Pedido #${sel.numero} liberado: ${n} OP(s) nova(s) enviadas para a produção.`, tipo: 'ok' });
              }}
              abrir={() => abrirPedido(sel.id)}
            />
          )}
        </div>
      )}
    </main>
  );
}

function Analise({ p, onLiberar, somenteVer, abrir }: { p: Pedido; onLiberar: () => Promise<void>; somenteVer: boolean; abrir: () => void }) {
  const { e, executar, agora } = useApp();
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState<Record<string, boolean>>({});

  const grupos = useMemo(() => {
    const m = new Map<string, Pedido['itens']>();
    for (const i of p.itens) m.set(i.produtoId, [...(m.get(i.produtoId) ?? []), i]);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [p]);

  const decidir = async (ids: string[], d: Decisao) => {
    setOcupado(true);
    await executar(() => api.decidir(p.id, ids, d));
    setOcupado(false);
  };
  const liberar = async () => {
    setOcupado(true);
    await onLiberar();
    setOcupado(false);
  };

  const plano = useMemo(() => planejar(e, p), [e, p]);
  const pendentes = p.itens.filter((i) => i.decisao === 'pendente').length;
  const novasOps = plano.reduce((s, l) => s + l.novas.length, 0);
  const tempo = plano.reduce((s, l) => s + l.tempoMin, 0);
  const sobra = plano.reduce((s, l) => s + l.sobra, 0);
  const volOP = plano.reduce((s, l) => s + l.necessidade, 0);
  const volEst = p.itens.filter((i) => i.decisao === 'estoque').reduce((s, i) => s + i.volume, 0);

  // simulação: como ficaria se liberasse agora
  const simul = useMemo(() => {
    if (pendentes) return null;
    const e2 = liberarPedido(e, p.id, agora);
    const ag = calcularAgenda(e2, agora);
    const fim = ag.pedidos.get(p.id);
    const pp = e2.pedidos.find((x) => x.id === p.id)!;
    return { fim, prazo: situacaoPrazo(e2, pp, fim, agora) };
  }, [e, p, agora, pendentes]);

  const todos = p.itens.map((i) => i.id);
  const linhas = [...new Set(grupos.map(([pid]) => pid.split('.')[0]))];

  return (
    <>
      <div className="panel" style={{ padding: 0, minWidth: 0 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="mono" style={{ fontWeight: 600 }}>#{p.numero}</span>
              <button className="btn ghost sm" onClick={abrir}>Ver pedido</button>
            </div>
            <b style={{ fontSize: 17 }}>{titulo(p.fantasia)}</b>
            <div className="muted" style={{ fontSize: 12.5 }}>{grupos.length} produtos · {p.itens.length} itens · {fmtVol(volumePedido(p))}</div>
          </div>
          {!somenteVer && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => decidir(todos, 'estoque')}>Tudo do estoque</button>
              <button className="btn sm" onClick={() => decidir(todos, 'op')}>Tudo vira OP</button>
            </div>
          )}
        </div>
        <div style={{ padding: '4px 12px 8px' }}>
          {linhas.map((ln) => (
            <div key={ln}>
              <div className="eyebrow" style={{ padding: '14px 4px 4px' }}>{nomeLinha(ln)}</div>
              {grupos
                .filter(([pid]) => pid.split('.')[0] === ln)
                .map(([pid, its]) => {
                  const prod = e.produtos[pid];
                  const vol = its.reduce((s, i) => s + i.volume, 0);
                  const decs = new Set(its.map((i) => i.decisao));
                  const g: Decisao | 'misto' = decs.size === 1 ? [...decs][0] : 'misto';
                  const ids = its.map((i) => i.id);
                  const exp = aberto[pid] ?? g === 'misto';
                  return (
                    <div className="grp" key={pid}>
                      <div className="grp-head">
                        <div className="nm">
                          {prod?.nome ?? pid}
                          <small>
                            <span className="mono">{pid}</span> · {its.map((i) => `${nf(i.qtde)}×${nf(i.embalagem, 1)}L`).join(' · ')}
                            {prod?.pendente && <span className="chip warn" style={{ marginLeft: 6 }}>produto novo</span>}
                          </small>
                        </div>
                        <b className="num" style={{ minWidth: 70, textAlign: 'right' }}>{fmtVol(vol)}</b>
                        <div className="dec" role="group" aria-label={`Decisão para ${prod?.nome}`}>
                          <button className="on-est" aria-pressed={g === 'estoque'} disabled={somenteVer} onClick={() => decidir(ids, 'estoque')}>Estoque</button>
                          <button className="on-op" aria-pressed={g === 'op'} disabled={somenteVer} onClick={() => decidir(ids, 'op')}>Produzir</button>
                        </div>
                        <span className="grp-tog">
                          {its.length > 1 && (
                            <button className="btn ghost sm" onClick={() => setAberto((x) => ({ ...x, [pid]: !exp }))} aria-expanded={exp}>
                              {g === 'misto' ? 'Misto · ' : ''}{exp ? 'Ocultar' : 'Por embalagem'}
                            </button>
                          )}
                          {its.length === 1 && g === 'pendente' && <span className="chip warn">decidir</span>}
                        </span>
                      </div>
                      {exp && (
                        <div className="grp-items">
                          {its.map((i) => (
                            <div className="grp-item" key={i.id}>
                              <span className="mono muted">{i.codigo}</span>
                              <span className="hide-sm" style={{ minWidth: 0 }}>{i.codFab}</span>
                              <span className="num">{nf(i.qtde)} × {nf(i.embalagem, 1)} L</span>
                              <span className="num hide-sm" style={{ textAlign: 'right' }}>{fmtVol(i.volume)}</span>
                              <div className="dec">
                                <button className="on-est" aria-pressed={i.decisao === 'estoque'} disabled={somenteVer} onClick={() => decidir([i.id], 'estoque')}>Estoque</button>
                                <button className="on-op" aria-pressed={i.decisao === 'op'} disabled={somenteVer} onClick={() => decidir([i.id], 'op')}>Produzir</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>

      <aside className="plan">
        <div className="panel">
          <div className="panel-head"><h2>Plano de produção</h2></div>
          <div className="big-stat">
            <div><b>{novasOps}</b><span>OPs novas</span></div>
            <div><b>{fmtDur(tempo)}</b><span>de produção</span></div>
            <div><b>{fmtVol(volOP)}</b><span>a produzir</span></div>
            <div><b>{fmtVol(volEst)}</b><span>do estoque</span></div>
          </div>
          <div style={{ marginTop: 14, padding: '12px', borderRadius: 8, background: 'var(--surface-2)' }}>
            {pendentes ? (
              <span className="fg2" style={{ fontSize: 13 }}>
                Faltam <b>{pendentes}</b> {pendentes === 1 ? 'item' : 'itens'} para decidir. A estimativa aparece quando todos estiverem definidos.
              </span>
            ) : simul ? (
              <>
                <div className="eyebrow">Se liberar agora, fica pronto</div>
                <div style={{ fontSize: 22, fontStretch: '78%', fontWeight: 750 }} className="num">{simul.fim ? quando(simul.fim, agora) : 'imediatamente (tudo em estoque)'}</div>
                {simul.prazo.tipo !== 'sem' && (
                  <span className={`chip ${simul.prazo.tipo === 'ok' ? 'ok' : simul.prazo.tipo === 'risco' ? 'warn' : 'crit'}`} style={{ marginTop: 6 }}>{simul.prazo.texto}</span>
                )}
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Na posição atual da fila. Mude a prioridade em Fila e previsão.</div>
              </>
            ) : null}
          </div>
          {!somenteVer && (
            <button className="btn pri" style={{ width: '100%', marginTop: 12, minHeight: 42 }} disabled={pendentes > 0 || ocupado} onClick={liberar}>
              <Icon n="check" s={16} w={2.4} /> Liberar para produção
            </button>
          )}
          {somenteVer && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Somente o PCP libera pedidos para produção.</div>}
        </div>

        {plano.length > 0 && (
          <div className="panel">
            <div className="panel-head"><h2>Lotes</h2><span className="sp muted" style={{ fontSize: 12 }}>{plano.length} produto(s)</span></div>
            {plano.map((l) => {
              const prod = e.produtos[l.produtoId];
              return (
                <div className="plan-row" key={l.produtoId}>
                  <span className="nm">{prod?.nome ?? l.produtoId}</span>
                  <div className="ln">
                    <span className="num">{fmtVol(l.necessidade)}</span>
                    <span className="muted">· lote {fmtVol(prod?.lote ?? 0)} · {fmtDur(prod?.tempoMin ?? 0)}/lote</span>
                  </div>
                  <div className="ln">
                    {l.aproveita.map((a) => (
                      <span key={a.opId} className="chip ok" title="OP ainda não iniciada com volume livre">
                        <Icon n="bolt" s={11} /> aproveita OP {a.numero} ({fmtVol(a.volume)})
                      </span>
                    ))}
                    {l.novas.length > 0 && <span className="chip info">{l.novas.length} OP{l.novas.length > 1 ? 's' : ''} nova{l.novas.length > 1 ? 's' : ''}</span>}
                    {l.sobra > 0.5 && <span className="chip">sobra {fmtVol(l.sobra)} p/ estoque</span>}
                  </div>
                </div>
              );
            })}
            {sobra > 0 && <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>A sobra dos lotes fica livre para o próximo pedido do mesmo produto enquanto a OP não começar.</div>}
          </div>
        )}
      </aside>
    </>
  );
}
