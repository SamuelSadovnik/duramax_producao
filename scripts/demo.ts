/**
 * Dados FICTÍCIOS para testar o sistema.
 *
 *   npm run db:demo            cria (ou recria) os dados de teste
 *   npm run db:demo -- --limpar   apaga só os dados de teste
 *
 * Tudo que este script cria é fácil de reconhecer e não mistura com o que é real:
 *   - produtos da "Linha 900" (códigos 900.xxx), com nome começando por TESTE;
 *   - pedidos de número 900001 em diante, clientes "TESTE …";
 *   - OPs só desses produtos.
 * Lote e tempo existem apenas nesses produtos fictícios; nenhum produto real é alterado.
 * Os pedidos e OPs reais que já estiverem no banco não são tocados.
 */
import { parseArgs } from 'node:util';
import { db } from '../server/db.js';
import { mutar } from '../server/estado.js';
import { importarPedidos } from '../shared/acoes.js';
import { expedirMetade, rng, simularFabrica } from './simulacao.js';
import { proximoExpediente, somarExpediente, subtrairExpediente } from '../shared/calendar.js';
import type { PedidoLido, ItemLido } from '../shared/parse.js';
import type { Estado } from '../shared/types.js';

const LINHA = '900';
const NUM0 = 900001;
const ehTeste = {
  produto: (id: string) => id.startsWith(`${LINHA}.`),
  pedido: (numero: string) => Number(numero) >= NUM0 && Number(numero) < NUM0 + 1000,
};

// produtos fictícios: [código, nome, lote em L, tempo por lote em minutos]
const PRODUTOS: [string, string, number | null, number | null][] = [
  ['900.101', 'TESTE Esmalte Sintético Azul', 600, 300],
  ['900.102', 'TESTE Esmalte Sintético Branco', 800, 360],
  ['900.103', 'TESTE Esmalte Sintético Preto', 600, 300],
  ['900.201', 'TESTE Primer Cinza', 1000, 420],
  ['900.202', 'TESTE Fundo Anticorrosivo', 800, 390],
  ['900.301', 'TESTE Tinta Piso Cinza', 500, 330],
  ['900.302', 'TESTE Tinta Piso Verde', 500, 330],
  ['900.401', 'TESTE Diluente Universal', 1000, 180],
  ['900.501', 'TESTE Catalisador Epóxi', 400, 240],
  ['900.502', 'TESTE Epóxi Bicomponente Branco', 400, 450],
  ['900.601', 'TESTE Demarcação Amarela', 900, 360],
  ['900.999', 'TESTE Produto Novo Sem Parâmetro', null, null], // mostra o bloqueio no PCP
];

const CLIENTES: [string, string, string][] = [
  ['TESTE Tintas Aurora', 'Cascavel', 'PR'],
  ['TESTE Casa das Cores', 'Toledo', 'PR'],
  ['TESTE Mundo das Tintas', 'Chapecó', 'SC'],
  ['TESTE Pinta Fácil', 'Joinville', 'SC'],
  ['TESTE Ferragens Sul', 'Passo Fundo', 'RS'],
  ['TESTE Color Center', 'Maringá', 'PR'],
  ['TESTE Distribuidora Litoral', 'Itajaí', 'SC'],
  ['TESTE Obra Pronta', 'Santa Maria', 'RS'],
  ['TESTE Tintas Oeste', 'Foz do Iguaçu', 'PR'],
  ['TESTE Mega Pisos', 'Blumenau', 'SC'],
  ['TESTE Ponto da Tinta', 'Londrina', 'PR'],
  ['TESTE Revenda Central', 'Caxias do Sul', 'RS'],
];
const VENDEDORES = ['TESTE Vendedor Ana', 'TESTE Vendedor Bruno', 'TESTE Vendedor Carla'];
const EMB = [3.6, 18, 0.9];

function limpar(e: Estado): Estado {
  const pedidos = e.pedidos.filter((p) => !ehTeste.pedido(p.numero));
  const ids = new Set(pedidos.map((p) => p.id));
  const produtos = Object.fromEntries(Object.entries(e.produtos).filter(([id]) => !ehTeste.produto(id)));
  return { ...e, pedidos, produtos, ops: e.ops.filter((o) => !ehTeste.produto(o.produtoId)), prioridade: e.prioridade.filter((id) => ids.has(id)) };
}

