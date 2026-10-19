import { useMemo, useState } from 'react';
import { useApp } from './store';
import { Icon, PedChips, nomeOP } from './ui';
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
            {FILTROS.map((x) => <button key={x.k} aria-pressed={f === x.k} onClick={() => setF(x.k)}>{x.l}</button>)}
          </div>
        </div>
      </div>
      <section className="panel" style={{ padding: 0 }}>
        <div className="scroll-x">
          <table className="t">
            <thead>
              <tr>
                <th>OP</th><th>Produto</th><th className="r">Lote</th><th className="r">Alocado</th><th>Pedidos</th><th>Situação</th>
                <th>{f === 'concluida' ? 'Início' : 'Início (prev.)'}</th><th>{f === 'concluida' ? 'Fim' : 'Fim (prev.)'}</th><th className="r">Padrão</th><th className="r">Real</th>
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
                    <td className="mono">{o.numero}</td>
                    <td style={{ minWidth: 220 }}>{nomeOP(e, o)}<div className="mono muted" style={{ fontSize: 11 }}>{o.produtoId}</div></td>
                    <td className="r num">{fmtVol(o.lote)}</td>
                    <td className="r num">{nf((al / o.lote) * 100)}%</td>
                    <td><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}><PedChips e={e} o={o} /></div></td>
                    <td>
                      {o.status === 'concluida' ? (
                        <span className="chip ok">Concluída</span>
                      ) : o.status === 'producao' ? (
                        <span className={`chip ${pv?.atrasada ? 'crit' : 'info'}`}>{pv?.atrasada ? 'Acima do tempo' : 'Em produção'}</span>
                      ) : (
                        <span className="chip">Na fila</span>
                      )}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{ini ? quando(ini, agora) : '—'}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{fim ? quando(fim, agora) : '—'}</td>
                    <td className="r num">{fmtDur(o.tempoPadraoMin)}</td>
                    <td className="r num">
                      {o.realMin !== undefined ? (
                        <span style={{ color: o.realMin > o.tempoPadraoMin * tol ? 'var(--crit)' : 'var(--ok)', fontWeight: 650 }}>{fmtDur(o.realMin)}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!lista.length && <tr><td colSpan={10} className="empty">Nenhuma OP neste filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
