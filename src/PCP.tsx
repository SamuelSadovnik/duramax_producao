import { useEffect, useMemo, useState } from 'react';
import { pode, useApp } from './store';
import { Icon, PrazoChip } from './ui';
import { calcularAgenda, liberarPedido, planejar, prazoDoPedido, produtosSemParametro, situacaoPrazo, statusPedido, temParametros, volumePedido, type LinhaPlano } from '../shared/engine';
import { CamposParam } from './ParamProduto';
import { dataISOparaBR, fmtDur, fmtVol, nf, quando, titulo } from '../shared/fmt';
import type { Decisao, Pedido } from '../shared/types';
import { nomeLinha } from '../shared/catalog';
import { api } from './api';

type Ordem = 'prazo' | 'chegada' | 'volume';

export function PCPView() {
  const { e, executar, abrirPedido, perfil, toast } = useApp();
  const [q, setQ] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('prazo');
  const pend = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const lista = e.pedidos
      .filter((p) => statusPedido(e, p) === 'pcp')
      .filter((p) => !ql || `${p.numero} ${p.fantasia} ${p.cliente} ${p.cidade}`.toLowerCase().includes(ql));
    const prazo = (p: Pedido) => prazoDoPedido(e, p);
    return lista.sort((a, b) =>
      ordem === 'volume'
        ? volumePedido(b) - volumePedido(a)
        : ordem === 'chegada'
          ? a.importadoEm.localeCompare(b.importadoEm)
          : prazo(a).localeCompare(prazo(b)) || a.importadoEm.localeCompare(b.importadoEm),
    );
  }, [e, q, ordem]);
  const total = useMemo(() => e.pedidos.filter((p) => statusPedido(e, p) === 'pcp').length, [e]);
  const [selId, setSel] = useState<string | null>(pend[0]?.id ?? null);
  useEffect(() => {
    if (!pend.find((p) => p.id === selId)) setSel(pend[0]?.id ?? null);
  }, [pend, selId]);
  const sel = pend.find((p) => p.id === selId);
  const somenteVer = !pode.decidirPCP(perfil);

  const liberar = async (p: Pedido) => {
    const antes = e.ops.length;
    let n = 0;
    const ok = await executar(async () => {
      const r = await api.liberar(p.id);
      n = r.estado.ops.length - antes;
      return r;
    });
    if (ok) toast({ texto: `Pedido #${p.numero} liberado: ${n} OP(s) nova(s) enviadas para a produção.`, tipo: 'ok' });
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Análise do PCP</h1>
          <p>Escolha o pedido, defina o que sai do estoque e o que vira OP, e libere para a produção.</p>
        </div>
      </div>

      {!total ? (
        <div className="panel vazio-grande">
          <Icon n="pcp" s={34} w={1.6} />
          <b>Nenhum pedido aguardando análise</b>
          <span>Quando o comercial importar um PDF, ele aparece aqui.</span>
        </div>
      ) : (
        <div className="pcp2">
          <section className="panel pcp2-lista" aria-label="Pedidos aguardando análise">
            <div className="pcp2-lista-topo">
              <div className="pcp2-lista-tit">
                <b>Aguardando</b>
                <span className="contador">{total}</span>
              </div>
              <label className="search">
                <Icon n="search" s={15} />
                <span className="sr">Buscar</span>
                <input id="busca-pcp" className="input" placeholder="Nº ou cliente" value={q} onChange={(ev) => setQ(ev.target.value)} />
              </label>
              <div className="seg" role="group" aria-label="Ordenar por">
                <button aria-pressed={ordem === 'prazo'} onClick={() => setOrdem('prazo')}>Prazo</button>
                <button aria-pressed={ordem === 'chegada'} onClick={() => setOrdem('chegada')}>Chegada</button>
                <button aria-pressed={ordem === 'volume'} onClick={() => setOrdem('volume')}>Volume</button>
              </div>
            </div>
            <div className="pcp2-itens">
              {pend.map((p) => {
                const decididos = p.itens.filter((i) => i.decisao !== 'pendente').length;
                return (
                  <button key={p.id} className={`pcp2-ped${p.id === selId ? ' sel' : ''}`} onClick={() => setSel(p.id)} aria-current={p.id === selId}>
                    <span className="l1">
                      <span className="mono">#{p.numero}</span>
                      <span className="num muted">{fmtVol(volumePedido(p))}</span>
                    </span>
                    <span className="l2">{titulo(p.fantasia)}</span>
                    <span className="l3">
                      <PrazoChip p={p} />
                      <span className="muted num">{decididos ? `${decididos}/${p.itens.length} decididos` : `${p.itens.length} itens`}</span>
                    </span>
                  </button>
                );
              })}
              {!pend.length && <div className="empty">Nenhum pedido com esse filtro.</div>}
            </div>
          </section>

          {sel && <Analise key={sel.id} p={sel} somenteVer={somenteVer} onLiberar={() => liberar(sel)} abrir={() => abrirPedido(sel.id)} />}
        </div>
      )}
    </main>
  );
}

