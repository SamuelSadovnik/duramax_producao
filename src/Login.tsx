import { useState } from 'react';
import { api, ErroApi } from './api';
import type { Usuario } from '../shared/types';

export function Login({ onEntrar }: { onEntrar: (u: Usuario) => void }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const r = await api.entrar(usuario, senha);
      onEntrar(r.usuario);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível entrar.');
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <section className="login-art">
        <img src="/logo-h-white.png" alt="Duramax Tintas e Vernizes" />
        <div>
          <h1>Produção do pedido até a expedição</h1>
          <p>Importação dos pedidos, decisão do PCP, ordens de produção, painel da fábrica e desempenho num lugar só.</p>
        </div>
        <div className="fluxo" aria-hidden="true">
          <span>Comercial</span><i>→</i><span>PCP</span><i>→</i><span>Fábrica</span><i>→</i><span>Expedição</span>
        </div>
      </section>
      <section className="login-form">
        <form onSubmit={entrar}>
          <h2>Entrar</h2>
          <label>
            Usuário
            <input id="login-usuario" className="input" autoComplete="username" autoCapitalize="none" value={usuario} onChange={(e) => setUsuario(e.target.value)} required autoFocus />
          </label>
          <label>
            Senha
            <input id="login-senha" className="input" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </label>
          {erro && <div className="erro" role="alert">{erro}</div>}
          <button className="btn pri" type="submit" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
          <span className="ajuda">Não tem acesso ou esqueceu a senha? Fale com o administrador do sistema.</span>
        </form>
      </section>
    </div>
  );
}