function criar(e0: Estado, agora: Date): Estado {
  const fer = e0.config.feriados;
  const r = rng(7311);
  const escolha = <T,>(l: T[]) => l[Math.floor(r() * l.length)];
  let e = limpar(e0);

  // produtos fictícios entram já com lote e tempo (exceto o "sem parâmetro")
  const produtos = { ...e.produtos };
  for (const [id, nome, lote, tempoMin] of PRODUTOS) produtos[id] = { id, nome, linha: LINHA, unidade: 'L', lote, tempoMin };
  e = { ...e, produtos };
  const comParam = PRODUTOS.filter((p) => p[2] !== null);

  // 20 pedidos espalhados nos últimos ~11 dias úteis; os 4 mais novos ficam esperando o PCP
  const N = 20;
  const inicio = proximoExpediente(subtrairExpediente(agora, 11 * 528, fer), fer);
  const pedidos: { lido: PedidoLido; entrada: Date; liberar: Date | null }[] = [];
  for (let k = 0; k < N; k++) {
    const [cli, cidade, uf] = CLIENTES[k % CLIENTES.length];
    const entrada = k < N - 4 ? somarExpediente(inicio, Math.round(k * 300 + r() * 120), fer) : subtrairExpediente(agora, Math.round((N - k) * 70), fer);
    const nItens = 2 + Math.floor(r() * 4);
    const usados = new Set<string>();
    const itens: ItemLido[] = [];
    for (let j = 0; j < nItens; j++) {
      let p = escolha(comParam);
      while (usados.has(p[0])) p = escolha(comParam);
      usados.add(p[0]);
      const emb = escolha(EMB);
      const qtde = emb === 18 ? 10 + Math.floor(r() * 40) : emb === 3.6 ? 40 + Math.floor(r() * 160) : 48 + Math.floor(r() * 96);
      itens.push({ codigo: String(70000 + k * 10 + j), descricao: `${p[1]} ${emb}L`, codFab: `${p[0]}.${j + 1}`, qtde, embalagem: emb, produtoId: p[0], produtoNome: p[1] });
    }
    if (k === N - 1) itens.push({ codigo: '79999', descricao: 'TESTE Produto Novo Sem Parâmetro 3,6L', codFab: '900.999.1', qtde: 20, embalagem: 3.6, produtoId: '900.999', produtoNome: 'TESTE Produto Novo Sem Parâmetro' });
    const dia = entrada.toISOString().slice(0, 10);
    pedidos.push({
      lido: { numero: String(NUM0 + k), cliente: `${cli} LTDA`, fantasia: cli, cidade, uf, vendedor: VENDEDORES[k % 3], transportadora: 'TESTE Transportes', emissao: dia, previsao: dia, hora: '08:00:00', itens, avisos: [] },
      entrada,
      liberar: k < N - 4 ? somarExpediente(entrada, 40 + Math.round(r() * 200), fer) : null,
    });
  }
  for (const p of pedidos) e = importarPedidos(e, [{ pedido: p.lido }], p.entrada, 'Teste').estado;

  // simulação do chão: 2 OPs ao mesmo tempo, na ordem da fila; só OPs de teste
  e = simularFabrica(e, pedidos.map((p) => ({ id: `p${p.lido.numero}`, liberar: p.liberar })), inicio, agora, r, (o) => ehTeste.produto(o.produtoId));
  // metade dos pedidos prontos já foi expedida
  return expedirMetade(e, agora, ehTeste.pedido);
}

async function main() {
  const { values } = parseArgs({ options: { limpar: { type: 'boolean', default: false } } });
  const r = await mutar((e, agora) => (values.limpar ? limpar(e) : criar(e, agora)));
  const e = r.estado;
  const ped = e.pedidos.filter((p) => ehTeste.pedido(p.numero));
  const ops = e.ops.filter((o) => ehTeste.produto(o.produtoId));
  if (values.limpar) console.log('Dados de teste apagados. Pedidos e produtos reais continuam como estavam.');
  else {
    const n = (s: string) => ops.filter((o) => o.status === s).length;
    console.log(`Dados de teste criados: ${ped.length} pedidos (900001 a ${NUM0 + ped.length - 1}), ${PRODUTOS.length} produtos da Linha 900.`);
    console.log(`OPs: ${n('concluida')} concluídas, ${n('producao')} em produção, ${n('fila')} na fila.`);
    console.log('Para apagar depois: npm run db:demo -- --limpar');
  }
  await db().end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db().end().catch(() => {});
  process.exit(1);
});
