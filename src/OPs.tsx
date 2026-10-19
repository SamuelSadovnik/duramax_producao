import { useMemo, useState } from 'react';
import { useApp } from './store';
import { Icon, PedChips, Vazio, nomeOP } from './ui';
import { alocado, chavePrioridade } from '../shared/engine';
import { fmtDur, fmtVol, nf, quando } from '../shared/fmt';
import type { StatusOP } from '../shared/types';

const FILTROS: { k: StatusOP | 'abertas'; l: string }[] = [
  { k: 'abertas', l: 'Abertas' },
  { k: 'producao', l: 'Em produção' },
  { k: 'fila', l: 'Na fila' },
  { k: 'concluida', l: 'Concluídas' },
];

export function OPsView() {
  const { e, agenda, agora } = useApp();
  const [f, setF] = useState<StatusOP | 'abertas'>('abertas');
  const [q, setQ] = useState('');
  const tol = 1 + e.config.toleranciaPct / 100;
  const lista = useMemo(() => {
    const k = chavePrioridade(e);
    const ql = q.toLowerCase();
    return e.ops
      .filter((o) => (f === 'abertas' ? o.status !== 'concluida' : o.status === f))
      .filter((o) => !ql || `${o.numero} ${nomeOP(e, o)}`.toLowerCase().includes(ql))
      .sort((a, b) => {
        if (f === 'concluida') return b.fim!.localeCompare(a.fim!);
        const ra = a.status === 'producao' ? -1 : 0;
        const rb = b.status === 'producao' ? -1 : 0;
        return ra - rb || (agenda.ops.get(a.id)?.inicio.getTime() ?? 0) - (agenda.ops.get(b.id)?.inicio.getTime() ?? 0) || k(a) - k(b);
      })
      .slice(0, f === 'concluida' ? 80 : 999);
  }, [e, f, q, agenda]);

  const contagem = {
    abertas: e.ops.filter((o) => o.status !== 'concluida').length,
    producao: e.ops.filter((o) => o.status === 'producao').length,
    fila: e.ops.filter((o) => o.status === 'fila').length,
    concluida: e.ops.filter((o) => o.status === 'concluida').length,
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Ordens de produção</h1>
          <p>Cada OP é um lote de um produto (linha + cor). Uma OP pode atender vários pedidos; a sobra do lote vai para o estoque.</p>
        </div>
        <div className="acts">
          <label className="search">
            <Icon n="search" s={15} />
            <span className="sr">Buscar OP</span>
            <input id="busca-op" className="input" placeholder="Nº da OP ou produto" value={q} onChange={(ev) => setQ(ev.target.value)} />
          </label>
          <div className="seg" role="group" aria-label="Situação">
            {FILTROS.map((x) => (
              <button key={x.k} aria-pressed={f === x.k} onClick={() => setF(x.k)}>
                {x.l} <span className="muted num">{contagem[x.k]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <section className="panel flush">
        <div className="scroll-x">
          <table className="t cartoes-tab" style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th style={{ width: 64 }}>OP</th>
                <th>Produto</th>
                <th className="r" style={{ width: 90 }}>Lote</th>
                <th className="r hide-tab" style={{ width: 90 }}>Alocado</th>
                <th style={{ width: 200 }}>Pedidos</th>
                <th style={{ width: 150 }}>Situação</th>
                <th className="hide-tab" style={{ width: 140 }}>{f === 'concluida' ? 'Início' : 'Início (prev.)'}</th>
                <th style={{ width: 140 }}>{f === 'concluida' ? 'Fim' : 'Fim (prev.)'}</th>
                <th className="r" style={{ width: 84 }}>Padrão</th>
                <th className="r" style={{ width: 84 }}>Real</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((o) => {
                const pv = agenda.ops.get(o.id);
                const ini = o.inicio ? new Date(o.inicio) : pv?.inicio;
                const fim = o.fim ? new Date(o.fim) : pv?.fim;
                const al = alocado(o);
                return (
                  <tr key={o.id}>
                    <td className="mono cel-oculta">{o.numero}</td>
                    <td className="cel-tit">
                      <span className="nome">{nomeOP(e, o)}</span>
                      <span className="sub mono">{o.produtoId}<span className="so-cel"> · OP {o.numero}</span></span>
                    </td>
                    <td className="r num nw" data-l="Lote">{fmtVol(o.lote)}</td>
                    <td className="r num hide-tab" data-l="Alocado">{nf((al / o.lote) * 100)}%</td>
                    <td data-l="Pedidos"><div className="chips"><PedChips e={e} o={o} max={2} /></div></td>
                    <td data-l="Situação">
                      {o.status === 'concluida' ? (
                        <span className="chip ok">Concluída</span>
                      ) : o.status === 'producao' ? (
                        <span className={`chip ${pv?.atrasada ? 'crit' : 'info'}`}>{pv?.atrasada ? 'Acima do tempo' : 'Em produção'}</span>
                      ) : (
                        <span className="chip">Na fila</span>
                      )}
                    </td>
                    <td className="num nw hide-tab" data-l={f === 'concluida' ? 'Início' : 'Início (prev.)'}>{ini ? quando(ini, agora) : '—'}</td>
                    <td className="num nw" data-l={f === 'concluida' ? 'Fim' : 'Fim (prev.)'}>{fim ? quando(fim, agora) : '—'}</td>
                    <td className="r num" data-l="Padrão">{fmtDur(o.tempoPadraoMin)}</td>
                    <td className="r num" data-l="Real">
                      {o.realMin !== undefined ? (
                        <span style={{ color: o.realMin > o.tempoPadraoMin * tol ? 'var(--crit)' : 'var(--ok)', fontWeight: 650 }}>{fmtDur(o.realMin)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!lista.length && (
                <tr>
                  <td colSpan={10} className="vazio-td">
                    <Vazio icone="ops" titulo={q ? 'Nenhuma OP com essa busca' : 'Nenhuma OP aqui'}>
                      {q ? 'Confira o número ou o nome do produto.' : 'As OPs aparecem quando o PCP libera um pedido.'}
                    </Vazio>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
