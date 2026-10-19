import { describe, expect, it } from 'vitest';
import { lerPedido, type TItem } from '../shared/parse';
import { embalagemDe, nomeBase, baseDe } from '../shared/catalog';

// Reproduz o layout do PDF "Pedido de Venda" do ERP (posições x/y do pdf.js).
const t = (x: number, y: number, str: string): TItem => ({ x, y, str });
const pagina: TItem[] = [
  t(23, 730, 'PEDIDO Nº 000000012345'),
  t(23, 720, 'Cliente:'), t(73, 720, 'TINTAS EXEMPLO LTDA'), t(397, 720, 'Código:'), t(436, 720, '00000001'),
  t(23, 710, 'Fantasia:'), t(73, 710, 'TINTAS EXEMPLO'), t(397, 710, 'Fone:'),
  t(23, 689, 'Município:'), t(76, 689, 'CASCAVEL'), t(291, 689, 'UF'), t(313, 689, 'PR'),
  t(24, 635, 'CÓDIGO'), t(66, 636, 'DESCRIÇÃO / REFERÊNCIA'), t(227, 635, 'CÓD. FAB'), t(290, 636, 'QTDE'), t(325, 636, 'VR UNIT'),
  // item com quantidade quebrada em duas linhas ("684,0" + "0")
  t(26, 554, '00266'), t(67, 554, 'DILUENTE RETARDADOR DURAFORT'), t(67, 545, 'METAIS / DURAFORT DF PISOS 0,9 L -'),
  t(226, 554, '400.1.1'), t(289, 554, '684,0'), t(305, 545, '0'), t(334, 554, '17,29'),
  // código de fábrica quebrado ("610.1.5229.1" + "8") e referência solta na descrição
  t(26, 500, '05079'), t(67, 500, 'DURAFORT DF PISOS LARANJA'), t(67, 491, 'SEGURANÇA 2,5YR 6/14 SB 18 L -'), t(67, 481, '610001'),
  t(226, 500, '610.1.5229.1'), t(226, 491, '8'), t(289, 500, '12,00'),
  // embalagem sem "L" na descrição
  t(26, 460, '00141'), t(67, 460, 'DURAFORT METAIS DF PRETO BR 0,9'), t(226, 460, '600.8550.1'), t(293, 460, '54,00'),
  t(24, 293, 'VALOR BRUTO:'),
  t(25, 244, 'Vendedor:'), t(79, 244, '014 - JÚLIA DAIANE ZAPPE'),
  t(289, 232, 'Data Previsão:'), t(352, 232, '23/10/2026'), t(400, 232, 'Data Emissão:'), t(463, 232, '16/10/2026'), t(511, 232, 'Hora:'), t(538, 231, '15:16:49'),
  t(24, 109, 'Transportadora:'), t(97, 109, '00008 - ALFA TRANSPORTES EIRELI'),
];

describe('leitor do PDF de pedido', () => {
  const p = lerPedido([pagina]);
  it('lê o cabeçalho', () => {
    expect(p.numero).toBe('12345');
    expect(p.fantasia).toBe('TINTAS EXEMPLO');
    expect(p.cidade).toBe('CASCAVEL');
    expect(p.uf).toBe('PR');
    expect(p.vendedor).toBe('JÚLIA DAIANE ZAPPE');
    expect(p.transportadora).toBe('ALFA TRANSPORTES EIRELI');
    expect(p.emissao).toBe('2026-10-16');
    expect(p.previsao).toBe('2026-10-23');
  });
  it('junta linhas quebradas de quantidade e código', () => {
    expect(p.itens).toHaveLength(3);
    expect(p.itens[0]).toMatchObject({ codigo: '00266', codFab: '400.1.1', qtde: 684, embalagem: 0.9, produtoId: '400.1' });
    expect(p.itens[1]).toMatchObject({ codFab: '610.1.5229.18', qtde: 12, embalagem: 18, produtoId: '610.1.5229' });
    expect(p.itens[1].descricao).not.toContain('610001');
    expect(p.itens[2]).toMatchObject({ embalagem: 0.9, produtoId: '600.8550', produtoNome: 'Durafort Metais DF Preto BR' });
  });
});

describe('catálogo', () => {
  it('embalagem pela descrição ou pelo sufixo', () => {
    expect(embalagemDe('X 3,6 L -', '600.1.4')).toBe(3.6);
    expect(embalagemDe('X SB 18L -', '610.1642.18')).toBe(18);
    expect(embalagemDe('X', '600.1.4')).toBe(3.6);
  });
  it('nome e código base', () => {
    expect(nomeBase('DURAFORT METAIS DF BRANCO PURO BR 3,6 L -')).toBe('Durafort Metais DF Branco Puro BR');
    expect(baseDe('800.120.5230.27')).toBe('800.120.5230');
  });
});
