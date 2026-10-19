import { useMemo, useState } from 'react';
import { useParamProduto } from './ParamProduto';
import { temParametros } from '../shared/engine';
import { useApp } from './store';
import { Icon, Vazio } from './ui';
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
        <section className="panel flush">
          <div className="toolbar">
            <label className="search">
              <Icon n="search" s={15} />
              <span className="sr">Buscar produto</span>
              <input id="busca-prod" className="input" placeholder="Código ou nome" value={q} onChange={(ev) => setQ(ev.target.value)} />
            </label>
            <select id="param-linha" className="select" value={linha} onChange={(ev) => setLinha(ev.target.value)} aria-label="Linha">
              <option value="">Todas as linhas</option>
              {Object.keys(LINHAS).map((l) => <option key={l} value={l}>{nomeLinha(l)}</option>)}
            </select>
            {pendentes > 0 && <span className="chip warn"><Icon n="alert" s={12} /> {pendentes} sem lote ou tempo</span>}
            <span className="sp nota num">{prods.length} produto{prods.length === 1 ? '' : 's'}</span>
          </div>
          <div className="params-tab">
            <table className="t cartoes" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Código base</th>
                  <th>Produto</th>
                  <th className="hide-tab" style={{ width: 190 }}>Linha</th>
                  <th className="r" style={{ width: 124 }}>Lote (L)</th>
                  <th className="r" style={{ width: 136 }}>Tempo por lote</th>
                  <th className="r" style={{ width: 84 }}>L/hora</th>
                </tr>
              </thead>
              <tbody>
                {prods.map((p) => (
                  <LinhaProduto key={p.id} p={p} pode={podeEditar} onSalvar={(patch) => atualizar(p, patch)} />
                ))}
                {!prods.length && (
                  <tr>
                    <td colSpan={6} className="vazio-td">
                      <Vazio compacto icone="search" titulo="Nenhum produto encontrado">Mude a busca ou a linha.</Vazio>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="params-lado">
          <section className="panel">
            <div className="panel-head"><h2>Capacidade para a estimativa</h2></div>
            <p className="panel-desc">
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
            <p className="panel-desc">
              Dias úteis contados a partir do dia em que o pedido entra no sistema (o próprio dia não conta). Vale para todos os pedidos, inclusive os que já estão abertos.
            </p>
            <div className="linha-ctl">
              <div className="stepper">
                <button aria-label="Diminuir prazo" disabled={!podeEditar || e.config.prazoDiasUteis <= 1} onClick={() => config({ prazoDiasUteis: e.config.prazoDiasUteis - 1 })}>−</button>
                <span>{e.config.prazoDiasUteis}</span>
                <button aria-label="Aumentar prazo" disabled={!podeEditar || e.config.prazoDiasUteis >= 60} onClick={() => config({ prazoDiasUteis: e.config.prazoDiasUteis + 1 })}>+</button>
              </div>
              <span className="muted">dias úteis</span>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Tolerância de atraso</h2></div>
            <p className="panel-desc">Acima disso o gerente informa o motivo ao finalizar.</p>
            <div className="seg" role="group" aria-label="Tolerância">
              {[5, 10, 15, 20, 30].map((t) => (
                <button key={t} aria-pressed={e.config.toleranciaPct === t} disabled={!podeEditar} onClick={() => config({ toleranciaPct: t })}>{t}%</button>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Expediente</h2></div>
            <dl className="kv uma">
              <div><dt>Produção e expedição</dt><dd>Seg a sex · 07:30–12:00 e 13:12–17:30 ({fmtDur(528)} por dia)</dd></div>
              <div><dt>Escritório</dt><dd>Seg a sex · 08:00–17:30</dd></div>
            </dl>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Feriados</h2><span className="sp nota">não contam na previsão</span></div>
            <div className="fer">
              {[...e.config.feriados].sort().map((f) => (
                <div key={f}>
                  <span className="num">{dataISOparaBR(f)} · {diaSemana(deISOlocal(f, '12:00'))}</span>
                  {podeEditar && (
                    <button className="btn ghost sm icon" aria-label={`Remover ${dataISOparaBR(f)}`} onClick={() => config({ feriados: e.config.feriados.filter((x) => x !== f) }, `Feriado ${dataISOparaBR(f)} removido.`)}>
                      <Icon n="x" s={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {podeEditar && (
              <div className="linha-ctl" style={{ marginTop: 12 }}>
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
  const f = useParamProduto(p, onSalvar);
  const tecla = (ev: React.KeyboardEvent) => ev.key === 'Enter' && f.salvar();
  return (
    <tr className={falta ? 'sem-param' : undefined}>
      <td className="mono nw cel-oculta">{p.id}</td>
      <td className="cel-tit">
        <span className="nome">{p.nome}</span>
        <span className="sub"><span className="mono so-cel">{p.id} · </span>{falta ? <b style={{ color: 'var(--warn)' }}>sem lote e tempo</b> : <span className="so-tab">{nomeLinha(p.linha)}</span>}</span>
      </td>
      <td className="fg2 nw hide-tab">{nomeLinha(p.linha)}</td>
      <td className="r" data-l="Lote (L)">
        <input
          id={`lote-${p.id}`}
          aria-label={`Lote de ${p.nome} (litros)`}
          className={`cell-in${f.lote && !f.okLote ? ' bad' : ''}`}
          value={f.lote}
          placeholder="litros"
          disabled={!pode}
          inputMode="decimal"
          onChange={(ev) => f.setLote(ev.target.value)}
          onBlur={f.salvar}
          onKeyDown={tecla}
        />
      </td>
      <td className="r" data-l="Tempo por lote">
        <input
          id={`tempo-${p.id}`}
          aria-label={`Tempo por lote de ${p.nome} (h:mm)`}
          className={`cell-in${f.tempo && !f.okTempo ? ' bad' : ''}`}
          value={f.tempo}
          placeholder="h:mm"
          disabled={!pode}
          onChange={(ev) => f.setTempo(ev.target.value)}
          onBlur={f.salvar}
          onKeyDown={tecla}
        />
      </td>
      <td className="r num muted nw cel-oculta">{temParametros(p) ? nf(p.lote / (p.tempoMin / 60)) : '—'}</td>
    </tr>
  );
}
