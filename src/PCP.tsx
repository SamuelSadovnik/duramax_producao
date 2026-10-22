import { useMemo, useState } from 'react';
import { pode, useApp } from './store';
import { Icon } from './ui';
import { calcularAgenda, liberarPedido, planejar, produtosSemParametro, situacaoPrazo, temParametros, type LinhaPlano } from '../shared/engine';
import { CamposParam } from './ParamProduto';
import { fmtDur, fmtVol, nf, quando } from '../shared/fmt';
import type { Decisao, Pedido } from '../shared/types';
import { nomeLinha } from '../shared/catalog';
import { api } from './api';

/**
 * Análise do PCP de um pedido: decidir o que sai do estoque e o que vira OP, e liberar.
 * Abre como subtela (gaveta) quando se clica num pedido "Aguardando PCP" na tela de Pedidos.
 */
export function AnalisePCP({ p, onLiberado }: { p: Pedido; onLiberado?: () => void }) {
  const { e, executar, perfil, toast } = useApp();
  const somenteVer = !pode.decidirPCP(perfil);
  const liberar = async () => {
    const antes = e.ops.length;
    let n = 0;
    const ok = await executar(async () => {
      const r = await api.liberar(p.id);
      n = r.estado.ops.length - antes;
      return r;
    });
    if (ok) {
      toast({ texto: `Pedido #${p.numero} liberado: ${n} OP(s) nova(s) enviadas para a produção.`, tipo: 'ok' });
      onLiberado?.();
    }
  };
  return <Analise p={p} somenteVer={somenteVer} onLiberar={liberar} />;
}

function Analise({ p, onLiberar, somenteVer }: { p: Pedido; onLiberar: () => Promise<void>; somenteVer: boolean }) {
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
    ? `falta${pendentes === 1 ? '' : 'm'} decidir ${pendentes} ${pendentes === 1 ? 'item' : 'itens'}`
    : semParam.length
      ? `falta lote e tempo de ${semParam.length} produto${semParam.length > 1 ? 's' : ''}`
      : '';

  return (
    <section className="pcp2-det" aria-label={`Pedido ${p.numero}`}>
      {/* uma linha só: o que falta (ou que está pronto), o resumo e o botão de liberar */}
      <div className={`panel pcp-barra${bloqueio ? ' falta' : ' pronta'}`}>
        <span className="pcp-barra-ic"><Icon n={bloqueio ? 'alert' : 'check'} s={18} w={bloqueio ? 2 : 2.6} /></span>
        <div className="pcp-barra-txt">
          <b>{bloqueio ? bloqueio.charAt(0).toUpperCase() + bloqueio.slice(1) : 'Pronto para liberar'}</b>
          <span>
            {decididos} de {p.itens.length} itens decididos
            {volOP > 0 && <> · {fmtVol(volOP)} a produzir em {novasOps} OP{novasOps === 1 ? '' : 's'}</>}
            {volEst > 0 && <> · {fmtVol(volEst)} do estoque</>}
            {simul && <> · fica pronto {simul.fim ? quando(simul.fim, agora) : 'na hora'}</>}
          </span>
        </div>
        {simul && simul.prazo.tipo !== 'sem' && (
          <span className={`chip ${simul.prazo.tipo === 'ok' ? 'ok' : simul.prazo.tipo === 'risco' ? 'warn' : 'crit'}`}>{simul.prazo.texto}</span>
        )}
        {!somenteVer && (
          <button className="btn pri grande" disabled={!!bloqueio || ocupado} onClick={liberar}>
            <Icon n="check" s={17} w={2.4} /> Liberar para produção
          </button>
        )}
      </div>

      <div className="panel flush">
        <div className="toolbar">
          <b className="pcp-tit">Produtos do pedido <span className="muted">· {grupos.length}</span></b>
          {!somenteVer && (
            <span className="sp linha-ctl">
              <button className="btn sm" disabled={ocupado} onClick={() => decidir(todos, 'estoque')}><Icon n="box" s={14} /> Tudo do estoque</button>
              <button className="btn sm" disabled={ocupado} onClick={() => decidir(todos, 'op')}><Icon n="flask" s={14} /> Tudo vira OP</button>
            </span>
          )}
        </div>
        <div className="scroll-x">
          <table className="t pcp2-t cartoes-tab">
            <thead>
              <tr>
                <th>Produto</th>
                <th className="r" style={{ width: 92 }}>Volume</th>
                <th style={{ width: 256 }}>Decisão</th>
                <th style={{ width: '41%' }}>Plano de produção</th>
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
                        <td className="cel-tit">
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
                        <td className="r num nw" data-l="Volume"><b>{fmtVol(vol)}</b></td>
                        <td className="nw cel-larga" data-l="Decisão">
                          <BotoesDecisao valor={g} desativado={somenteVer || ocupado} nome={prod?.nome ?? pid} onEscolher={(d) => decidir(ids, d)} />
                          {g === 'misto' && <span className="chip" style={{ marginLeft: 6 }}>misto</span>}
                        </td>
                        <td className="cel-larga" data-l="Plano de produção">
                          {l?.semParametro && prod ? (
                            // produto sem lote e tempo: o formulário fica numa linha só, alinhado com o resto da linha
                            <div className="pcp2-param">
                              <span className="chip warn" title="Produto sem lote e tempo cadastrados"><Icon n="alert" s={12} /> sem parâmetro</span>
                              {podeParam ? (
                                <CamposParam p={prod} pode comBotao onSalvar={(x) => executar(() => api.produto(prod.id, x), `${prod.nome}: lote e tempo salvos.`)} />
                              ) : (
                                <span className="muted">o PCP precisa informar lote e tempo</span>
                              )}
                            </div>
                          ) : (
                            <Plano l={l} decisao={g} prodOk={temParametros(prod)} />
                          )}
                        </td>
                      </tr>,
                    ];
                    if (exp)
                      for (const i of its)
                        linhasTab.push(
                          <tr key={i.id} className="pcp2-emb">
                            <td className="cel-tit">
                              <span className="mono muted">{i.codigo}</span> <span className="mono">{i.codFab}</span>
                              <span className="muted"> · {nf(i.qtde)} × {nf(i.embalagem, 1)} L</span>
                            </td>
                            <td className="r num cel-oculta">{fmtVol(i.volume)}</td>
                            <td colSpan={2} className="cel-larga">
                              <BotoesDecisao pequeno valor={i.decisao} desativado={somenteVer || ocupado} nome={i.codFab} onEscolher={(d) => decidir([i.id], d)} />
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

function BotoesDecisao({ valor, desativado, nome, onEscolher, pequeno }: { valor: Decisao | 'misto'; desativado: boolean; nome: string; onEscolher: (d: Decisao) => void; pequeno?: boolean }) {
  return (
    <div className={`dec${pequeno ? ' sm' : ''}`} role="group" aria-label={`Decisão para ${nome}`}>
      <button className="on-est" aria-pressed={valor === 'estoque'} disabled={desativado} onClick={() => onEscolher('estoque')}>
        <Icon n={valor === 'estoque' ? 'check' : 'box'} s={14} w={valor === 'estoque' ? 2.6 : 2} /> Estoque
      </button>
      <button className="on-op" aria-pressed={valor === 'op'} disabled={desativado} onClick={() => onEscolher('op')}>
        <Icon n={valor === 'op' ? 'check' : 'flask'} s={14} w={valor === 'op' ? 2.6 : 2} /> Produzir
      </button>
    </div>
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
