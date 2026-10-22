import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './store';
import { Icon, Modal, PrazoChip, ProgressoOPs, STATUS_PED, estimativaTexto } from './ui';
import { opsDoPedido, prazoDoPedido, statusPedido, volumePedido, situacaoPrazo } from '../shared/engine';
import { dataISOparaBR, fmtVol, nf, quando, titulo } from '../shared/fmt';
import type { Estado, Pedido, StatusPedido } from '../shared/types';
import { textosDoPdf } from './pdf';
import { lerPedido, type PedidoLido } from '../shared/parse';
import { somarDiasUteis } from '../shared/calendar';
import { api } from './api';
import { pode } from './store';
import { AnalisePCP } from './PCP';

const COLS: StatusPedido[] = ['pcp', 'fila', 'producao', 'pronto', 'expedido'];
const VAZIO_COL: Record<StatusPedido, string> = {
  pcp: 'Nenhum pedido esperando o PCP.',
  fila: 'Nenhum pedido na fila.',
  producao: 'Nada em produção agora.',
  pronto: 'Nenhum pedido pronto para expedir.',
  expedido: 'Nenhum pedido expedido ainda.',
};
const ABA_COL: Record<StatusPedido, string> = { pcp: 'PCP', fila: 'Fila', producao: 'Produção', pronto: 'Pronto', expedido: 'Expedido' };

/** Para onde cada coluna pode ser arrastada (o resto muda sozinho pela produção). */
const DESTINO: Partial<Record<StatusPedido, StatusPedido>> = { pcp: 'fila', pronto: 'expedido' };
const POR_QUE_NAO: Record<StatusPedido, string> = {
  pcp: 'Pedido que já foi liberado não volta para o PCP.',
  fila: 'Só pedidos aguardando o PCP vão para a fila: arraste da primeira coluna.',
  producao: 'O pedido entra em produção sozinho quando o gerente inicia a primeira OP no chão de fábrica.',
  pronto: 'O pedido fica pronto sozinho quando a última OP dele é finalizada.',
  expedido: 'Só pedidos prontos podem ser marcados como expedidos.',
};

interface Arraste {
  p: Pedido;
  de: StatusPedido;
  x: number;
  y: number;
  ox: number;
  oy: number;
  w: number;
}

