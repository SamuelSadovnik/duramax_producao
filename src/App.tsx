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

const ICONES: Record<Tela, string> = {
  pedidos: 'pedidos',
  pcp: 'pcp',
  fila: 'fila',
  ops: 'ops',
  chao: 'fabrica',
  tv: 'tv',
  dash: 'grafico',
  params: 'ajustes',
  usuarios: 'usuarios',
};

const lerRecolhido = () => {
  try {
    return localStorage.getItem('dmx-menu-recolhido') === '1';
  } catch {
    return false;
  }
};

function Shell() {
  const { e, perfil, usuario, pedidoAberto, conexao, sair } = useApp();
  const relogio = useRelogio(10_000);
  const permitidas = ACESSO[perfil];
  const [tela, setTela] = useState<Tela>(() => {
    const h = lerHash();
    return h && permitidas.includes(h) ? h : permitidas[0];
  });
  const [recolhido, setRecolhido] = useState(lerRecolhido);
  const [gaveta, setGaveta] = useState(false);
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
    setGaveta(false);
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

  const alternarRecolhido = () => {
    setRecolhido((x) => {
      try {
        localStorage.setItem('dmx-menu-recolhido', x ? '0' : '1');
      } catch {
        /* ignora */
      }
      return !x;
    });
  };

  const nPcp = e.pedidos.filter((p) => statusPedido(e, p) === 'pcp').length;
  const turno = situacaoTurno(relogio, e.config.feriados);
  const turnoTxt = turno === 'producao' ? 'Produção em expediente' : turno === 'almoco' ? 'Almoço até 13:12' : 'Fora do expediente';

  // perfil TV: só o painel; os demais abrem a TV em tela própria e voltam
  if (perfil === 'tv') return <TVView sair={sair} rotuloSair="Sair" />;
  if (tela === 'tv') return <TVView sair={() => setTela(permitidas[0])} rotuloSair="Voltar ao sistema" />;

  return (
    <div className={`app${recolhido ? ' recolhido' : ''}${gaveta ? ' gaveta' : ''}`}>
      <header className="barra-mob">
        <button className="btn-ico" onClick={() => setGaveta(true)} aria-label="Abrir menu"><Icon n="menu" s={22} /></button>
        <img src="/logo-h-white.png" alt="Duramax" />
        <span className="num">{hora(relogio)}</span>
      </header>
      {gaveta && <div className="sb-scrim" onClick={() => setGaveta(false)} />}

      <aside className="sb" aria-label="Menu">
        <div className="sb-topo">
          <img className="sb-logo" src="/logo-h-white.png" alt="Duramax Tintas e Vernizes" />
          <img className="sb-icone" src="/icone.png" alt="Duramax" />
          <button className="sb-recolher" onClick={alternarRecolhido} aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'} title={recolhido ? 'Expandir menu' : 'Recolher menu'}>
            <Icon n="recolher" s={16} />
          </button>
        </div>
        <div className="sb-sys">Produção</div>

        <nav className="sb-nav" aria-label="Telas">
          {permitidas.map((t) => (
            <button key={t} aria-current={tela === t ? 'page' : undefined} onClick={() => setTela(t)} title={NOMES[t]}>
              <Icon n={ICONES[t]} s={19} w={1.9} />
              <span className="sb-rot">{NOMES[t]}</span>
              {t === 'pcp' && nPcp > 0 && <span className="sb-badge">{nPcp}</span>}
            </button>
          ))}
        </nav>

        <div className="sb-rodape">
          {conexao === 'offline' && (
            <div className="sb-off" role="status"><Icon n="alert" s={14} /><span className="sb-rot">Sem conexão</span></div>
          )}
          <div className={`sb-turno ${turno}`} title={turnoTxt}>
            <i />
            <div className="sb-rot">
              <b className="num">{hora(relogio)}</b>
              <span>{dataCurta(relogio)} · {turnoTxt}</span>
            </div>
          </div>
          <div className="sb-user" ref={menuRef}>
            <button onClick={() => setMenu((x) => !x)} aria-expanded={menu} aria-haspopup="menu" title={usuario.nome}>
              <span className="avatar">{usuario.nome.slice(0, 1).toUpperCase()}</span>
              <span className="sb-rot">
                <b>{usuario.nome}</b>
                <span>{PERFIS.find((p) => p.k === perfil)?.l}</span>
              </span>
            </button>
            {menu && (
              <div className="menu-pop" role="menu">
                <div className="who">
                  <b>{usuario.nome}</b>
                  <span>{usuario.usuario} · {PERFIS.find((p) => p.k === perfil)?.l}</span>
                </div>
                <button role="menuitem" onClick={() => { setMenu(false); setTrocarSenha(true); }}><Icon n="chave" s={15} /> Trocar minha senha</button>
                <button role="menuitem" onClick={sair}><Icon n="sair" s={15} /> Sair</button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="conteudo">
        {tela === 'pedidos' && <PedidosView />}
        {tela === 'pcp' && <PCPView />}
        {tela === 'fila' && <FilaView />}
        {tela === 'ops' && <OPsView />}
        {tela === 'chao' && <GerenteView />}
        {tela === 'dash' && <DashboardView />}
        {tela === 'params' && <ParamsView />}
        {tela === 'usuarios' && <UsuariosView />}
      </div>
      {pedidoAberto && <DetalhePedido />}
      {trocarSenha && <TrocarSenha onClose={() => setTrocarSenha(false)} />}
    </div>
  );
}
