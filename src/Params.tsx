import { useMemo, useState } from 'react';
import { CamposParam } from './ParamProduto';
import { temParametros } from '../shared/engine';
import { useApp } from './store';
import { Icon } from './ui';
import { LINHAS, nomeLinha } from '../shared/catalog';
import { dataISOparaBR, diaSemana, fmtDur, nf } from '../shared/fmt';
import type { Produto } from '../shared/types';
import { api } from './api';
import { deISOlocal } from '../shared/tz';
import { pode } from './store';

export function ParamsView() {
  const { e, executar, perfil } = useApp();
  const [linha, setLinha] = useState('');
  const [q, setQ] = useState('');
  const [novaData, setNovaData] = useState('');
  const podeEditar = pode.parametros(perfil);
  const config = (patch: Parameters<typeof api.config>[0], msg?: string) => executar(() => api.config(patch), msg);

  const prods = useMemo(
    () =>
      Object.values(e.produtos)
        .filter((p) => (!linha || p.linha === linha) && (!q || `${p.id} ${p.nome}`.toLowerCase().includes(q.toLowerCase())))
        .sort((a, b) => Number(!temParametros(b)) - Number(!temParametros(a)) || a.id.localeCompare(b.id, 'pt-BR', { numeric: true })),
    [e.produtos, linha, q],
  );
  const pendentes = Object.values(e.produtos).filter((p) => !temParametros(p)).length;

  const atualizar = (p: Produto, patch: { lote: number; tempoMin: number }) =>
    executar(() => api.produto(p.id, patch), `${p.nome}: parâmetros salvos. Estimativas recalculadas.`);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Parâmetros</h1>
          <p>Tamanho do lote e tempo padrão de cada produto, informados pelo PCP. Produto novo entra sem valores e aparece no topo como “sem parâmetro”; pedidos que precisam produzi-lo só são liberados depois de preenchido.</p>
        </div>
      </div>
      <div className="params-grid">
        <section className="panel" style={{ padding: 0 }}>
          <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
            <label className="search">
              <Icon n="search" s={15} />
              <span className="sr">Buscar produto</span>
              <input id="busca-prod" className="input" placeholder="Código ou nome" value={q} onChange={(ev) => setQ(ev.target.value)} />
            </label>
            <select id="param-linha" className="select" value={linha} onChange={(ev) => setLinha(ev.target.value)} aria-label="Linha">
              <option value="">Todas as linhas</option>
              {Object.keys(LINHAS).map((l) => <option key={l} value={l}>{nomeLinha(l)}</option>)}
            </select>
            {pendentes > 0 && <span className="chip warn">{pendentes} produto(s) sem lote ou tempo</span>}
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{prods.length} produtos</span>
          </div>
          <div className="scroll-x" style={{ maxHeight: 640, overflowY: 'auto' }}>
            <table className="t">
              <thead>
                <tr><th>Código base</th><th>Produto</th><th>Linha</th><th className="r">Lote (L)</th><th className="r">Tempo por lote (h:mm)</th><th className="r">L/hora</th></tr>
              </thead>
              <tbody>
                {prods.map((p) => (
                  <LinhaProduto key={p.id} p={p} pode={podeEditar} onSalvar={(patch) => atualizar(p, patch)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="panel">
            <div className="panel-head"><h2>Capacidade para a estimativa</h2></div>
            <p className="fg2" style={{ margin: '0 0 12px', fontSize: 13 }}>
              Quantas OPs a fábrica costuma tocar ao mesmo tempo. É só para calcular a previsão: quem decide o que começa é o gerente.
            </p>
            <div className="stepper">
              <button aria-label="Diminuir" disabled={!podeEditar || e.config.capacidade <= 1} onClick={() => config({ capacidade: e.config.capacidade - 1 })}>−</button>
              <span>{e.config.capacidade}</span>
              <button aria-label="Aumentar" disabled={!podeEditar || e.config.capacidade >= 12} onClick={() => config({ capacidade: e.config.capacidade + 1 })}>+</button>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Prazo de entrega</h2></div>
            <p className="fg2" style={{ margin: '0 0 12px', fontSize: 13 }}>
              Dias úteis contados a partir do dia em que o pedido entra no sistema (o próprio dia não conta). Vale para todos os pedidos, inclusive os que já estão abertos.
            </p>
            <div className="stepper">
              <button aria-label="Diminuir prazo" disabled={!podeEditar || e.config.prazoDiasUteis <= 1} onClick={() => config({ prazoDiasUteis: e.config.prazoDiasUteis - 1 })}>−</button>
              <span>{e.config.prazoDiasUteis}</span>
              <button aria-label="Aumentar prazo" disabled={!podeEditar || e.config.prazoDiasUteis >= 60} onClick={() => config({ prazoDiasUteis: e.config.prazoDiasUteis + 1 })}>+</button>
            </div>
            <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>dias úteis</span>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Tolerância de atraso</h2></div>
            <p className="fg2" style={{ margin: '0 0 10px', fontSize: 13 }}>Acima disso o gerente informa o motivo ao finalizar.</p>
            <div className="seg" role="group" aria-label="Tolerância">
              {[5, 10, 15, 20, 30].map((t) => (
                <button key={t} aria-pressed={e.config.toleranciaPct === t} disabled={!podeEditar} onClick={() => config({ toleranciaPct: t })}>{t}%</button>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Expediente</h2></div>
            <dl className="kv" style={{ margin: 0, gridTemplateColumns: '1fr' }}>
              <div><dt>Produção e expedição</dt><dd>Seg a sex · 07:30–12:00 e 13:12–17:30 ({fmtDur(528)} por dia)</dd></div>
              <div><dt>Escritório</dt><dd>Seg a sex · 08:00–17:30</dd></div>
            </dl>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Feriados</h2><span className="sp muted" style={{ fontSize: 12 }}>não contam na previsão</span></div>
            <div className="fer">
              {[...e.config.feriados].sort().map((f) => (
                <div key={f}>
                  <span className="num">{dataISOparaBR(f)} · {diaSemana(deISOlocal(f, '12:00'))}</span>
                  {podeEditar && (
                    <button className="btn ghost sm" aria-label={`Remover ${dataISOparaBR(f)}`} onClick={() => config({ feriados: e.config.feriados.filter((x) => x !== f) }, `Feriado ${dataISOparaBR(f)} removido.`)}>
                      <Icon n="x" s={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {podeEditar && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input id="novo-feriado" type="date" className="input" value={novaData} onChange={(ev) => setNovaData(ev.target.value)} style={{ flex: 1 }} />
                <button className="btn" disabled={!novaData || e.config.feriados.includes(novaData)} onClick={async () => { if (await config({ feriados: [...e.config.feriados, novaData] }, `Feriado ${dataISOparaBR(novaData)} adicionado.`)) setNovaData(''); }}>Adicionar</button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function LinhaProduto({ p, pode, onSalvar }: { p: Produto; pode: boolean; onSalvar: (x: { lote: number; tempoMin: number }) => void }) {
  const falta = !temParametros(p);
  return (
    <tr className={falta ? 'sem-param' : undefined}>
      <td className="mono">{p.id}</td>
      <td>{p.nome} {falta && <span className="chip warn">sem parâmetro</span>}</td>
      <td className="fg2" style={{ whiteSpace: 'nowrap' }}>{nomeLinha(p.linha)}</td>
      <td className="r" colSpan={2}>
        <span className="param-campos"><CamposParam p={p} pode={pode} onSalvar={onSalvar} /></span>
      </td>
      <td className="r num muted">{temParametros(p) ? nf(p.lote / (p.tempoMin / 60)) : '—'}</td>
    </tr>
  );
}
