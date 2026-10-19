import { useMemo, useRef, useState } from 'react';
import { useApp } from './store';
import { Icon, Modal, PrazoChip, ProgressoOPs, STATUS_PED, estimativaTexto, nomeOP } from './ui';
import { opsDoPedido, statusPedido, volumePedido, situacaoPrazo } from '../shared/engine';
import { dataISOparaBR, fmtDur, fmtVol, nf, quando, titulo } from '../shared/fmt';
import type { Estado, Pedido, StatusPedido } from '../shared/types';
import { textosDoPdf } from './pdf';
import { lerPedido, type PedidoLido } from '../shared/parse';
import { somarExpediente, iso } from '../shared/calendar';
import { api } from './api';
import { pode } from './store';

const COLS: StatusPedido[] = ['pcp', 'fila', 'producao', 'pronto', 'expedido'];

export function PedidosView() {
  const { e, abrirPedido, perfil } = useApp();
  const [q, setQ] = useState('');
  const [importar, setImportar] = useState(false);
  const [colMob, setColMob] = useState<StatusPedido>('producao');

  const pos = useMemo(() => new Map(e.prioridade.map((id, i) => [id, i])), [e.prioridade]);
  const grupos = useMemo(() => {
    const g: Record<StatusPedido, Pedido[]> = { pcp: [], fila: [], producao: [], pronto: [], expedido: [] };
    const ql = q.trim().toLowerCase();
    for (const p of e.pedidos) {
      if (ql && !`${p.numero} ${p.fantasia} ${p.cliente} ${p.cidade} ${p.vendedor}`.toLowerCase().includes(ql)) continue;
      g[statusPedido(e, p)].push(p);
    }
    for (const k of COLS) {
      if (k === 'expedido') g[k].sort((a, b) => b.expedidoEm!.localeCompare(a.expedidoEm!));
      else g[k].sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
    }
    return g;
  }, [e, q, pos]);

  const posFila = (id: string) => {
    const ativos = e.prioridade.filter((x) => {
      const p = e.pedidos.find((y) => y.id === x);
      return p && ['pcp', 'fila', 'producao'].includes(statusPedido(e, p));
    });
    const i = ativos.indexOf(id);
    return i < 0 ? null : i + 1;
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Pedidos</h1>
          <p>Do PDF do comercial até a expedição. A estimativa recalcula sozinha quando a fila ou a produção mudam.</p>
        </div>
        <div className="acts">
          <label className="search">
            <Icon n="search" s={15} />
            <span className="sr">Buscar pedido</span>
            <input id="busca-pedido" className="input" placeholder="Nº, cliente, cidade, vendedor" value={q} onChange={(ev) => setQ(ev.target.value)} />
          </label>
          {pode.importar(perfil) && (
            <button className="btn pri" onClick={() => setImportar(true)}>
              <Icon n="upload" s={16} /> Importar PDF
            </button>
          )}
        </div>
      </div>

      <div className="kan-tabs seg" role="tablist">
        {COLS.map((c) => (
          <button key={c} aria-pressed={colMob === c} onClick={() => setColMob(c)}>
            {STATUS_PED[c].label.replace(' de produção', '').replace(' p/ expedição', '')} · {grupos[c].length}
          </button>
        ))}
      </div>

      <div className="kanban">
        {COLS.map((c) => {
          const lista = c === 'expedido' ? grupos[c].slice(0, 8) : grupos[c];
          const vol = grupos[c].reduce((s, p) => s + volumePedido(p), 0);
          return (
            <section key={c} className={`col${colMob === c ? ' show' : ''}`} aria-label={STATUS_PED[c].label}>
              <div className="col-head">
                <span className="dot" style={{ background: STATUS_PED[c].cor }} />
                <h3>{STATUS_PED[c].label}</h3>
                <span className="n">{grupos[c].length}</span>
                {c !== 'expedido' && <span className="vol">{fmtVol(vol)}</span>}
              </div>
              {lista.map((p) => (
                <CardPedido key={p.id} p={p} pos={c === 'expedido' || c === 'pronto' ? null : posFila(p.id)} onClick={() => abrirPedido(p.id)} />
              ))}
              {c === 'expedido' && grupos[c].length > 8 && <div className="muted" style={{ fontSize: 12, padding: '2px 4px' }}>e mais {grupos[c].length - 8} expedidos</div>}
              {!lista.length && <div className="empty">Nenhum pedido aqui.</div>}
            </section>
          );
        })}
      </div>
      {importar && <ImportarModal onClose={() => setImportar(false)} />}
    </main>
  );
}

