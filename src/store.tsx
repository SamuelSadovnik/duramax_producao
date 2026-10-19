import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Estado, Perfil, Usuario } from '../shared/types';
import { calcularAgenda, type Agenda } from '../shared/engine';
import { api, ErroApi } from './api';

export interface Toast { id: number; texto: string; tipo?: 'ok' | 'info' | 'erro'; desfazer?: () => void }
export type Conexao = 'ok' | 'offline';

interface Ctx {
  e: Estado;
  agora: Date;
  agenda: Agenda;
  usuario: Usuario;
  perfil: Perfil;
  conexao: Conexao;
  /** Executa uma chamada à API que devolve o estado novo. Mostra o erro e devolve false se falhar. */
  executar: (fn: () => Promise<{ estado: Estado }>, ok?: string | Omit<Toast, 'id'>) => Promise<boolean>;
  recarregar: () => Promise<void>;
  toast: (t: Omit<Toast, 'id'>) => void;
  toasts: Toast[];
  fecharToast: (id: number) => void;
  pedidoAberto: string | null;
  abrirPedido: (id: string | null) => void;
  sair: () => Promise<void>;
}

const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);

export function useRelogio(ms: number) {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const h = setInterval(() => setT(new Date()), ms);
    return () => clearInterval(h);
  }, [ms]);
  return t;
}

/** Intervalo da checagem de novidades (TV e tablet atualizam sozinhos). */
const INTERVALO_MS = 4000;

export function Provider({ usuario, estadoInicial, onSair, children }: { usuario: Usuario; estadoInicial: Estado; onSair: () => void; children: React.ReactNode }) {
  const [e, setE] = useState<Estado>(estadoInicial);
  const versao = useRef(estadoInicial.versao);
  const agora = useRelogio(15_000);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pedidoAberto, abrirPedido] = useState<string | null>(null);
  const [conexao, setConexao] = useState<Conexao>('ok');
  const seq = useRef(0);

  const aplicar = useCallback((novo: Estado) => {
    // ignora respostas atrasadas, mais antigas do que o que já está na tela
    if (novo.versao < versao.current) return;
    versao.current = novo.versao;
    setE(novo);
  }, []);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current;
    setToasts((x) => [...x.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.desfazer ? 7000 : t.tipo === 'erro' ? 6000 : 4200);
  }, []);
  const fecharToast = useCallback((id: number) => setToasts((x) => x.filter((y) => y.id !== id)), []);

  const tratarErro = useCallback(
    (err: unknown) => {
      if (err instanceof ErroApi && err.status === 401) {
        onSair();
        return;
      }
      if (err instanceof ErroApi && err.status === 0) setConexao('offline');
      toast({ texto: err instanceof Error ? err.message : 'Algo deu errado.', tipo: 'erro' });
    },
    [onSair, toast],
  );

  const recarregar = useCallback(async () => {
    try {
      const r = await api.estado();
      setConexao('ok');
      versao.current = -1;
      aplicar(r.estado);
    } catch (err) {
      tratarErro(err);
    }
  }, [aplicar, tratarErro]);

  const executar = useCallback<Ctx['executar']>(
    async (fn, ok) => {
      try {
        const r = await fn();
        setConexao('ok');
        aplicar(r.estado);
        if (ok) toast(typeof ok === 'string' ? { texto: ok, tipo: 'ok' } : ok);
        return true;
      } catch (err) {
        tratarErro(err);
        // se a regra recusou porque outra pessoa mudou algo, traz o estado atual
        if (err instanceof ErroApi && err.status >= 400 && err.status < 500) recarregar();
        return false;
      }
    },
    [aplicar, toast, tratarErro, recarregar],
  );

  // checa a versão a cada poucos segundos e recarrega quando outra pessoa alterou algo
  useEffect(() => {
    let parado = false;
    let falhas = 0;
    const tick = async () => {
      if (parado || document.visibilityState === 'hidden') return;
      try {
        const { versao: v } = await api.versao();
        falhas = 0;
        setConexao('ok');
        if (v !== versao.current) {
          const r = await api.estado();
          versao.current = -1;
          aplicar(r.estado);
        }
      } catch (err) {
        if (err instanceof ErroApi && err.status === 401) return onSair();
        if (++falhas >= 2) setConexao('offline');
      }
    };
    const h = setInterval(tick, INTERVALO_MS);
    const vis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', vis);
    return () => {
      parado = true;
      clearInterval(h);
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('online', vis);
    };
  }, [aplicar, onSair]);

  const sair = useCallback(async () => {
    await api.sair().catch(() => {});
    onSair();
  }, [onSair]);

  const agenda = useMemo(() => calcularAgenda(e, agora), [e, agora]);

  const v: Ctx = {
    e,
    agora,
    agenda,
    usuario,
    perfil: usuario.perfil,
    conexao,
    executar,
    recarregar,
    toast,
    toasts,
    fecharToast,
    pedidoAberto,
    abrirPedido,
    sair,
  };
  return <C.Provider value={v}>{children}</C.Provider>;
}

/** Perfis que podem fazer cada coisa (o servidor confere de novo). */
export const pode = {
  importar: (p: Perfil) => ['admin', 'comercial', 'pcp'].includes(p),
  decidirPCP: (p: Perfil) => ['admin', 'pcp'].includes(p),
  prioridade: (p: Perfil) => ['admin', 'comercial', 'pcp'].includes(p),
  expedir: (p: Perfil) => ['admin', 'comercial', 'pcp'].includes(p),
  operarOP: (p: Perfil) => ['admin', 'pcp', 'gerente'].includes(p),
  parametros: (p: Perfil) => ['admin', 'pcp'].includes(p),
};
