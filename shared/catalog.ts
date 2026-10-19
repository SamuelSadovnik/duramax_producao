export const LINHAS: Record<string, string> = {
  '600': 'Durafort Metais',
  '610': 'Durafort DF Pisos',
  '400': 'Diluentes',
  '800': 'Epóxi e Catalisadores',
  '200': 'Demarcação Viária',
};

export const nomeLinha = (l: string) => LINHAS[l] ?? `Linha ${l}`;

const MANTER = new Set(['DF', 'BR', 'SB', 'FC', 'RAL', 'HS', 'PU', 'UV']);
const MINUSC = new Set(['DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'P/', 'COM']);

export function tituloProduto(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      if (MANTER.has(w) || /\d/.test(w)) return w;
      if (i > 0 && MINUSC.has(w)) return w.toLowerCase();
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Volume da embalagem: primeiro pela descrição, depois pelo sufixo do código de fábrica. */
const SUFIXO: Record<string, number> = { '1': 0.9, '01': 0.9, '4': 3.6, '18': 18, '5': 5, '27': 2.7, '9': 0.9 };

export function embalagemDe(descricao: string, codFab: string): number {
  const m = [...descricao.matchAll(/(\d+(?:,\d+)?)\s*(L|KG|ML)\b/gi)].pop();
  if (m) {
    const v = parseFloat(m[1].replace(',', '.'));
    return m[2].toUpperCase() === 'ML' ? v / 1000 : v;
  }
  const tail = descricao.trim().match(/(\d+(?:,\d+)?)\s*-?$/);
  if (tail) return parseFloat(tail[1].replace(',', '.'));
  const suf = codFab.split('.').pop() ?? '';
  return SUFIXO[suf] ?? 1;
}

export function nomeBase(descricao: string): string {
  let s = descricao.replace(/\s+-\s*$/, '').replace(/-\s*$/, '').trim();
  s = s.replace(/\s*\d+(?:,\d+)?\s*(L|KG|ML)\s*-?\s*$/i, '').trim();
  s = s.replace(/\s+\d+(?:,\d+)?\s*$/, '').trim(); // "PRETO BR 0,9"
  return tituloProduto(s);
}

export const baseDe = (codFab: string) => codFab.split('.').slice(0, -1).join('.') || codFab;
