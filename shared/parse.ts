import { baseDe, embalagemDe, nomeBase } from './catalog.js';

export interface TItem { str: string; x: number; y: number }

export interface ItemLido {
  codigo: string;
  descricao: string;
  codFab: string;
  qtde: number;
  embalagem: number;
  produtoId: string;
  produtoNome: string;
}

export interface PedidoLido {
  numero: string;
  cliente: string;
  fantasia: string;
  cidade: string;
  uf: string;
  vendedor: string;
  transportadora: string;
  emissao: string;
  previsao: string;
  hora: string;
  itens: ItemLido[];
  avisos: string[];
}

const num = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'));
const dataISO = (s: string) => {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

function valorApos(items: TItem[], label: string, maxX = 9999): string {
  const l = items.find((i) => i.str.trim() === label);
  if (!l) return '';
  const cand = items
    .filter((i) => i !== l && Math.abs(i.y - l.y) < 3 && i.x > l.x && i.x < maxX && i.str.trim())
    .sort((a, b) => a.x - b.x);
  return cand[0]?.str.trim() ?? '';
}

const semCodigo = (s: string) => s.replace(/^\d+\s*-\s*/, '').trim();

/** Lê o pedido a partir dos textos posicionados de cada página (saída do pdf.js). */
export function lerPedido(paginas: TItem[][]): PedidoLido {
  const p1 = paginas[0] ?? [];
  const avisos: string[] = [];
  const todos = p1.map((i) => i.str).join(' ');
  const numero = (todos.match(/PEDIDO\s*N[ºo°]?\s*0*(\d+)/i)?.[1]) ?? '';
  if (!numero) avisos.push('Número do pedido não encontrado.');

  const ufLabel = p1.find((i) => i.str.trim() === 'UF');
  const uf = ufLabel ? valorApos(p1, 'UF', ufLabel.x + 60) : '';

  const ped: PedidoLido = {
    numero,
    cliente: valorApos(p1, 'Cliente:', 390),
    fantasia: valorApos(p1, 'Fantasia:', 390),
    cidade: valorApos(p1, 'Município:', 280),
    uf,
    vendedor: semCodigo(valorApos(p1, 'Vendedor:', 300)),
    transportadora: semCodigo(valorApos(p1, 'Transportadora:')),
    emissao: dataISO(valorApos(p1, 'Data Emissão:')),
    previsao: dataISO(valorApos(p1, 'Data Previsão:')),
    hora: valorApos(p1, 'Hora:'),
    itens: [],
    avisos,
  };

  for (const pg of paginas) ped.itens.push(...lerItensPagina(pg));
  if (!ped.itens.length) avisos.push('Nenhum item encontrado na tabela do pedido.');
  return ped;
}

function lerItensPagina(pg: TItem[]): ItemLido[] {
  const hCod = pg.find((i) => i.str.trim() === 'CÓDIGO');
  const hDesc = pg.find((i) => i.str.startsWith('DESCRIÇÃO'));
  const hFab = pg.find((i) => i.str.trim() === 'CÓD. FAB');
  const hQt = pg.find((i) => i.str.trim() === 'QTDE');
  const hVu = pg.find((i) => i.str.trim() === 'VR UNIT');
  const fim = pg.find((i) => i.str.trim().startsWith('VALOR BRUTO'));
  if (!hCod || !hDesc || !hFab || !hQt || !hVu) return [];
  const topo = hCod.y - 3;
  const base = fim ? fim.y + 3 : 0;
  const zona = pg.filter((i) => i.y < topo && i.y > base && i.str.trim());

  const inicios = zona
    .filter((i) => i.x < hDesc.x - 4 && /^\d{4,6}$/.test(i.str.trim()))
    .sort((a, b) => b.y - a.y);

  const col = (x: number) =>
    x < hDesc.x - 4 ? 'cod' : x < hFab.x - 4 ? 'desc' : x < hQt.x - 12 ? 'fab' : x < hVu.x - 2 ? 'qt' : 'outro';

  type Acc = { codigo: string; desc: string[]; fab: string[]; qt: string[]; y: number };
  const acc: Acc[] = inicios.map((i) => ({ codigo: i.str.trim(), desc: [], fab: [], qt: [], y: i.y }));

  const linhas = zona.filter((i) => !inicios.includes(i)).sort((a, b) => b.y - a.y || a.x - b.x);
  for (const t of linhas) {
    // pertence ao item cujo início está na mesma linha ou imediatamente acima
    let alvo: Acc | undefined;
    for (const a of acc) if (a.y >= t.y - 2.5) alvo = a;
    if (!alvo) continue;
    const c = col(t.x);
    const s = t.str.trim();
    if (c === 'desc') {
      if (/^\d{4,}$/.test(s)) continue; // referência solta (ex. "610001")
      alvo.desc.push(s);
    } else if (c === 'fab') alvo.fab.push(s);
    else if (c === 'qt') alvo.qt.push(s);
  }

  return acc.map((a) => {
    const descricao = a.desc.join(' ').replace(/\s+/g, ' ').trim();
    const codFab = a.fab.join('');
    const qtde = num(a.qt.join(''));
    const produtoId = baseDe(codFab);
    return {
      codigo: a.codigo,
      descricao,
      codFab,
      qtde,
      embalagem: embalagemDe(descricao, codFab),
      produtoId,
      produtoNome: nomeBase(descricao),
    };
  });
}