function Analise({ p, onLiberar, somenteVer, abrir }: { p: Pedido; onLiberar: () => Promise<void>; somenteVer: boolean; abrir: () => void }) {
  const { e, executar, agora, perfil } = useApp();
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState<Record<string, boolean>>({});

  const grupos = useMemo(() => {
    const m = new Map<string, Pedido['itens']>();
    for (const i of p.itens) m.set(i.produtoId, [...(m.get(i.produtoId) ?? []), i]);
    return [...m].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
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
  const planoDe = useMemo(() => new Map<string, LinhaPlano>(plano.map((l) => [l.produtoId, l])), [plano]);
  const pendentes = p.itens.filter((i) => i.decisao === 'pendente').length;
  const decididos = p.itens.length - pendentes;
  const novasOps = plano.reduce((s, l) => s + l.novas.length, 0);
  const tempo = plano.reduce((s, l) => s + l.tempoMin, 0);
  const volOP = plano.reduce((s, l) => s + l.necessidade, 0);
  const volEst = p.itens.filter((i) => i.decisao === 'estoque').reduce((s, i) => s + i.volume, 0);
  const semParam = produtosSemParametro(e, p);
  const podeParam = pode.parametros(perfil);

  const simul = useMemo(() => {
    if (pendentes || semParam.length) return null;
    const e2 = liberarPedido(e, p.id, agora);
    const ag = calcularAgenda(e2, agora);
    const fim = ag.pedidos.get(p.id);
    const pp = e2.pedidos.find((x) => x.id === p.id)!;
    return { fim, prazo: situacaoPrazo(e2, pp, fim, agora) };
  }, [e, p, agora, pendentes, semParam.length]);

  const todos = p.itens.map((i) => i.id);
  const linhas = [...new Set(grupos.map(([pid]) => pid.split('.')[0]))];
  const bloqueio = pendentes
    ? `Faltam ${pendentes} ${pendentes === 1 ? 'item' : 'itens'} para decidir.`
    : semParam.length
      ? `Falta informar lote e tempo de ${semParam.length} produto${semParam.length > 1 ? 's' : ''} (marcados abaixo).`
      : '';

  return (
    <section className="pcp2-det" aria-label={`Pedido ${p.numero}`}>
      <div className="panel pcp2-cab">
        <div className="pcp2-cab-l">
          <div className="pcp2-cab-n">
            <span className="mono">#{p.numero}</span>
            <PrazoChip p={p} />
          </div>
          <h2>{titulo(p.fantasia)}</h2>
          <div className="pcp2-meta">
            <span>{titulo(p.cidade)}/{p.uf}</span>
            <span>{titulo(p.vendedor)}</span>
            <span>entrou {quando(new Date(p.importadoEm), agora)}</span>
            <span>prazo {dataISOparaBR(prazoDoPedido(e, p))}</span>
          </div>
        </div>
        <div className="pcp2-cab-a">
          <button className="btn ghost sm" onClick={abrir}>Ver pedido</button>
          {!somenteVer && (
            <>
              <button className="btn sm" disabled={ocupado} onClick={() => decidir(todos, 'estoque')}>Tudo do estoque</button>
              <button className="btn sm" disabled={ocupado} onClick={() => decidir(todos, 'op')}>Tudo vira OP</button>
            </>
          )}
        </div>
      </div>

      <div className="panel pcp2-resumo">
        <div className="rs">
          <span className="rs-l">Decididos</span>
          <b className="num">{decididos}<small>/{p.itens.length}</small></b>
          <div className="bar" aria-hidden="true"><i className="done" style={{ width: `${(decididos / p.itens.length) * 100}%` }} /></div>
        </div>
        <div className="rs"><span className="rs-l">A produzir</span><b className="num">{fmtVol(volOP)}</b><span className="rs-s">{novasOps} OP{novasOps === 1 ? '' : 's'} nova{novasOps === 1 ? '' : 's'}</span></div>
        <div className="rs"><span className="rs-l">Do estoque</span><b className="num">{fmtVol(volEst)}</b><span className="rs-s">{p.itens.filter((i) => i.decisao === 'estoque').length} itens</span></div>
        <div className="rs"><span className="rs-l">Produção</span><b className="num">{tempo ? fmtDur(tempo) : '—'}</b><span className="rs-s">tempo padrão somado</span></div>
        <div className="rs rs-fim">
          <span className="rs-l">Se liberar agora</span>
          {simul ? (
            <>
              <b className="num">{simul.fim ? quando(simul.fim, agora) : 'na hora'}</b>
              {simul.prazo.tipo !== 'sem' && (
                <span className={`chip ${simul.prazo.tipo === 'ok' ? 'ok' : simul.prazo.tipo === 'risco' ? 'warn' : 'crit'}`}>{simul.prazo.texto}</span>
              )}
            </>
          ) : (
            <b className="muted">—</b>
          )}
        </div>
        {!somenteVer && (
          <button className="btn pri pcp2-liberar" disabled={!!bloqueio || ocupado} onClick={liberar}>
            <Icon n="check" s={17} w={2.4} /> Liberar para produção
          </button>
        )}
      </div>
      {bloqueio && (
        <div className="pcp2-aviso" role="status">
          <Icon n="info" s={15} /> {bloqueio}
        </div>
      )}

      <div className="panel pcp2-tab">
        <div className="scroll-x">
          <table className="t pcp2-t">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="r">Volume</th>
                <th>Decisão</th>
                <th>Plano de produção</th>
              </tr>
            </thead>
            {linhas.map((ln) => (
              <tbody key={ln}>
                <tr className="pcp2-linha"><td colSpan={4}>{nomeLinha(ln)}</td></tr>
                {grupos
                  .filter(([pid]) => pid.split('.')[0] === ln)
                  .flatMap(([pid, its]) => {
                    const prod = e.produtos[pid];
                    const vol = its.reduce((s, i) => s + i.volume, 0);
                    const decs = new Set(its.map((i) => i.decisao));
                    const g: Decisao | 'misto' = decs.size === 1 ? [...decs][0] : 'misto';
                    const ids = its.map((i) => i.id);
                    const exp = aberto[pid] ?? g === 'misto';
                    const l = planoDe.get(pid);
                    const linhasTab = [
                      <tr key={pid} className={`pcp2-prod${g === 'pendente' ? ' pend' : ''}`}>
                        <td>
                          <b className="pn">{prod?.nome ?? pid}</b>
                          <span className="ps">
                            <span className="mono">{pid}</span> · {its.map((i) => `${nf(i.qtde)}×${nf(i.embalagem, 1)}L`).join(' · ')}
                            {its.length > 1 && (
                              <button className="lnk" onClick={() => setAberto((x) => ({ ...x, [pid]: !exp }))} aria-expanded={exp}>
                                {exp ? 'ocultar embalagens' : 'por embalagem'}
                              </button>
                            )}
                          </span>
                        </td>
                        <td className="r num"><b>{fmtVol(vol)}</b></td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div className="dec" role="group" aria-label={`Decisão para ${prod?.nome}`}>
                            <button className="on-est" aria-pressed={g === 'estoque'} disabled={somenteVer || ocupado} onClick={() => decidir(ids, 'estoque')}>Estoque</button>
                            <button className="on-op" aria-pressed={g === 'op'} disabled={somenteVer || ocupado} onClick={() => decidir(ids, 'op')}>Produzir</button>
                          </div>
                          {g === 'misto' && <span className="chip" style={{ marginLeft: 6 }}>misto</span>}
                        </td>
                        <td>
                          <Plano l={l} decisao={g} prodOk={temParametros(prod)} />
                          {l?.semParametro && prod && (
                            <div className="pcp2-param">
                              {podeParam ? (
                                <CamposParam p={prod} pode comBotao onSalvar={(x) => executar(() => api.produto(prod.id, x), `${prod.nome}: lote e tempo salvos.`)} />
                              ) : (
                                <span className="muted">o PCP precisa informar lote e tempo</span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>,
                    ];
                    if (exp)
                      for (const i of its)
                        linhasTab.push(
                          <tr key={i.id} className="pcp2-emb">
                            <td>
                              <span className="mono muted">{i.codigo}</span> <span className="mono">{i.codFab}</span>
                              <span className="muted"> · {nf(i.qtde)} × {nf(i.embalagem, 1)} L</span>
                            </td>
                            <td className="r num">{fmtVol(i.volume)}</td>
                            <td colSpan={2}>
                              <div className="dec">
                                <button className="on-est" aria-pressed={i.decisao === 'estoque'} disabled={somenteVer || ocupado} onClick={() => decidir([i.id], 'estoque')}>Estoque</button>
                                <button className="on-op" aria-pressed={i.decisao === 'op'} disabled={somenteVer || ocupado} onClick={() => decidir([i.id], 'op')}>Produzir</button>
                              </div>
                            </td>
                          </tr>,
                        );
                    return linhasTab;
                  })}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </section>
  );
}

function Plano({ l, decisao, prodOk }: { l?: LinhaPlano; decisao: Decisao | 'misto'; prodOk: boolean }) {
  const { e } = useApp();
  if (decisao === 'pendente') return <span className="chip warn">decidir</span>;
  if (decisao === 'estoque') return <span className="muted">sai do estoque</span>;
  if (!l) return null;
  const prod = e.produtos[l.produtoId];
  return (
    <span className="plano-chips">
      {l.semParametro && <span className="chip warn">sem lote e tempo</span>}
      {l.aproveita.map((a) => (
        <span key={a.opId} className="chip ok" title="OP ainda não iniciada com volume livre">
          <Icon n="bolt" s={11} /> OP {a.numero} ({fmtVol(a.volume)})
        </span>
      ))}
      {l.novas.length > 0 && (
        <span className="chip info">
          {l.novas.length} OP{l.novas.length > 1 ? 's' : ''} nova{l.novas.length > 1 ? 's' : ''}
        </span>
      )}
      {prodOk && prod && l.novas.length > 0 && <span className="muted">lote {fmtVol(prod.lote!)} · {fmtDur(prod.tempoMin!)}</span>}
      {l.sobra > 0.5 && <span className="muted">· sobra {fmtVol(l.sobra)}</span>}
    </span>
  );
}
