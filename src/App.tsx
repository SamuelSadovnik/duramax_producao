import { useCallback, useEffect, useRef, useState } from 'react';
import { Provider, useApp, useRelogio } from './store';
import { Icon, Toasts } from './ui';
import { PedidosView, DetalhePedido } from './Pedidos';
import { PCPView } from './PCP';
import { FilaView } from './Fila';
import { OPsView } from './OPs';
import { GerenteView } from './Gerente';
import { TVView } from './TV';
import { DashboardView } from './Dashboard';
import { ParamsView } from './Params';
import { UsuariosView, TrocarSenha } from './Usuarios';
import { Login } from './Login';
import { api, ErroApi } from './api';
import { situacaoTurno } from '../shared/calendar';
import { statusPedido } from '../shared/engine';
import { dataCurta, hora } from '../shared/fmt';
import { PERFIS, type Estado, type Perfil, type Usuario } from '../shared/types';

type Tela = 'pedidos' | 'pcp' | 'fila' | 'ops' | 'chao' | 'tv' | 'dash' | 'params' | 'usuarios';

const NOMES: Record<Tela, string> = {
  pedidos: 'Pedidos',
  pcp: 'Análise PCP',
  fila: 'Fila e previsão',
  ops: 'OPs',
  chao: 'Chão de fábrica',
  tv: 'TV produção',
  dash: 'Desempenho',
  params: 'Parâmetros',
  usuarios: 'Usuários',
};

const ACESSO: Record<Perfil, Tela[]> = {
  admin: ['pedidos', 'pcp', 'fila', 'ops', 'chao', 'dash', 'params', 'usuarios', 'tv'],
  pcp: ['pedidos', 'pcp', 'fila', 'ops', 'chao', 'dash', 'params', 'tv'],
  comercial: ['pedidos', 'pcp', 'fila', 'ops', 'dash', 'tv'],
  gerente: ['chao', 'tv'],
  tv: ['tv'],
};

const TELAS = Object.keys(NOMES) as Tela[];
const lerHash = (): Tela | null => {
  const h = location.hash.replace('#', '') as Tela;
  return TELAS.includes(h) ? h : null;
};

/** Verifica a sessão, mostra o login e carrega o estado inicial. */
export function App() {
  const [fase, setFase] = useState<'carregando' | 'login' | 'pronto' | 'erro'>('carregando');
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState('');

  const iniciar = useCallback(async (u?: Usuario) => {
    setFase('carregando');
    try {
      const eu = u ?? (await api.eu()).usuario;
      const r = await api.estado();
      setUsuario(eu);
      setEstado(r.estado);
      setFase('pronto');
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401) setFase('login');
      else {
        setErro(e instanceof Error ? e.message : 'Erro ao carregar.');
        setFase('erro');
      }
    }
  }, []);

  useEffect(() => {
    iniciar();
  }, [iniciar]);

  const sair = useCallback(() => {
    setUsuario(null);
    setEstado(null);
    setFase('login');
  }, []);

  if (fase === 'carregando') return <div className="carregando">Carregando…</div>;
  if (fase === 'login') return <Login onEntrar={(u) => iniciar(u)} />;
  if (fase === 'erro' || !usuario || !estado)
    return (
      <div className="carregando" style={{ textAlign: 'center', padding: 20 }}>
        <div>
          <p>{erro || 'Não foi possível carregar o sistema.'}</p>
          <button className="btn" onClick={() => iniciar()}>Tentar de novo</button>
        </div>
      </div>
    );

  return (
    <Provider key={usuario.id} usuario={usuario} estadoInicial={estado} onSair={sair}>
      <Shell />
      <Toasts />
    </Provider>
  );
}