export function PedidosView() {
  const { e, abrirPedido, perfil, executar, toast } = useApp();
  const [q, setQ] = useState('');
  const [arraste, setArraste] = useState<Arraste | null>(null);
  const [sobre, setSobre] = useState<StatusPedido | null>(null);
  const arrastou = useRef(false);
  const kanban = useRef<HTMLDivElement>(null);

  const soltar = (p: Pedido, de: StatusPedido, para: StatusPedido | null) => {
    if (!para || para === de) return;
    if (DESTINO[de] !== para) return toast({ texto: POR_QUE_NAO[para], tipo: 'info' });
    if (de === 'pcp') {
      // a liberação precisa das decisões do PCP: abre a análise do pedido
      if (!pode.decidirPCP(perfil)) return toast({ texto: 'Só o PCP libera pedidos para a produção.', tipo: 'info' });
      return abrirPedido(p.id);
    }
    if (!pode.expedir(perfil)) return toast({ texto: 'Seu perfil não marca pedidos como expedidos.', tipo: 'info' });
    executar(() => api.expedir(p.id), `Pedido #${p.numero} marcado como expedido.`);
  };

  /**
   * Arrastar cartão: com o mouse começa ao mover alguns pixels; no tablet, segurando o dedo
   * parado por um instante (para não atrapalhar a rolagem da tela).
   */
  const iniciarArraste = (ev: React.PointerEvent<HTMLElement>, p: Pedido, de: StatusPedido) => {
    if (ev.button !== 0 || window.matchMedia('(max-width: 767px)').matches) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    const toque = ev.pointerType !== 'mouse';
    let ativo = false;
    let ultimo: StatusPedido | null = null;
    const colEm = (x: number, y: number) => ((document.elementFromPoint(x, y)?.closest('[data-col]') as HTMLElement | null)?.dataset.col as StatusPedido) ?? null;
    const comecar = (x: number, y: number) => {
      ativo = true;
      arrastou.current = true;
      setArraste({ p, de, x, y, ox: x0 - r.left, oy: y0 - r.top, w: r.width });
      if (toque) navigator.vibrate?.(12);
    };
    const mover = (x: number, y: number) => {
      setArraste((a) => a && { ...a, x, y });
      ultimo = colEm(x, y);
      setSobre(ultimo);
      // perto da borda do quadro, rola para o lado
      const k = kanban.current;
      if (k) {
        const b = k.getBoundingClientRect();
        if (x > b.right - 70) k.scrollLeft += 14;
        else if (x < b.left + 70) k.scrollLeft -= 14;
      }
    };
    const terminar = (soltou: boolean) => {
      clearTimeout(segurar);
      window.removeEventListener('pointermove', pm);
      window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointercancel', pc);
      window.removeEventListener('touchmove', tm);
      window.removeEventListener('touchend', te);
      if (ativo) {
        setArraste(null);
        setSobre(null);
        if (soltou) soltar(p, de, ultimo);
        setTimeout(() => (arrastou.current = false), 0);
      }
    };
    const pm = (e: PointerEvent) => {
      if (toque) return;
      if (!ativo && Math.hypot(e.clientX - x0, e.clientY - y0) > 6) comecar(e.clientX, e.clientY);
      if (ativo) mover(e.clientX, e.clientY);
    };
    const pu = () => !toque && terminar(true);
    const pc = () => !toque && terminar(false);
    const tm = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (!ativo) {
        if (Math.hypot(t.clientX - x0, t.clientY - y0) > 8) terminar(false); // é rolagem, não arraste
        return;
      }
      e.preventDefault();
      mover(t.clientX, t.clientY);
    };
    const te = () => terminar(true);
    const segurar = toque ? window.setTimeout(() => comecar(x0, y0), 300) : 0;
    window.addEventListener('pointermove', pm);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointercancel', pc);
    if (toque) {
      window.addEventListener('touchmove', tm, { passive: false });
      window.addEventListener('touchend', te);
    }
  };

  // durante o arraste não seleciona texto
  useEffect(() => {
    document.body.classList.toggle('arrastando', !!arraste);
    return () => document.body.classList.remove('arrastando');
  }, [arraste]);
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
            {ABA_COL[c]} · {grupos[c].length}
          </button>
        ))}
      </div>

      <div className={`kanban${arraste ? ' em-arraste' : ''}`} ref={kanban}>
        {COLS.map((c) => {
          const lista = c === 'expedido' ? grupos[c].slice(0, 8) : grupos[c];
          const vol = grupos[c].reduce((s, p) => s + volumePedido(p), 0);
          const aceita = arraste && DESTINO[arraste.de] === c;
          const cls = arraste ? (aceita ? ' aceita' : c === arraste.de ? '' : ' recusa') + (sobre === c && c !== arraste.de ? ' sobre' : '') : '';
          return (
            <section key={c} data-col={c} className={`col${colMob === c ? ' show' : ''}${cls}`} aria-label={STATUS_PED[c].label}>
              <div className="col-head">
                <span className="dot" style={{ background: STATUS_PED[c].cor }} />
                <h3>{STATUS_PED[c].label}</h3>
                <span className="n">{grupos[c].length}</span>
                {c !== 'expedido' && <span className="vol">{fmtVol(vol)}</span>}
              </div>
              {aceita && <div className="col-solte">{c === 'fila' ? 'Solte para abrir a análise e liberar' : 'Solte para marcar como expedido'}</div>}
              {lista.map((p) => (
                <CardPedido
                  key={p.id}
                  p={p}
                  pos={c === 'expedido' || c === 'pronto' ? null : posFila(p.id)}
                  arrastando={arraste?.p.id === p.id}
                  onPointerDown={(ev) => iniciarArraste(ev, p, c)}
                  onClick={() => !arrastou.current && abrirPedido(p.id)}
                />
              ))}
              {c === 'expedido' && grupos[c].length > 8 && <div className="col-mais">e mais {grupos[c].length - 8} expedidos</div>}
              {!lista.length && <div className="col-vazio">{q ? 'Nenhum pedido com essa busca.' : VAZIO_COL[c]}</div>}
            </section>
          );
        })}
      </div>
      {arraste && (
        <div className="pcard-fantasma" style={{ left: arraste.x - arraste.ox, top: arraste.y - arraste.oy, width: arraste.w }} aria-hidden="true">
          <CardPedido p={arraste.p} pos={null} onClick={() => {}} />
        </div>
      )}
      {importar && <ImportarModal onClose={() => setImportar(false)} />}
    </main>
  );
}

