import { useEffect, useState } from 'react';
import { hmParaMin, minParaHM } from '../shared/fmt';
import type { Produto } from '../shared/types';

/** Campos de lote (L) e tempo por lote (h:mm). Só grava quando os dois estão preenchidos e válidos. */
export function useParamProduto(p: Produto, onSalvar: (x: { lote: number; tempoMin: number }) => void) {
  const [lote, setLote] = useState(p.lote ? String(p.lote) : '');
  const [tempo, setTempo] = useState(p.tempoMin ? minParaHM(p.tempoMin) : '');
  // se outra pessoa alterar, mostra o valor novo
  useEffect(() => {
    setLote(p.lote ? String(p.lote) : '');
    setTempo(p.tempoMin ? minParaHM(p.tempoMin) : '');
  }, [p.lote, p.tempoMin]);
  const loteN = parseFloat(lote.replace(',', '.'));
  const tempoN = hmParaMin(tempo);
  const okLote = loteN > 0;
  const okTempo = tempoN !== null && tempoN > 0;
  const mudou = loteN !== p.lote || tempoN !== p.tempoMin;
  const salvar = () => {
    if (okLote && okTempo && mudou) onSalvar({ lote: loteN, tempoMin: tempoN! });
  };
  return { lote, setLote, tempo, setTempo, okLote, okTempo, loteN, tempoN, mudou, salvar };
}

export function CamposParam({ p, pode, onSalvar, comBotao }: { p: Produto; pode: boolean; onSalvar: (x: { lote: number; tempoMin: number }) => void; comBotao?: boolean }) {
  const f = useParamProduto(p, onSalvar);
  const tecla = (ev: React.KeyboardEvent) => ev.key === 'Enter' && f.salvar();
  return (
    <>
      <input
        id={`lote-${p.id}${comBotao ? '-pcp' : ''}`}
        aria-label={`Lote de ${p.nome} (litros)`}
        className={`cell-in${f.lote && !f.okLote ? ' bad' : ''}`}
        value={f.lote}
        placeholder="lote (L)"
        disabled={!pode}
        inputMode="decimal"
        onChange={(ev) => f.setLote(ev.target.value)}
        onBlur={comBotao ? undefined : f.salvar}
        onKeyDown={tecla}
      />
      <input
        id={`tempo-${p.id}${comBotao ? '-pcp' : ''}`}
        aria-label={`Tempo por lote de ${p.nome} (h:mm)`}
        className={`cell-in${f.tempo && !f.okTempo ? ' bad' : ''}`}
        value={f.tempo}
        placeholder="h:mm"
        disabled={!pode}
        onChange={(ev) => f.setTempo(ev.target.value)}
        onBlur={comBotao ? undefined : f.salvar}
        onKeyDown={tecla}
      />
      {comBotao && pode && (
        <button className="btn sm pri" disabled={!f.okLote || !f.okTempo || !f.mudou} onClick={f.salvar}>
          Salvar
        </button>
      )}
    </>
  );
}