function Shell() {
  const { e, perfil, usuario, pedidoAberto, conexao, sair } = useApp();
  const relogio = useRelogio(10_000);
  const permitidas = ACESSO[perfil];
  const [tela, setTela] = useState<Tela>(() => {
    const h = lerHash();
    return h && permitidas.includes(h) ? h : permitidas[0];
  });
  const [menu, setMenu] = useState(false);
  const [trocarSenha, setTrocarSenha] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      history.replaceState(null, '', `#${tela}`);
    } catch {
      /* ignora */
    }
    window.scrollTo(0, 0);
  }, [tela]);

  useEffect(() => {
    const h = () => {
      const t = lerHash();
      if (t && permitidas.includes(t)) setTela(t);
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, [permitidas]);

  useEffect(() => {
    if (!menu) return;
    const h = (ev: MouseEvent) => !menuRef.current?.contains(ev.target as Node) && setMenu(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  const nPcp = e.pedidos.filter((p) => statusPedido(e, p) === 'pcp').length;
  const turno = situacaoTurno(relogio, e.config.feriados);

  // perfil TV: só o painel; os demais abrem a TV em tela própria e voltam
  if (perfil === 'tv') return <TVView sair={sair} rotuloSair="Sair" />;
  if (tela === 'tv') return <TVView sair={() => setTela(permitidas[0])} rotuloSair="Voltar ao sistema" />;

  return (
    <>
      <header className="top">
        <div className="top-in">
          <img className="top-logo" src="/logo-h-white.png" alt="Duramax Tintas e Vernizes" />
          <div className="top-sys">
            <b>Produção</b>
            <span>Pedidos · PCP · Fábrica</span>
          </div>
          <div className="top-right">
            {conexao === 'offline' && <span className="conexao" role="status"><Icon n="alert" s={12} /> Sem conexão</span>}
            <span className="clock">
              <span className={`turno ${turno === 'producao' ? 'on' : turno}`}>
                <i />
                {turno === 'producao' ? 'Produção em expediente' : turno === 'almoco' ? 'Almoço até 13:12' : 'Fora do expediente'}
              </span>
              <span className="data">{dataCurta(relogio)}</span> {hora(relogio)}
            </span>
            <div className="menu-user" ref={menuRef}>
              <button onClick={() => setMenu((x) => !x)} aria-expanded={menu} aria-haspopup="menu">
                <span className="avatar">{usuario.nome.slice(0, 1).toUpperCase()}</span>
                {usuario.nome.split(' ')[0]}
              </button>
              {menu && (
                <div className="menu-pop" role="menu">
                  <div className="who">
                    <b>{usuario.nome}</b>
                    <span>{usuario.usuario} · {PERFIS.find((p) => p.k === perfil)?.l}</span>
                  </div>
                  <button role="menuitem" onClick={() => { setMenu(false); setTrocarSenha(true); }}><Icon n="bolt" s={14} /> Trocar minha senha</button>
                  <button role="menuitem" onClick={sair}><Icon n="undo" s={14} /> Sair</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {permitidas.length > 1 && (
          <nav className="nav" aria-label="Telas">
            {permitidas.map((t) => (
              <button key={t} aria-current={tela === t ? 'page' : undefined} onClick={() => setTela(t)}>
                {t === 'tv' && <Icon n="tv" s={15} />}
                {NOMES[t]}
                {t === 'pcp' && nPcp > 0 && <span className="count">{nPcp}</span>}
              </button>
            ))}
          </nav>
        )}
      </header>
      {tela === 'pedidos' && <PedidosView />}
      {tela === 'pcp' && <PCPView />}
      {tela === 'fila' && <FilaView />}
      {tela === 'ops' && <OPsView />}
      {tela === 'chao' && <GerenteView />}
      {tela === 'dash' && <DashboardView />}
      {tela === 'params' && <ParamsView />}
      {tela === 'usuarios' && <UsuariosView />}
      {pedidoAberto && <DetalhePedido />}
      {trocarSenha && <TrocarSenha onClose={() => setTrocarSenha(false)} />}
    </>
  );
}