function CardPedido({ p, pos, onClick }: { p: Pedido; pos: number | null; onClick: () => void }) {
  const { e, agenda, agora } = useApp();
  const st = statusPedido(e, p);
  const est = agenda.pedidos.get(p.id);
  const pr = situacaoPrazo(e, p, est, agora);
  return (
    <button className={`pcard${pr.tipo === 'atrasado' && st !== 'expedido' ? ' late' : ''}`} onClick={onClick}>
      <div className="pcard-top">
        {pos && <span className="prio" title="Posição na fila de prioridade">{pos}º</span>}
        <span className="nped">#{p.numero}</span>
        
        <span className="sp num muted" style={{ fontSize: 12 }}>{fmtVol(volumePedido(p))}</span>
      </div>
      <div className="cli">{titulo(p.fantasia)}</div>
      <div className="meta">
        <span>{titulo(p.cidade)}/{p.uf}</span>
        <span>{p.itens.length} {p.itens.length === 1 ? 'item' : 'itens'}</span>
        <span>{titulo(p.vendedor.split(' ')[0])}</span>
      </div>
      {(st === 'fila' || st === 'producao') && <ProgressoOPs e={e} p={p} />}
      <div className="est">
        <span className="muted">
          {st === 'pcp' || st === 'pronto' || st === 'expedido' ? '' : 'Estimativa '}
          <b>{estimativaTexto(e, p, est, agora)}</b>
        </span>
        {st !== 'expedido' && <PrazoChip p={p} />}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------ importação */

type Lido = { arquivo: string; ped?: PedidoLido; erro?: string; prazo: string };

function ImportarModal({ onClose }: { onClose: () => void }) {
  const { e, executar, toast, agora } = useApp();
  const [lidos, setLidos] = useState<Lido[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [on, setOn] = useState(false);
  const inp = useRef<HTMLInputElement>(null);

  async function ler(files: FileList | File[]) {
    setLendo(true);
    const out: Lido[] = [];
    for (const f of Array.from(files)) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
        out.push({ arquivo: f.name, erro: 'O arquivo não é PDF.', prazo: '' });
        continue;
      }
      try {
        const ped = lerPedido(await textosDoPdf(f));
        if (!ped.numero || !ped.itens.length) throw new Error('Não encontrei o número ou os itens. Confira se é o PDF de Pedido de Venda do ERP.');
        const prazoPadrao = ped.previsao && ped.previsao > ped.emissao ? ped.previsao : iso(somarExpediente(agora, 528 * 5, e.config.feriados));
        out.push({ arquivo: f.name, ped, prazo: prazoPadrao });
      } catch (err: any) {
        out.push({ arquivo: f.name, erro: err?.message ?? 'Não foi possível ler o PDF.', prazo: '' });
      }
    }
    setLidos((x) => [...x, ...out]);
    setLendo(false);
  }

  const existentes = new Set(e.pedidos.map((p) => p.numero));
  const validos = lidos.filter((l) => l.ped && !existentes.has(l.ped.numero));

  async function confirmar() {
    setEnviando(true);
    let novosProd = 0;
    const ok = await executar(async () => {
      const r = await api.importar(validos.map((l) => ({ pedido: l.ped!, prazo: l.prazo })));
      novosProd = r.novosProdutos;
      return r;
    });
    setEnviando(false);
    if (!ok) return;
    toast({
      texto: `${validos.length} pedido(s) importado(s) e enviados para o PCP${novosProd ? ` · ${novosProd} produto(s) novo(s) com parâmetros a revisar` : ''}`,
      tipo: 'ok',
    });
    onClose();
  }

  return (
    <Modal onClose={onClose} wide label="Importar pedidos">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2>Importar pedidos do PDF</h2>
        <button className="btn ghost icon" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Fechar">
          <Icon n="x" />
        </button>
      </div>
      <div
        className={`drop${on ? ' on' : ''}`}
        onDragOver={(ev) => {
          ev.preventDefault();
          setOn(true);
        }}
        onDragLeave={() => setOn(false)}
        onDrop={(ev) => {
          ev.preventDefault();
          setOn(false);
          ler(ev.dataTransfer.files);
        }}
      >
        <Icon n="file" s={30} w={1.6} />
        <b>{lendo ? 'Lendo PDF…' : 'Arraste os PDFs de Pedido de Venda aqui'}</b>
        <span>O sistema lê cliente, prazo e todos os itens, mesmo em pedidos com várias páginas.</span>
        <button className="btn" onClick={() => inp.current?.click()} disabled={lendo}>
          Escolher arquivos
        </button>
        <input ref={inp} id="arquivo-pdf" type="file" accept="application/pdf,.pdf" multiple hidden onChange={(ev) => ev.target.files && ler(ev.target.files)} />
      </div>

      {lidos.map((l, k) => {
        if (!l.ped)
          return (
            <div key={k} className="chip crit" style={{ whiteSpace: 'normal', padding: '8px 12px', borderRadius: 8 }}>
              <Icon n="alert" s={14} /> {l.arquivo}: {l.erro}
            </div>
          );
        const ped = l.ped;
        const dup = existentes.has(ped.numero);
        const vol = ped.itens.reduce((s, i) => s + i.qtde * i.embalagem, 0);
        const prods = [...new Set(ped.itens.map((i) => i.produtoId))];
        const novos = prods.filter((id) => !e.produtos[id]);
        return (
          <div key={k} className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: 15 }}>#{ped.numero}</span>
              <b style={{ fontSize: 15 }}>{titulo(ped.fantasia || ped.cliente)}</b>
              {dup ? <span className="chip crit">Já existe no sistema</span> : <span className="chip ok"><Icon n="check" s={12} w={2.6} /> Lido</span>}
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{l.arquivo}</span>
            </div>
            <dl className="kv" style={{ margin: 0 }}>
              <div><dt>Cliente</dt><dd>{titulo(ped.cliente)}</dd></div>
              <div><dt>Cidade</dt><dd>{titulo(ped.cidade)}/{ped.uf}</dd></div>
              <div><dt>Vendedor</dt><dd>{titulo(ped.vendedor)}</dd></div>
              <div><dt>Emissão</dt><dd>{dataISOparaBR(ped.emissao)} {ped.hora.slice(0, 5)}</dd></div>
              <div><dt>Itens / volume</dt><dd className="num">{ped.itens.length} · {fmtVol(vol)}</dd></div>
              <div>
                <dt><label htmlFor={`prazo-${k}`}>Prazo de entrega</label></dt>
                <dd>
                  <input
                    id={`prazo-${k}`}
                    type="date"
                    className="input"
                    style={{ padding: '4px 8px' }}
                    value={l.prazo}
                    onChange={(ev) => setLidos((x) => x.map((y, j) => (j === k ? { ...y, prazo: ev.target.value } : y)))}
                  />
                </dd>
              </div>
            </dl>
            {ped.previsao <= ped.emissao && (
              <span className="muted" style={{ fontSize: 12 }}>
                A data previsão do ERP é igual à emissão ({dataISOparaBR(ped.previsao)}); sugeri 5 dias úteis. Ajuste se o combinado com o cliente for outro.
              </span>
            )}
            {novos.length > 0 && (
              <span className="chip warn" style={{ whiteSpace: 'normal', borderRadius: 8, padding: '6px 10px' }}>
                <Icon n="info" s={13} /> {novos.length} produto(s) novo(s) no cadastro. Entram com lote e tempo sugeridos; o PCP revisa em Parâmetros.
              </span>
            )}
            <div className="scroll-x" style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              <table className="t">
                <thead>
                  <tr><th>Código</th><th>Descrição</th><th>Cód. fab.</th><th className="r">Qtde</th><th className="r">Volume</th></tr>
                </thead>
                <tbody>
                  {ped.itens.map((i, j) => (
                    <tr key={j}>
                      <td className="mono">{i.codigo}</td>
                      <td>{i.descricao}</td>
                      <td className="mono">{i.codFab}</td>
                      <td className="r num">{nf(i.qtde)} × {nf(i.embalagem, 1)} L</td>
                      <td className="r num">{fmtVol(i.qtde * i.embalagem)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="modal-acts">
        <button className="btn ghost" onClick={onClose}>Cancelar</button>
        <button className="btn pri" disabled={!validos.length || enviando} onClick={confirmar}>
          Importar {validos.length || ''} pedido{validos.length === 1 ? '' : 's'} e enviar ao PCP
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- detalhe */

export function DetalhePedido() {
  const { e, executar, agenda, agora, pedidoAberto, abrirPedido, perfil } = useApp();
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);
  const p = e.pedidos.find((x) => x.id === pedidoAberto);
  if (!p) return null;
  const st = statusPedido(e, p);
  const est = agenda.pedidos.get(p.id);
  const ops = opsDoPedido(e, p.id);
  const fechar = () => abrirPedido(null);
  const podeEditar = pode.prioridade(perfil);

  const grupos = new Map<string, typeof p.itens>();
  for (const i of p.itens) grupos.set(i.produtoId, [...(grupos.get(i.produtoId) ?? []), i]);

  const moverTopo = () =>
    executar(() => api.prioridade([p.id, ...e.prioridade.filter((x) => x !== p.id)]), `Pedido #${p.numero} agora é o 1º da fila. Estimativas recalculadas.`);
  const expedir = () => executar(() => api.expedir(p.id), `Pedido #${p.numero} marcado como expedido.`);
  const excluir = async () => {
    if (await executar(() => api.excluirPedido(p.id), `Pedido #${p.numero} excluído.`)) fechar();
  };

  return (
    <>
      <div className="scrim" onClick={fechar} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Pedido ${p.numero}`}>
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontWeight: 600 }}>Pedido #{p.numero}</span>
              <span className="chip" style={{ color: STATUS_PED[st].cor }}>{STATUS_PED[st].label}</span>
              
            </div>
            <h2 style={{ fontSize: 21, fontStretch: '82%', fontWeight: 750, marginTop: 4 }}>{titulo(p.fantasia)}</h2>
            <div className="muted" style={{ fontSize: 12.5 }}>{titulo(p.cliente)}</div>
          </div>
          <button className="btn ghost icon" onClick={fechar} aria-label="Fechar">
            <Icon n="x" />
          </button>
        </div>
        <div className="drawer-body">
          <div className="panel" style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}>
              <div className="eyebrow">{st === 'pronto' || st === 'expedido' ? 'Situação' : 'Estimativa de liberação p/ expedição'}</div>
              <div style={{ fontSize: 24, fontStretch: '78%', fontWeight: 750 }} className="num">
                {estimativaTexto(e, p, est, agora)}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <PrazoChip p={p} />
                <span className="muted" style={{ fontSize: 12 }}>Prazo: {dataISOparaBR(p.previsao)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {podeEditar && ['pcp', 'fila', 'producao'].includes(st) && (
                <button className="btn" onClick={moverTopo}>
                  <Icon n="top" s={15} /> Prioridade máxima
                </button>
              )}
              {podeEditar && st === 'pronto' && (
                <button className="btn ok" onClick={expedir}>
                  <Icon n="truck" s={16} /> Marcar como expedido
                </button>
              )}
            </div>
          </div>

          <dl className="kv" style={{ margin: 0 }}>
            <div><dt>Cidade</dt><dd>{titulo(p.cidade)}/{p.uf}</dd></div>
            <div><dt>Vendedor</dt><dd>{titulo(p.vendedor)}</dd></div>
            <div><dt>Transportadora</dt><dd>{titulo(p.transportadora)}</dd></div>
            <div><dt>Emissão</dt><dd>{dataISOparaBR(p.emissao)}</dd></div>
            <div><dt>Volume total</dt><dd className="num">{fmtVol(volumePedido(p))}</dd></div>
            <div><dt>Itens</dt><dd className="num">{p.itens.length}</dd></div>
          </dl>

          {ops.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h2>Ordens de produção</h2><span className="sp muted" style={{ fontSize: 12 }}>{ops.filter((o) => o.status === 'concluida').length} de {ops.length} concluídas</span></div>
              <div className="scroll-x">
                <table className="t">
                  <thead><tr><th>OP</th><th>Produto</th><th className="r">Deste pedido</th><th>Situação</th><th>Previsão / fim</th></tr></thead>
                  <tbody>
                    {ops.map((o) => {
                      const pv = agenda.ops.get(o.id);
                      const v = o.alocacoes.find((a) => a.pedidoId === p.id)!.volume;
                      return (
                        <tr key={o.id}>
                          <td className="mono">{o.numero}</td>
                          <td>{nomeOP(e, o)}</td>
                          <td className="r num">{fmtVol(v)}<span className="muted"> / {fmtVol(o.lote)}</span></td>
                          <td>
                            {o.status === 'concluida' ? <span className="chip ok">Concluída</span> : o.status === 'producao' ? <span className={`chip ${pv?.atrasada ? 'crit' : 'info'}`}>{pv?.atrasada ? 'Em produção · atrasada' : 'Em produção'}</span> : <span className="chip">Na fila</span>}
                          </td>
                          <td className="num" style={{ whiteSpace: 'nowrap' }}>
                            {o.status === 'concluida' ? quando(new Date(o.fim!), agora) : pv ? quando(pv.fim, agora) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-head"><h2>Itens por produto</h2></div>
            <div className="scroll-x">
              <table className="t">
                <thead><tr><th>Produto</th><th>Embalagens</th><th className="r">Volume</th><th>Decisão PCP</th></tr></thead>
                <tbody>
                  {[...grupos].map(([pid, its]) => (
                    <tr key={pid}>
                      <td><b style={{ fontWeight: 600 }}>{e.produtos[pid]?.nome ?? pid}</b><div className="mono muted" style={{ fontSize: 11.5 }}>{pid}</div></td>
                      <td className="num fg2" style={{ fontSize: 12.5 }}>{its.map((i) => `${nf(i.qtde)}×${nf(i.embalagem, 1)}L`).join(' · ')}</td>
                      <td className="r num">{fmtVol(its.reduce((s, i) => s + i.volume, 0))}</td>
                      <td>
                        {[...new Set(its.map((i) => i.decisao))].map((d) => (
                          <span key={d} className={`chip ${d === 'op' ? 'info' : d === 'estoque' ? 'ok' : 'warn'}`} style={{ marginRight: 4 }}>
                            {d === 'op' ? 'Produzir' : d === 'estoque' ? 'Estoque' : 'Pendente'}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Histórico</h2></div>
            <ol className="timeline">
              {[...p.eventos].reverse().map((ev, k) => (
                <li key={k} className={ev.tipo}>
                  <time>{quando(new Date(ev.em), agora)}</time>
                  <i />
                  <span>{ev.texto}</span>
                </li>
              ))}
            </ol>
          </div>

          {podeEditar && st !== 'expedido' && (
            <div>
              {confirmaExcluir ? (
                <div className="chip crit" style={{ padding: '10px 12px', borderRadius: 8, gap: 10, whiteSpace: 'normal', flexWrap: 'wrap' }}>
                  Excluir o pedido #{p.numero}? OPs ainda na fila deixam de atender este pedido.
                  <button className="btn sm danger" onClick={excluir}>Excluir</button>
                  <button className="btn sm ghost" onClick={() => setConfirmaExcluir(false)}>Manter</button>
                </div>
              ) : (
                <button className="btn ghost danger sm" onClick={() => setConfirmaExcluir(true)}>
                  <Icon n="trash" s={14} /> Excluir pedido
                </button>
              )}
            </div>
          )}
          <span className="muted" style={{ fontSize: 11.5 }}>Tempo total padrão das OPs: {fmtDur(ops.reduce((s, o) => s + o.tempoPadraoMin, 0))}</span>
        </div>
      </aside>
    </>
  );
}

export type { Estado };
