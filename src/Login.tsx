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
      <form className="login-card" onSubmit={entrar}>
        <div className="login-marca">
          <img src="/logo-h-white.png" alt="Duramax Tintas e Vernizes" />
        </div>
        <div className="login-campos">
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
        </div>
      </form>
    </div>
  );
}
