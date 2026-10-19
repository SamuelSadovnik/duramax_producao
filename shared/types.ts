export type Perfil = 'admin' | 'comercial' | 'pcp' | 'gerente' | 'tv';

export const PERFIS: { k: Perfil; l: string }[] = [
  { k: 'admin', l: 'Administrador' },
  { k: 'comercial', l: 'Comercial' },
  { k: 'pcp', l: 'PCP' },
  { k: 'gerente', l: 'Gerente de produção' },
  { k: 'tv', l: 'Produção (TV)' },
];

export interface Usuario {
  id: string;
  nome: string;
  usuario: string;
  perfil: Perfil;
  ativo: boolean;
  ultimoAcesso?: string | null;
}

export interface Produto {
  id: string;            // código base de fábrica (linha.cor), ex. 600.1000
  nome: string;          // nome sem embalagem
  linha: string;         // prefixo, ex. 600
  unidade: 'L' | 'kg';
  lote: number;          // tamanho do lote (L ou kg)
  tempoMin: number;      // tempo padrão por lote, em minutos de expediente
  pendente?: boolean;    // criado na importação, parâmetros ainda não revisados
}

export type Decisao = 'pendente' | 'estoque' | 'op';

export interface Item {
  id: string;
  codigo: string;        // código ERP (ex. 00170)
  descricao: string;
  codFab: string;        // ex. 600.1000.4
  produtoId: string;     // ex. 600.1000
  embalagem: number;     // volume da embalagem (L)
  qtde: number;
  volume: number;        // qtde * embalagem
  decisao: Decisao;
}

export interface Evento { em: string; texto: string; tipo?: 'info' | 'ok' | 'alerta'; por?: string }

export interface Pedido {
  id: string;
  numero: string;        // 31462
  cliente: string;
  fantasia: string;
  cidade: string;
  uf: string;
  vendedor: string;
  transportadora: string;
  emissao: string;       // yyyy-mm-dd
  previsao: string;      // yyyy-mm-dd: data previsão impressa no PDF do ERP (só informativa; o prazo é calculado)
  itens: Item[];
  importadoEm: string;   // ISO
  pcpEm?: string;        // ISO — PCP liberou
  prontoEm?: string;     // ISO — todas OPs concluídas
  expedidoEm?: string;   // ISO
  eventos: Evento[];
}

export interface Alocacao { pedidoId: string; volume: number }

export type StatusOP = 'fila' | 'producao' | 'concluida';

export interface OP {
  id: string;
  numero: number;
  produtoId: string;
  lote: number;
  tempoPadraoMin: number;
  alocacoes: Alocacao[];
  status: StatusOP;
  criadaEm: string;
  inicio?: string;
  fim?: string;
  realMin?: number;      // minutos de expediente entre início e fim
  motivo?: string;
  obs?: string;
  iniciadaPor?: string;
  finalizadaPor?: string;
}

export interface Config {
  capacidade: number;        // OPs simultâneas consideradas na estimativa
  toleranciaPct: number;     // acima disso pede motivo do atraso
  prazoDiasUteis: number;    // prazo de entrega: dias úteis a partir da entrada do pedido no sistema
  feriados: string[];        // yyyy-mm-dd
}

export interface Estado {
  /** Incrementa a cada alteração gravada no banco; o front usa para saber quando recarregar. */
  versao: number;
  produtos: Record<string, Produto>;
  pedidos: Pedido[];
  ops: OP[];
  prioridade: string[];      // ids de pedidos em ordem de prioridade
  config: Config;
  seqOP: number;
}

export type StatusPedido = 'pcp' | 'fila' | 'producao' | 'pronto' | 'expedido';
