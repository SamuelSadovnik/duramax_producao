/**
 * Coloca pedidos de verdade (PDFs de Pedido de Venda) no sistema com dados FICTÍCIOS de produção,
 * para testar o fluxo inteiro: lote e tempo inventados para os produtos desses pedidos, PCP
 * liberando, OPs produzidas nos últimos dias (algumas acima do tempo), pedidos prontos e expedidos.
 *
 *   npm run db:teste -- <pasta com os PDFs ou arquivos .pdf>
 *
 * ATENÇÃO: o lote e o tempo gravados aqui são inventados. Antes de usar o sistema de verdade,
 * limpe o banco:  npm run db:limpar -- --confirmar
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore pdf.js para Node (versão legacy), sem tipos
import pdfjsMod from 'pdfjs-dist/legacy/build/pdf.js';
import { db } from '../server/db.js';
import { mutar } from '../server/estado.js';
import { importarPedidos } from '../shared/acoes.js';
import { subtrairExpediente, somarExpediente } from '../shared/calendar.js';
import { lerPedido, type PedidoLido, type TItem } from '../shared/parse.js';
import { expedirMetade, rng, simularFabrica } from './simulacao.js';

const pdfjs: any = (pdfjsMod as any).getDocument ? pdfjsMod : (pdfjsMod as any).default;

// lote (L) e tempo por lote (min) FICTÍCIOS, só para teste, por linha de produto
const FICTICIO: Record<string, [number, number]> = {
  '600': [500, 300],
  '610': [500, 330],
  '400': [1000, 180],
  '800': [400, 360],
  '200': [900, 360],
};
const PADRAO: [number, number] = [500, 300];

async function lerPdf(arquivo: string): Promise<PedidoLido> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(arquivo)), isEvalSupported: false, verbosity: 0 }).promise;
  const paginas: TItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    paginas.push(tc.items.filter((i: any) => typeof i.str === 'string').map((i: any) => ({ str: i.str, x: i.transform[4], y: i.transform[5] })));
  }
  await doc.destroy();
  return lerPedido(paginas);
}

function arquivosPdf(caminhos: string[]): string[] {
  const out: string[] = [];
  for (const c of caminhos) {
    if (statSync(c).isDirectory()) out.push(...readdirSync(c).filter((f) => /\.pdf$/i.test(f)).map((f) => join(c, f)));
    else if (/\.pdf$/i.test(c)) out.push(c);
  }
  return out.sort();
}

async function main() {
  // o pdf.js avisa que não achou o pacote de desenho (canvas); para só ler texto ele não é necessário
  const silenciar = (f: (...a: unknown[]) => void) => (...a: unknown[]) => {
    if (!/canvas|Require stack|polyfill/i.test(String(a[0]))) f(...a);
  };
  console.warn = silenciar(console.warn.bind(console));
  console.log = silenciar(console.log.bind(console));
  const arquivos = arquivosPdf(process.argv.slice(2));
  if (!arquivos.length) throw new Error('Informe a pasta com os PDFs: npm run db:teste -- "C:\\caminho\\da\\pasta"');

  const lidos: PedidoLido[] = [];
  for (const a of arquivos) {
    const p = await lerPdf(a);
    if (!p.numero || !p.itens.length) {
      console.log(`Pulando ${a}: não parece um Pedido de Venda do ERP.`);
      continue;
    }
    if (!lidos.some((x) => x.numero === p.numero)) lidos.push(p);
  }
  console.log(`Lidos ${lidos.length} pedidos: ${lidos.map((p) => `#${p.numero}`).join(', ')}`);

  let ficticios = 0;
  let semParametro = 0;
  const r = await mutar((e0, agora) => {
    let e = e0;
    const fer = e.config.feriados;
    const novos = lidos.filter((l) => !e.pedidos.some((p) => p.numero === l.numero));
    if (!novos.length) return e;
    const n = novos.length;
    // entradas espalhadas pelos últimos dias úteis; os 2 mais novos ficam esperando o PCP
    const sim = novos.map((l, k) => {
      const entrada = subtrairExpediente(agora, Math.round((n - k) * 330), fer);
      return { l, entrada, liberar: k < n - 2 ? somarExpediente(entrada, 60 + k * 25, fer) : null };
    });
    for (const s of sim) e = importarPedidos(e, [{ pedido: s.l }], s.entrada, 'Teste').estado;

    // lote e tempo fictícios para os produtos dos pedidos; os produtos que só aparecem no último
    // pedido ficam sem, para testar o aviso de "sem parâmetro" na análise do PCP
    const ultimo = new Set(sim[n - 1].l.itens.map((i) => i.produtoId));
    const outros = new Set(sim.slice(0, -1).flatMap((s) => s.l.itens.map((i) => i.produtoId)));
    const usados = new Set([...ultimo, ...outros]);
    const produtos = { ...e.produtos };
    for (const id of usados) {
      const p = produtos[id];
      if (!p || (p.lote && p.tempoMin)) continue;
      if (ultimo.has(id) && !outros.has(id) && n > 1) {
        semParametro++;
        continue;
      }
      const [lote, tempoMin] = FICTICIO[p.linha] ?? PADRAO;
      produtos[id] = { ...p, lote, tempoMin };
      ficticios++;
    }
    e = { ...e, produtos };

    const rand = rng(31369);
    e = simularFabrica(e, sim.map((s) => ({ id: `p${s.l.numero}`, liberar: s.liberar })), sim[0].entrada, agora, rand, (o) => usados.has(o.produtoId), 0.15);
    const numeros = new Set(novos.map((l) => l.numero));
    return expedirMetade(e, agora, (num) => numeros.has(num));
  });

  const e = r.estado;
  const numeros = new Set(lidos.map((l) => l.numero));
  const ps = e.pedidos.filter((p) => numeros.has(p.numero));
  const ops = e.ops.filter((o) => o.alocacoes.some((a) => ps.some((p) => p.id === a.pedidoId)));
  const n = (st: string) => ops.filter((o) => o.status === st).length;
  console.log(`\nPedidos no sistema: ${ps.length}. OPs: ${n('concluida')} concluídas, ${n('producao')} em produção, ${n('fila')} na fila.`);
  console.log(`Lote e tempo FICTÍCIOS gravados em ${ficticios} produto(s); ${semParametro} ficaram sem, para testar o PCP.`);
  console.log('\nAntes de usar o sistema de verdade, apague tudo isso:  npm run db:limpar -- --confirmar');
  await db().end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db().end().catch(() => {});
  process.exit(1);
});
