import type { Estado, Usuario, Perfil, Decisao } from '../shared/types';
import type { Importacao } from '../shared/acoes';
import type { AcaoOP } from '../shared/engine';

export class ErroApi extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

async function req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${caminho}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: corpo !== undefined || metodo !== 'GET' ? { 'content-type': 'application/json' } : undefined,
      body: corpo !== undefined ? JSON.stringify(corpo) : metodo !== 'GET' ? '{}' : undefined,
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor. Verifique a internet.');
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErroApi(res.status, j.erro ?? `Erro ${res.status}`);
  return j as T;
}

type ComEstado = { estado: Estado };

export const api = {
  entrar: (usuario: string, senha: string) => req<{ usuario: Usuario }>('POST', '/auth/entrar', { usuario, senha }),
  sair: () => req<{ ok: true }>('POST', '/auth/sair'),
  eu: () => req<{ usuario: Usuario }>('GET', '/auth/eu'),
  trocarSenha: (atual: string, nova: string) => req<{ ok: true }>('POST', '/auth/senha', { atual, nova }),

  estado: () => req<ComEstado>('GET', '/estado'),
  versao: () => req<{ versao: number }>('GET', '/versao'),

  importar: (pedidos: Importacao[]) => req<ComEstado & { novosProdutos: number; importados: string[] }>('POST', '/pedidos/importar', { pedidos }),
  decidir: (pedidoId: string, itens: string[], decisao: Decisao) => req<ComEstado>('POST', `/pedidos/${pedidoId}/decisoes`, { itens, decisao }),
  liberar: (pedidoId: string) => req<ComEstado>('POST', `/pedidos/${pedidoId}/liberar`),
  expedir: (pedidoId: string) => req<ComEstado>('POST', `/pedidos/${pedidoId}/expedir`),
  excluirPedido: (pedidoId: string) => req<ComEstado>('DELETE', `/pedidos/${pedidoId}`),
  prioridade: (ids: string[]) => req<ComEstado>('PUT', '/prioridade', { ids }),

  op: (opId: string, acao: AcaoOP, dados: { quando?: string; inicio?: string; motivo?: string; obs?: string } = {}) =>
    req<ComEstado>('POST', `/ops/${opId}/${acao}`, dados),

  produto: (id: string, patch: { lote?: number; tempoMin?: number }) => req<ComEstado>('PATCH', `/produtos/${encodeURIComponent(id)}`, patch),
  config: (patch: { capacidade?: number; toleranciaPct?: number; feriados?: string[] }) => req<ComEstado>('PATCH', '/config', patch),

  usuarios: () => req<{ usuarios: Usuario[] }>('GET', '/usuarios'),
  criarUsuario: (d: { nome: string; usuario: string; perfil: Perfil; senha: string }) => req<{ usuario: Usuario }>('POST', '/usuarios', d),
  editarUsuario: (id: string, d: Partial<{ nome: string; perfil: Perfil; ativo: boolean; senha: string }>) => req<{ usuario: Usuario }>('PATCH', `/usuarios/${id}`, d),
};