function CardPedido({ p, pos, onClick, onPointerDown, arrastando }: { p: Pedido; pos: number | null; onClick: () => void; onPointerDown?: (ev: React.PointerEvent<HTMLElement>) => void; arrastando?: boolean }) {
  const { e, agenda, agora } = useApp();
  const st = statusPedido(e, p);
  const est = agenda.pedidos.get(p.id);
  const pr = situacaoPrazo(e, p, est, agora);
  return (
    <button
      className={`pcard${pr.tipo === 'atrasado' && st !== 'expedido' ? ' late' : ''}${arrastando ? ' origem' : ''}${DESTINO[st] ? ' movel' : ''}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
      title={DESTINO[st] ? (st === 'pcp' ? 'Clique para analisar · arraste para a Fila para liberar' : 'Arraste para Expedido para marcar como expedido') : undefined}
    >
      <div className="pcard-top">
        {pos && <span className="prio" title="Posição na fila de prioridade">{pos}º</span>}
        <span className="nped">#{p.numero}</span>
        <span className="sp">{fmtVol(volumePedido(p))}</span>
      </div>
      <div className="cli">{titulo(p.fantasia)}</div>
      <div className="meta">
        <span>{titulo(p.cidade)}/{p.uf}</span>
        <span>{p.itens.length} {p.itens.length === 1 ? 'item' : 'itens'}</span>
        <span>{titulo(p.vendedor.split(' ')[0])}</span>
      </div>
      {(st === 'fila' || st === 'producao') && <ProgressoOPs e={e} p={p} />}
      <div className="est">
        {st === 'pcp' ? (
          <span>aguarda o PCP</span>
        ) : (
          <span>
            {st === 'pronto' || st === 'expedido' ? '' : 'Estimativa '}
            <b>{estimativaTexto(e, p, est, agora)}</b>
          </span>
        )}
        {st !== 'expedido' && <PrazoChip p={p} />}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------ importação */

type Lido = { arquivo: string; ped?: PedidoLido; erro?: string };

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
        out.push({ arquivo: f.name, erro: 'O arquivo não é PDF.' });
        continue;
      }
      try {
        const ped = lerPedido(await textosDoPdf(f));
        if (!ped.numero || !ped.itens.length) throw new Error('Não encontrei o número ou os itens. Confira se é o PDF de Pedido de Venda do ERP.');
        out.push({ arquivo: f.name, ped });
      } catch (err: any) {
        out.push({ arquivo: f.name, erro: err?.message ?? 'Não foi possível ler o PDF.' });
      }
    }
    setLidos((x) => [...x, ...out]);
    setLendo(false);
  }

  const existentes = new Set(e.pedidos.map((p) => p.numero));
  // prazo conta a partir de hoje, dia em que o pedido entra no sistema
  const prazoNovo = somarDiasUteis(agora, e.config.prazoDiasUteis, e.config.feriados);
  const validos = lidos.filter((l) => l.ped && !existentes.has(l.ped.numero));

  async function confirmar() {
    setEnviando(true);
    let novosProd = 0;
    const ok = await executar(async () => {
      const r = await api.importar(validos.map((l) => ({ pedido: l.ped! })));
      novosProd = r.novosProdutos;
      return r;
    });
    setEnviando(false);
    if (!ok) return;
    toast({
      texto: `${validos.length} pedido(s) importado(s) e enviados para o PCP${novosProd ? ` · ${novosProd} produto(s) novo(s) sem lote e tempo` : ''}`,
      tipo: 'ok',
    });
    onClose();
  }

  return (
    <Modal onClose={onClose} wide label="Importar pedidos">
      <div className="modal-topo">
        <div><h2>Importar pedidos do PDF</h2></div>
        <button className="btn ghost icon" onClick={onClose} aria-label="Fechar">
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
        <span>O sistema lê o cliente e todos os itens, mesmo em pedidos com várias páginas. O prazo é de {e.config.prazoDiasUteis} dias úteis a partir de hoje.</span>
        <button className="btn" onClick={() => inp.current?.click()} disabled={lendo}>
          Escolher arquivos
        </button>
        <input ref={inp} id="arquivo-pdf" type="file" accept="application/pdf,.pdf" multiple hidden onChange={(ev) => ev.target.files && ler(ev.target.files)} />
      </div>

      {lidos.map((l, k) => {
        if (!l.ped)
          return (
            <div key={k} className="aviso crit">
              <Icon n="alert" s={14} /> <span>{l.arquivo}: {l.erro}</span>
            </div>
          );
        const ped = l.ped;
        const dup = existentes.has(ped.numero);
        const vol = ped.itens.reduce((s, i) => s + i.qtde * i.embalagem, 0);
        const prods = [...new Set(ped.itens.map((i) => i.produtoId))];
        const novos = prods.filter((id) => !e.produtos[id]);
        return (
          <div key={k} className="panel imp-ped">
            <div className="imp-topo">
              <span className="mono" style={{ fontWeight: 600, fontSize: 15 }}>#{ped.numero}</span>
              <b style={{ fontSize: 15 }}>{titulo(ped.fantasia || ped.cliente)}</b>
              {dup ? <span className="chip crit">Já existe no sistema</span> : <span className="chip ok"><Icon n="check" s={12} w={2.6} /> Lido</span>}
              <span className="arq">{l.arquivo}</span>
            </div>
            <dl className="kv">
              <div><dt>Cliente</dt><dd>{titulo(ped.cliente)}</dd></div>
              <div><dt>Cidade</dt><dd>{titulo(ped.cidade)}/{ped.uf}</dd></div>
              <div><dt>Vendedor</dt><dd>{titulo(ped.vendedor)}</dd></div>
              <div><dt>Emissão</dt><dd>{dataISOparaBR(ped.emissao)} {ped.hora.slice(0, 5)}</dd></div>
              <div><dt>Itens / volume</dt><dd className="num">{ped.itens.length} · {fmtVol(vol)}</dd></div>
              <div>
                <dt>Prazo de entrega</dt>
                <dd>{dataISOparaBR(prazoNovo)} <span className="muted" style={{ fontWeight: 500 }}>({e.config.prazoDiasUteis} dias úteis)</span></dd>
              </div>
            </dl>
            {novos.length > 0 && (
              <div className="aviso">
                <Icon n="info" s={14} /> <span>{novos.length} produto(s) novo(s) no cadastro. Entram sem lote e tempo; o PCP informa na análise antes de liberar.</span>
              </div>
            )}
            <div className="scroll-x imp-itens">
              <table className="t">
                <thead>
                  <tr><th style={{ width: 90 }}>Código</th><th>Descrição</th><th style={{ width: 130 }}>Cód. fab.</th><th className="r" style={{ width: 130 }}>Qtde</th><th className="r" style={{ width: 100 }}>Volume</th></tr>
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
  const [aba, setAba] = useState<'analise' | 'detalhes'>('analise');
  const p = e.pedidos.find((x) => x.id === pedidoAberto);
  if (!p) return null;
  const st = statusPedido(e, p);
  // pedido aguardando o PCP abre direto na análise (decidir estoque/OP e liberar)
  const analise = st === 'pcp' && aba === 'analise';
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
      <aside className={`drawer${st === 'pcp' ? ' largo' : ''}`} role="dialog" aria-modal="true" aria-label={`Pedido ${p.numero}`}>
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontWeight: 600 }}>Pedido #{p.numero}</span>
              <span className="chip" style={{ color: STATUS_PED[st].cor }}>{STATUS_PED[st].label}</span>
              {st === 'pcp' && <PrazoChip p={p} />}
            </div>
            <h2>{titulo(p.fantasia)}</h2>
            <div className="muted" style={{ fontSize: 12.5 }}>{titulo(p.cliente)}</div>
            {st === 'pcp' && (
              <div className="seg drawer-abas" role="tablist" aria-label="Ver">
                <button role="tab" aria-pressed={aba === 'analise'} aria-selected={aba === 'analise'} onClick={() => setAba('analise')}>Análise do PCP</button>
                <button role="tab" aria-pressed={aba === 'detalhes'} aria-selected={aba === 'detalhes'} onClick={() => setAba('detalhes')}>Detalhes e histórico</button>
              </div>
            )}
          </div>
          <button className="btn ghost icon" onClick={fechar} aria-label="Fechar">
            <Icon n="x" />
          </button>
        </div>
        {analise ? (
          <div className="drawer-body">
            <AnalisePCP p={p} />
          </div>
        ) : (
        <div className="drawer-body">
          {/* faixa principal: quando fica pronto, o prazo e a ação do momento */}
          <div className="panel ped-faixa">
            <div className="ped-faixa-txt">
              <span className="eyebrow">{st === 'pronto' || st === 'expedido' ? 'Situação' : 'Fica pronto'}</span>
              <b className="num">{estimativaTexto(e, p, est, agora)}</b>
              <span className="ped-faixa-prazo">
                prazo {dataISOparaBR(prazoDoPedido(e, p)).slice(0, 5)}
                {st !== 'expedido' && <PrazoChip p={p} />}
              </span>
            </div>
            {podeEditar && ['pcp', 'fila', 'producao'].includes(st) && (
              <button className="btn" onClick={moverTopo}><Icon n="top" s={15} /> Prioridade máxima</button>
            )}
            {podeEditar && st === 'pronto' && (
              <button className="btn ok grande" onClick={expedir}><Icon n="truck" s={16} /> Marcar como expedido</button>
            )}
          </div>

          <p className="ped-info">
            <span>{titulo(p.cidade)}/{p.uf}</span>
            <span>{titulo(p.vendedor)}</span>
            <span>{titulo(p.transportadora)}</span>
            <span>entrou {quando(new Date(p.importadoEm), agora)}</span>
          </p>

          {/* uma lista só: cada produto com o volume e onde ele está (estoque ou OP) */}
          <div className="panel flush">
            <div className="panel-head">
              <h2>Produtos</h2>
              <span className="sp nota num">{grupos.size} produto{grupos.size === 1 ? '' : 's'} · {fmtVol(volumePedido(p))}</span>
            </div>
            <ul className="ped-prods">
              {[...grupos].map(([pid, its]) => {
                const decs = new Set(its.map((i) => i.decisao));
                const opsProd = ops.filter((o) => o.produtoId === pid);
                return (
                  <li key={pid}>
                    <div className="ped-prod-nome">
                      <b>{e.produtos[pid]?.nome ?? pid}</b>
                      <span className="mono">{its.map((i) => `${nf(i.qtde)}×${nf(i.embalagem, 1)}L`).join(' · ')}</span>
                    </div>
                    <span className="ped-prod-vol num">{fmtVol(its.reduce((s, i) => s + i.volume, 0))}</span>
                    <span className="ped-prod-st">
                      {decs.has('pendente') && <span className="chip warn">aguarda o PCP</span>}
                      {decs.has('estoque') && <span className="chip ok"><Icon n="box" s={12} /> do estoque</span>}
                      {decs.has('op') && !opsProd.length && <span className="chip info"><Icon n="flask" s={12} /> vai virar OP</span>}
                      {decs.has('op') && !opsProd.length && <span className="chip info"><Icon n="flask" s={12} /> vai virar OP</span>}
                      {opsProd.map((o) => {
                        const pv = agenda.ops.get(o.id);
                        return o.status === 'concluida' ? (
                          <span key={o.id} className="chip ok"><Icon n="check" s={12} w={2.6} /> OP {o.numero} pronta {quando(new Date(o.fim!), agora)}</span>
                        ) : o.status === 'producao' ? (
                          <span key={o.id} className={`chip ${pv?.atrasada ? 'crit' : 'info'}`}>OP {o.numero} produzindo{pv ? ` · até ${quando(pv.fim, agora)}` : ''}</span>
                        ) : (
                          <span key={o.id} className="chip">OP {o.numero} na fila{pv ? ` · começa ${quando(pv.inicio, agora)}` : ''}</span>
                        );
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <details className="ped-hist">
            <summary>Histórico do pedido <span className="muted">({p.eventos.length})</span></summary>
            <ol className="timeline">
              {[...p.eventos].reverse().map((ev, k) => (
                <li key={k} className={ev.tipo}>
                  <time>{quando(new Date(ev.em), agora)}</time>
                  <i />
                  <span>{ev.texto}</span>
                </li>
              ))}
            </ol>
          </details>

          {podeEditar && st !== 'expedido' && (
            <div>
              {confirmaExcluir ? (
                <div className="aviso crit" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ flex: '1 1 240px' }}>Excluir o pedido #{p.numero}? OPs ainda na fila deixam de atender este pedido.</span>
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
        </div>
        )}
      </aside>
    </>
  );
}

export type { Estado };
